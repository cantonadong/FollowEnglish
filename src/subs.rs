//! Subtitle parsing and sentence building (pure logic, no UI / IO besides file reads).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sentence {
    /// seconds
    pub start: f64,
    /// seconds
    pub end: f64,
    pub text: String,
}

#[derive(Clone, Debug)]
pub struct Word {
    /// ms
    pub start: f64,
    /// ms
    pub end: f64,
    pub text: String,
}

pub const SUB_EXTS: [&str; 4] = ["srt", "vtt", "ass", "ssa"];

// ---------------------------------------------------------------- sentences

const ABBREVIATIONS: [&str; 13] = [
    "mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "jr", "sr", "no",
];
// A sentence forced to split for length gets these caps; real sentence-ending
// punctuation is always honored regardless of length.
const MAX_SENTENCE_MS: f64 = 15_000.0;
const MAX_SENTENCE_WORDS: usize = 30;

fn is_closer(c: char) -> bool {
    matches!(c, '"' | '\'' | ')' | ']')
}
fn is_end_punct(c: char) -> bool {
    matches!(c, '.' | '!' | '?')
}

/// `^[.!?]+["')\]]*$`
fn is_terminal_token(token: &str) -> bool {
    let t = token.trim_end_matches(is_closer);
    !t.is_empty() && t.chars().all(is_end_punct)
}

/// Splits `^(.*?)([.!?]+["')\]]*)$` -> (head, punctuation suffix).
fn split_terminal(text: &str) -> Option<(&str, &str)> {
    let no_closers = text.trim_end_matches(is_closer);
    let head = no_closers.trim_end_matches(is_end_punct);
    if head.len() == no_closers.len() {
        return None;
    }
    Some((head, &text[head.len()..]))
}

fn is_sentence_end(token: &str, prev_word: &str) -> bool {
    if !is_terminal_token(token) {
        return false;
    }
    if token == "." {
        let p: String = prev_word
            .to_lowercase()
            .chars()
            .filter(|c| c.is_ascii_lowercase() || *c == '.')
            .collect();
        if ABBREVIATIONS.contains(&p.as_str()) {
            return false;
        }
    }
    true
}

/// ffmpeg's whisper filter hallucinates fragments at window boundaries whose
/// timestamps run ahead of the real speech that follows. Real speech is
/// chronological, so pop already-accepted words that start later than the
/// current one.
fn sanitize_word_timestamps(words: Vec<Word>) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::with_capacity(words.len());
    for w in words {
        while out.last().is_some_and(|l| l.start > w.start) {
            out.pop();
        }
        out.push(w);
    }
    out
}

fn join_words(words: &[Word]) -> String {
    let mut out = String::new();
    for w in words {
        if out.is_empty() {
            out.push_str(&w.text);
        } else if w.text.starts_with(['.', ',', '!', '?', ';', ':']) {
            out.push_str(&w.text);
        } else {
            out.push(' ');
            out.push_str(&w.text);
        }
    }
    // whisper.cpp occasionally emits one spoken word as several tokens.
    let toks: Vec<&str> = out.split_whitespace().collect();
    let mut res: Vec<String> = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        let eq = |a: &str, b: &str| a.eq_ignore_ascii_case(b);
        let starts_word = |t: &str, w: &str| {
            t.len() >= w.len()
                && t[..w.len()].eq_ignore_ascii_case(w)
                && !t[w.len()..].starts_with(|c: char| c.is_alphanumeric() || c == '_')
        };
        if i + 2 < toks.len() && eq(toks[i], "pres") && eq(toks[i + 1], "cript") && starts_word(toks[i + 2], "ive") {
            res.push(format!("prescriptive{}", &toks[i + 2][3..]));
            i += 3;
        } else if i + 1 < toks.len() && eq(toks[i], "enable") && starts_word(toks[i + 1], "ment") {
            res.push(format!("enablement{}", &toks[i + 1][4..]));
            i += 2;
        } else {
            res.push(toks[i].to_string());
            i += 1;
        }
    }
    res.join(" ")
}

