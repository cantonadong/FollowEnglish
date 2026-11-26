//! ffmpeg / ffprobe helpers: embedded subtitle extraction and offline speech recognition.

use crate::store::{app_dir, data_dir, fnv, path_key};
use crate::subs::{build_sentences, parse_whisper_words, to_srt, Sentence};
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const MODEL_REL: &str = "models/ggml-base.en.bin";

pub fn tool(name: &str) -> Result<PathBuf, String> {
    let env = format!("{}_PATH", name.to_uppercase());
    if let Some(p) = std::env::var_os(&env) {
        return Ok(PathBuf::from(p));
    }
    let file = format!("{name}.exe");
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(f) = std::env::var_os("FFMPEG_PATH") {
        if let Some(d) = Path::new(&f).parent() {
            dirs.push(d.to_path_buf());
        }
    }
    dirs.push(app_dir().to_path_buf());
    dirs.push(app_dir().join("ffmpeg"));
    if let Some(p) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    for d in dirs {
        let c = PathBuf::from(d.to_string_lossy().trim_matches('"')).join(&file);
        if c.is_file() {
            return Ok(c);
        }
    }
    Err(format!(
        "找不到 {file}。请安装包含 ffmpeg 和 ffprobe 的完整版本，并将其 bin 目录加入 PATH 后重新启动 FollowEnglish；也可通过 {env} 指定程序完整路径。"
    ))
}

fn command(name: &str) -> Result<Command, String> {
    let mut c = Command::new(tool(name)?);
    c.creation_flags(CREATE_NO_WINDOW).stdin(Stdio::null());
    Ok(c)
}

/// Runs a child to completion, returning a stderr tail on failure.
fn run(mut child: Child, slot: Option<&Mutex<Option<Child>>>) -> Result<(), String> {
    let mut err = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(e) = err.as_mut() {
            let mut chunk = [0u8; 4096];
            while let Ok(n) = e.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > 8000 {
                    buf.drain(..buf.len() - 4000);
                }
            }
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let status = match slot {
        Some(s) => {
            *s.lock().unwrap() = Some(child);
            // Poll so cancel() can kill it while we wait.
            loop {
                let mut g = s.lock().unwrap();
                match g.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(Some(st))) => {
                        *g = None;
                        break st;
                    }
                    Some(Ok(None)) => {}
                    Some(Err(e)) => return Err(e.to_string()),
                    None => return Err("进程已结束".into()),
                }
                drop(g);
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
        None => child.wait().map_err(|e| e.to_string())?,
    };
    let tail = reader.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(format!("ffmpeg 退出码 {:?}\n{}", status.code(), tail.trim()))
    }
}

/// Extracts the preferred (English first) embedded text subtitle track.
/// The result is cached per file version under data/embedded.
pub fn embedded(video: &Path) -> Result<Option<PathBuf>, String> {
    let meta = std::fs::metadata(video).map_err(|e| e.to_string())?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
    let dir = data_dir().join("embedded");
    let _ = std::fs::create_dir_all(&dir);
    let base = dir.join(fnv(&format!("{}|{}|{}", path_key(video), meta.len(), mtime)));
    if base.with_extension("none").exists() {
        return Ok(None);
    }
    for ext in ["srt", "vtt", "ass"] {
        let p = base.with_extension(ext);
        if p.is_file() {
            return Ok(Some(p));
        }
    }
    let out = command("ffprobe")?
        .args(["-v", "error", "-select_streams", "s", "-show_entries", "stream=index,codec_name:stream_tags=language", "-of", "json"])
        .arg(video)
        .output()
        .map_err(|e| format!("ffprobe 运行失败：{e}"))?;
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
    let supported = ["webvtt", "subrip", "ass", "ssa", "mov_text", "text"];
    let streams: Vec<&serde_json::Value> = json["streams"]
        .as_array()
        .map(|a| a.iter().filter(|s| supported.contains(&s["codec_name"].as_str().unwrap_or(""))).collect())
        .unwrap_or_default();
    let is_en = |s: &serde_json::Value| {
        let l = s["tags"]["language"].as_str().unwrap_or("").to_lowercase();
        ["eng", "en"].iter().any(|p| l == *p || l.starts_with(&format!("{p}-")) || l.starts_with(&format!("{p}_")))
    };
    let Some(stream) = streams.iter().copied().find(|s| is_en(s)).or(streams.first().copied()) else {
        let _ = std::fs::write(base.with_extension("none"), b"");
        return Ok(None);
    };
    let codec = stream["codec_name"].as_str().unwrap_or("");
    let ext = match codec {
        "webvtt" => "vtt",
        "ass" | "ssa" => "ass",
        _ => "srt",
    };
    let target = base.with_extension(ext);
    let tmp = base.with_extension(format!("tmp.{ext}"));
    let c = if matches!(codec, "mov_text" | "text") { "srt" } else { "copy" };
    let child = command("ffmpeg")?
        .args(["-y", "-copyts", "-i"])
        .arg(video)
        .args(["-map", &format!("0:{}", stream["index"].as_i64().unwrap_or(0)), "-vn", "-an", "-dn", "-c:s", c])
        .arg(&tmp)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg 运行失败：{e}"))?;
    run(child, None)?;
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(Some(target))
}

#[derive(Default)]
pub struct Cancel {
    pub flag: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl Cancel {
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        if let Some(c) = self.child.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
    }
    fn cancelled(&self) -> Result<(), String> {
        if self.flag.load(Ordering::SeqCst) {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }
}
pub const CANCELLED: &str = "识别已取消";

/// Local whisper.cpp recognition through ffmpeg's `whisper` filter.
/// Writes `<video>.srt` (or `<video>_N.srt`) beside the video without overwriting.
pub fn recognize(video: &Path, cancel: &Cancel) -> Result<(PathBuf, Vec<Sentence>), String> {
    if !app_dir().join(MODEL_REL).is_file() {
        return Err(format!("缺少语音识别模型：{}（请从 huggingface.co/ggerganov/whisper.cpp 下载 ggml-base.en.bin）", app_dir().join(MODEL_REL).display()));
    }
    cancel.cancelled()?;
    // Filter options use ':' as separator, so pass colon-free relative paths with cwd = app dir.
    let _ = data_dir();
    let rel = format!("data/whisper-{}.json", std::process::id());
    let dest = app_dir().join(&rel);
    let _ = std::fs::remove_file(&dest);
    let filter = format!("aresample=16000,whisper=model={MODEL_REL}:language=en:queue=30:max_len=1:format=json:destination={rel}");
    let child = command("ffmpeg")?
        .current_dir(app_dir())
        .args(["-nostdin", "-y", "-i"])
        .arg(video)
        .args(["-vn", "-sn", "-dn", "-af", &filter, "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg 运行失败：{e}"))?;
    let result = run(child, Some(&cancel.child));
    cancel.cancelled().inspect_err(|_| {
        let _ = std::fs::remove_file(&dest);
    })?;
    result?;
    let raw = std::fs::read_to_string(&dest).unwrap_or_default();
    let _ = std::fs::remove_file(&dest);
    let sentences = build_sentences(parse_whisper_words(&raw));
    if sentences.is_empty() {
        return Err("未识别到有效字幕，请重试".into());
    }
    cancel.cancelled()?;
    let stem = video.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = video.parent().unwrap_or(Path::new("."));
    let text = to_srt(&sentences);
    for suffix in 0.. {
        let name = if suffix == 0 { format!("{stem}.srt") } else { format!("{stem}_{suffix}.srt") };
        let p = dir.join(name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
                return Ok((p, sentences));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("写入字幕失败：{e}")),
        }
    }
    unreachable!()
}
