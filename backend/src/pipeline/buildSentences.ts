export interface Word {
  /** ms */
  start: number;
  /** ms */
  end: number;
  text: string;
}

export interface Sentence {
  index: number;
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  text: string;
}

const SENTENCE_END_RE = /^[.!?]+["')\]]*$/;
const CLAUSE_BREAK_RE = /,$/;

// Common abbreviations whose trailing "." must not be treated as a sentence end.
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "jr",
  "sr",
  "no",
]);

// A sentence forced to split for length gets these caps; real sentence-ending
// punctuation is always honored regardless of length.
const MAX_SENTENCE_MS = 15_000;
const MAX_SENTENCE_WORDS = 30;

function isSentenceEnd(token: string, prevWord: string): boolean {
  if (!SENTENCE_END_RE.test(token)) return false;
  if (token === "." && ABBREVIATIONS.has(prevWord.toLowerCase().replace(/[^a-z.]/gi, ""))) {
    return false;
  }
  return true;
}

/**
 * Drops words whose timestamps regress relative to what's already been
 * accepted. ffmpeg's whisper filter processes long audio in independent
 * `queue`-sized windows, and at nearly every window boundary it has been
 * observed to hallucinate a short "BLANK_AUDIO"-style artifact (split into
 * word-ish fragments by `max_len=1`, e.g. "BL"/"ANK"/"AUD"/"IO") whose
 * timestamps run ahead of the real speech that actually follows — e.g. the
 * hallucination lands at 30530-34370ms while the real next sentence starts
 * at 30192ms. Left in, this both corrupts the sentence's text (garbage
 * fragments prepended) and its start time (taken from the hallucination,
 * not the real first word), which throws off prev/next navigation for that
 * sentence and its neighbors.
 *
 * Fix: whenever a word's start is earlier than an already-accepted word, the
 * earlier-accepted word(s) were the hallucination (real speech is always
 * chronological) — pop them back off before accepting the current word. In
 * the normal case (no anomaly) timestamps are already non-decreasing, so
 * this never touches legitimate words.
 */
function sanitizeWordTimestamps(words: Word[]): Word[] {
  const result: Word[] = [];
  for (const w of words) {
    while (result.length > 0 && result[result.length - 1].start > w.start) {
      result.pop();
    }
    result.push(w);
  }
  return result;
}

function joinWords(words: Word[]): string {
  let out = "";
  for (const w of words) {
    if (out.length === 0) {
      out = w.text;
    } else if (/^[.,!?;:]/.test(w.text)) {
      out += w.text;
    } else {
      out += " " + w.text;
    }
  }
  return out.trim();
}

/**
 * Reconstructs grammatically complete sentences from a whisper.cpp word-level
 * timestamp stream (produced with `max_len=1`). Sentence boundaries are driven
 * by terminal punctuation, not by whisper's own (pause-based) segmentation —
 * so a sentence is never cut just because the ASR engine paused mid-clause.
 * Only sentences that run long are force-split, and only at a comma.
 */
export function buildSentences(rawWords: Word[]): Sentence[] {
  const words = sanitizeWordTimestamps(rawWords);
  const sentences: Sentence[] = [];
  let current: Word[] = [];
  let lastCommaBreakIdx = -1; // index within `current` of the most recent comma token

  function flush(endIdx: number) {
    if (current.length === 0) return;
    const slice = current.slice(0, endIdx + 1);
    sentences.push({
      index: sentences.length,
      start: slice[0].start / 1000,
      end: slice[slice.length - 1].end / 1000,
      text: joinWords(slice),
    });
    current = current.slice(endIdx + 1);
    lastCommaBreakIdx = -1;
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    current.push(w);
    const idx = current.length - 1;
    const prevWord = current.length >= 2 ? current[current.length - 2].text : "";

    if (CLAUSE_BREAK_RE.test(w.text)) {
      lastCommaBreakIdx = idx;
    }

    if (isSentenceEnd(w.text, prevWord)) {
      flush(idx);
      continue;
    }

    const durationMs = w.end - current[0].start;
    const tooLong = durationMs > MAX_SENTENCE_MS || current.length > MAX_SENTENCE_WORDS;
    if (tooLong && lastCommaBreakIdx >= 0) {
      flush(lastCommaBreakIdx);
    }
  }

  if (current.length > 0) {
    flush(current.length - 1);
  }

  return sentences.filter((s) => s.text.length > 0);
}