/// Rebuilds grammatical sentences from a word-level timestamp stream.
/// Boundaries come from terminal punctuation; only over-long sentences are
/// force-split, and only at a comma.
pub fn build_sentences(raw: Vec<Word>) -> Vec<Sentence> {
    let words = sanitize_word_timestamps(raw);
    let mut sentences = Vec::new();
    let mut current: Vec<Word> = Vec::new();
    let mut last_comma: Option<usize> = None;

    fn flush(current: &mut Vec<Word>, end_idx: usize, out: &mut Vec<Sentence>, last_comma: &mut Option<usize>) {
        if current.is_empty() {
            return;
        }
        let rest = current.split_off(end_idx + 1);
        let slice = std::mem::replace(current, rest);
        out.push(Sentence {
            start: slice[0].start / 1000.0,
            end: slice[slice.len() - 1].end / 1000.0,
            text: join_words(&slice),
        });
        *last_comma = None;
    }

    for w in words {
        let prev = current.last().map(|p| p.text.clone()).unwrap_or_default();
        let is_comma = w.text.ends_with(',');
        let is_end = is_sentence_end(&w.text, &prev);
        current.push(w);
        let idx = current.len() - 1;
        if is_comma {
            last_comma = Some(idx);
        }
        if is_end {
            flush(&mut current, idx, &mut sentences, &mut last_comma);
            continue;
        }
        let dur = current[idx].end - current[0].start;
        if dur > MAX_SENTENCE_MS || current.len() > MAX_SENTENCE_WORDS {
            if let Some(c) = last_comma {
                flush(&mut current, c, &mut sentences, &mut last_comma);
            }
        }
    }
    if !current.is_empty() {
        let n = current.len() - 1;
        flush(&mut current, n, &mut sentences, &mut last_comma);
    }
    sentences.retain(|s| !s.text.is_empty());
    sentences
}

/// Parses ffmpeg whisper filter `format=json` output leniently: objects may be
/// glued together and `text` may contain an unescaped quote.
pub fn parse_whisper_words(raw: &str) -> Vec<Word> {
    const MARK: &str = "{\"start\":";
    let mut words = Vec::new();
    let mut starts: Vec<usize> = raw.match_indices(MARK).map(|(i, _)| i).collect();
    starts.push(raw.len());
    for pair in starts.windows(2) {
        let chunk = raw[pair[0]..pair[1]].trim();
        let Some(body) = chunk.strip_prefix(MARK).and_then(|b| b.strip_suffix("\"}")) else { continue };
        let Some((start, rest)) = body.split_once(",\"end\":") else { continue };
        let Some((end, text)) = rest.split_once(",\"text\":\"") else { continue };
        let (Ok(start), Ok(end)) = (start.parse::<u64>(), end.parse::<u64>()) else { continue };
        let mut t = String::with_capacity(text.len());
        let mut it = text.chars();
        while let Some(c) = it.next() {
            if c == '\\' {
                if let Some(n) = it.next() {
                    t.push(n);
                }
            } else {
                t.push(c);
            }
        }
        if !t.trim().is_empty() {
            words.push(Word { start: start as f64, end: end as f64, text: t });
        }
    }
    words
}

// ---------------------------------------------------------------- sidecar files

pub fn find_sidecar(video: &Path) -> Option<PathBuf> {
    let stem = video.file_stem()?.to_string_lossy().to_lowercase();
    let dir = video.parent()?;
    let names: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    for ext in SUB_EXTS {
        let want = format!("{stem}.{ext}");
        if let Some(n) = names.iter().find(|n| n.to_lowercase() == want) {
            return Some(dir.join(n));
        }
    }
    None
}

fn timestamp(value: &str) -> f64 {
    let v = value.trim().replacen(',', ".", 1);
    let parts: Vec<&str> = v.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return f64::NAN;
    }
    let mut total = 0.0;
    for p in parts {
        let n: f64 = if p.is_empty() { 0.0 } else { p.parse().unwrap_or(f64::NAN) };
        if !n.is_finite() || n < 0.0 {
            return f64::NAN;
        }
        total = total * 60.0 + n;
    }
    total
}

fn clean_text(text: &str) -> String {
    let mut s = String::with_capacity(text.len());
    let mut depth_brace = false;
    let mut depth_angle = false;
    for c in text.chars() {
        match c {
            '{' if !depth_angle => depth_brace = true,
            '}' if depth_brace => depth_brace = false,
            '<' if !depth_brace => depth_angle = true,
            '>' if depth_angle => depth_angle = false,
            _ if depth_brace || depth_angle => {}
            _ => s.push(c),
        }
    }
    // An unterminated tag in JS regex is left as-is; mimic by keeping text.
    if depth_brace || depth_angle {
        s = strip_closed(text);
    }
    let s = s
        .replace("\\N", " ")
        .replace("\\n", " ")
        .replace("\\h", " ")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Slow path: remove only properly closed `{...}` then `<...>` groups.
fn strip_closed(text: &str) -> String {
    fn strip(src: &str, open: char, close: char) -> String {
        let mut out = String::new();
        let mut rest = src;
        while let Some(i) = rest.find(open) {
            match rest[i..].find(close) {
                Some(j) => {
                    out.push_str(&rest[..i]);
                    rest = &rest[i + j + close.len_utf8()..];
                }
                None => break,
            }
        }
        out.push_str(rest);
        out
    }
    strip(&strip(text, '{', '}'), '<', '>')
}

/// Finds `<hh:mm:ss.mmm>` / `<mm:ss.mmm>` markers: (match start, match end, time).
fn inline_times(s: &str) -> Vec<(usize, usize, f64)> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'<' {
            if let Some(len) = s[i + 1..].find('>') {
                let inner = &s[i + 1..i + 1 + len];
                if is_inline_time(inner) {
                    out.push((i, i + len + 2, timestamp(inner)));
                    i += len + 2;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

fn is_inline_time(t: &str) -> bool {
    let Some((hms, ms)) = t.rsplit_once('.') else { return false };
    if ms.len() != 3 || !ms.bytes().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let parts: Vec<&str> = hms.split(':').collect();
    let digits = |p: &str| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit());
    match parts.len() {
        3 => digits(parts[0]) && parts[0].len() >= 2 && parts[1].len() == 2 && digits(parts[1]) && parts[2].len() == 2 && digits(parts[2]),
        2 => parts[0].len() == 2 && digits(parts[0]) && parts[1].len() == 2 && digits(parts[1]),
        _ => false,
    }
}

pub fn read_sidecar(path: &Path) -> Result<Vec<Sentence>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取字幕失败：{e}"))?;
    let source = crate::win::decode_text(&bytes);
    let source = source.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut cues: Vec<Sentence> = Vec::new();
    let mut add = |start: f64, end: f64, text: &str| {
        let t = clean_text(text);
        if start.is_finite() && end.is_finite() && end > start && !t.is_empty() {
            cues.push(Sentence { start, end, text: t });
        }
    };

    if ext == "ass" || ext == "ssa" {
        let mut in_events = false;
        let mut fields: Vec<String> = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        for line in source.split('\n') {
            let tl = line.trim();
            if tl.starts_with('[') && tl[1..].contains(']') {
                in_events = tl.to_lowercase() == "[events]";
            }
            if !in_events {
                continue;
            }
            let lower = line.to_lowercase();
            if lower.starts_with("format:") {
                fields = line[line.find(':').unwrap() + 1..].split(',').map(|f| f.trim().to_lowercase()).collect();
            }
            if !lower.starts_with("dialogue:") {
                continue;
            }
            let parts: Vec<&str> = line[line.find(':').unwrap() + 1..].split(',').collect();
            let pos = |n: &str| fields.iter().position(|f| f == n);
            let (Some(ti), Some(si), Some(ei)) = (pos("text"), pos("start"), pos("end")) else { continue };
            if ti != fields.len() - 1 || ti > parts.len() {
                continue;
            }
            let text = parts[ti..].join(",");
            if has_vector_drawing(&text) {
                continue;
            }
            let ts = |i: usize| parts.get(i).map(|p| timestamp(p)).unwrap_or(f64::NAN);
            add(ts(si), ts(ei), &text);
        }
    } else {
        let is_vtt = ext == "vtt";
        let has_word_times = is_vtt && !inline_times(&source).is_empty();
        let mut words: Vec<Word> = Vec::new();
        let mut previous_lines: Vec<String> = Vec::new();
        for block in split_blocks(&source, is_vtt) {
            let lines: Vec<&str> = block.split('\n').collect();
            if starts_with_keyword(lines[0]) {
                continue;
            }
            let Some(ti) = lines.iter().position(|l| l.contains("-->")) else { continue };
            let Some((s, e)) = parse_timing(lines[ti]) else { continue };
            let (start, end) = (timestamp(s), timestamp(e));
            let body_lines: Vec<&str> = lines[ti + 1..].iter().copied().filter(|l| !clean_text(l).is_empty()).collect();
            if !has_word_times {
                add(start, end, &body_lines.join(" "));
                continue;
            }
            let displayed: Vec<String> = body_lines.iter().map(|l| clean_text(l)).collect();
            let mut repeated = 0;
            // Rolling cues carry the prior visible line without word timestamps.
            let max = body_lines.len().min(previous_lines.len());
            for count in (1..=max).rev() {
                if body_lines[..count].iter().any(|l| !inline_times(l).is_empty()) {
                    continue;
                }
                let off = previous_lines.len() - count;
                if displayed[..count].iter().enumerate().all(|(i, l)| *l == previous_lines[off + i]) {
                    repeated = count;
                    break;
                }
            }
            previous_lines = displayed;
            let mut fresh = &body_lines[repeated..];
            if fresh.is_empty() {
                if end - start <= 0.02 {
                    continue; // display-only roll transition
                }
                fresh = &body_lines[..]; // a real repeated utterance must remain
            }
            let body = fresh.join(" ");
            let markers = inline_times(&body);
            let mut spans: Vec<(f64, usize)> = vec![(start, 0)];
            spans.extend(markers.iter().map(|m| (m.2, m.1)));
            for (i, &(span_start, offset)) in spans.iter().enumerate() {
                let span_end = if i < markers.len() { markers[i].2 } else { end };
                let slice_end = if i < markers.len() { markers[i].0 } else { body.len() };
                if slice_end < offset {
                    continue;
                }
                let text = clean_text(&body[offset..slice_end]);
                if text.is_empty() || !span_start.is_finite() || !span_end.is_finite() || span_start < start || span_start >= end || span_end <= span_start {
                    continue;
                }
                let (ws, we) = (span_start * 1000.0, span_end.min(end) * 1000.0);
                match split_terminal(&text) {
                    Some((head, punct)) if !head.is_empty() => {
                        words.push(Word { start: ws, end: we, text: head.to_string() });
                        words.push(Word { start: ws, end: we, text: punct.to_string() });
                    }
                    _ => words.push(Word { start: ws, end: we, text }),
                }
            }
        }
        if has_word_times && !words.is_empty() {
            return Ok(build_sentences(words));
        }
    }
    if cues.is_empty() {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Err(format!("字幕文件没有可读取的时间轴：{name}。请检查字幕格式；不会重复生成字幕。"));
    }
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(cues)
}

fn has_vector_drawing(text: &str) -> bool {
    let mut rest = text;
    while let Some(i) = rest.find('{') {
        let Some(j) = rest[i..].find('}') else { return false };
        let tag = &rest[i..i + j];
        let b = tag.as_bytes();
        if b.windows(3).any(|w| w[0] == b'\\' && w[1] == b'p' && (b'1'..=b'9').contains(&w[2])) {
            return true;
        }
        rest = &rest[i + j + 1..];
    }
    false
}

fn starts_with_keyword(line: &str) -> bool {
    ["NOTE", "STYLE", "REGION"].iter().any(|k| {
        line.strip_prefix(k).is_some_and(|r| r.is_empty() || r.starts_with(char::is_whitespace))
    })
}

fn parse_timing(line: &str) -> Option<(&str, &str)> {
    let (a, b) = line.split_once("-->")?;
    let a = a.trim();
    let tc = |c: char| c.is_ascii_digit() || matches!(c, ':' | '.' | ',');
    if a.is_empty() || !a.chars().all(tc) {
        return None;
    }
    let b = b.trim_start();
    let end = b.find(|c: char| !tc(c)).unwrap_or(b.len());
    if end == 0 {
        return None;
    }
    Some((a, &b[..end]))
}

/// VTT: split on blank lines (`\n\n+`); SRT: a line of only spaces/tabs is also a delimiter.
fn split_blocks(src: &str, is_vtt: bool) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    for line in src.split('\n') {
        let blank = if is_vtt { line.is_empty() } else { line.chars().all(|c| c == ' ' || c == '\t') };
        if blank {
            if !cur.is_empty() {
                blocks.push(cur.join("\n"));
                cur.clear();
            }
        } else {
            cur.push(line);
        }
    }
    if !cur.is_empty() {
        blocks.push(cur.join("\n"));
    }
    blocks
}

// ---------------------------------------------------------------- SRT writing

fn srt_time(seconds: f64) -> String {
    let ms = (seconds * 1000.0).round().max(0.0) as u64;
    format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)
}

pub fn to_srt(sentences: &[Sentence]) -> String {
    let mut out = String::new();
    for (i, s) in sentences.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&format!("{}\n{} --> {}\n{}\n", i + 1, srt_time(s.start), srt_time(s.end), s.text));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: f64, e: f64, t: &str) -> Word {
        Word { start: s, end: e, text: t.into() }
    }

    #[test]
    fn builds_sentences_with_abbrev_and_sanitize() {
        let words = vec![
            w(0., 100., "Hello"), w(100., 200., "Mr"), w(200., 210., "."), w(210., 300., "Smith"),
            w(300., 310., "."), w(5000., 5100., "BL"), w(400., 500., "Next"), w(500., 600., "one"),
            w(600., 610., "?"),
        ];
        let s = build_sentences(words);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].text, "Hello Mr. Smith.");
        assert_eq!(s[1].text, "Next one?");
        assert_eq!(s[1].start, 0.4);
    }

    #[test]
    fn joins_subword_splits() {
        let s = build_sentences(vec![w(0., 1., "pres"), w(1., 2., "cript"), w(2., 3., "ive"), w(3., 4., ".")]);
        assert_eq!(s[0].text, "prescriptive.");
    }

    #[test]
    fn parses_glued_whisper_json() {
        let raw = "{\"start\":0,\"end\":10,\"text\":\" Hi\"}{\"start\":10,\"end\":20,\"text\":\"\"\"}\n{\"start\":20,\"end\":30,\"text\":\"a\\\"b\"}";
        let ws = parse_whisper_words(raw);
        assert_eq!(ws.len(), 3);
        assert_eq!(ws[1].text, "\"");
        assert_eq!(ws[2].text, "a\"b");
    }

    #[test]
    fn terminal_split() {
        assert_eq!(split_terminal("end.)"), Some(("end", ".)")));
        assert_eq!(split_terminal("word"), None);
        assert_eq!(split_terminal("..."), Some(("", "...")));
        assert!(is_terminal_token("?\""));
    }

    #[test]
    fn parses_srt_and_vtt_rolling() {
        let dir = std::env::temp_dir().join("fe_test_subs");
        std::fs::create_dir_all(&dir).unwrap();
        let srt = dir.join("a.srt");
        std::fs::write(&srt, "1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> {\\an8}world\r\n \r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond &amp; last\r\n").unwrap();
        let s = read_sidecar(&srt).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].text, "Hello world");
        assert_eq!(s[1].text, "Second & last");

        let vtt = dir.join("b.vtt");
        std::fs::write(&vtt, "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n \nhello<00:00:00.500><c> world.</c>\n\n00:00:02.000 --> 00:00:02.010\nhello world.\n \n\n00:00:02.010 --> 00:00:04.000\nhello world.\nnext<00:00:03.000><c> one.</c>\n").unwrap();
        let s = read_sidecar(&vtt).unwrap();
        assert_eq!(s.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(), vec!["hello world.", "next one."]);

        let ass = dir.join("c.ass");
        std::fs::write(&ass, "[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi, there\\Nfriend\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 1 1\n").unwrap();
        let s = read_sidecar(&ass).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].text, "Hi, there friend");
    }
}
