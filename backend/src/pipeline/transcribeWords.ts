import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Word } from "./buildSentences.js";

const MODEL_RELATIVE_FROM_JOB_DIR = "../../models/ggml-base.en.bin";

/**
 * Runs ffmpeg's built-in `whisper` audio filter (whisper.cpp) against a 16kHz
 * mono wav file and returns word-level timestamps.
 *
 * Two ffmpeg-specific quirks drove the choices below:
 *  - `queue` is the filter's internal flush window; the default (3s) is far
 *    too short for good accuracy — short windows starve the model of context
 *    and produce garbled/hallucinated text. 30s gives much better accuracy
 *    while keeping memory bounded for long videos.
 *  - `max_len=1` forces whisper.cpp to emit near-word-level segments (its
 *    "word timestamp" trick), which is what lets us rebuild sentences from
 *    punctuation ourselves instead of trusting whisper's pause-based segments.
 *  - Windows drive-letter paths (e.g. `D:\...`) break the ffmpeg filter
 *    option parser, which treats `:` as a key=value separator. We dodge this
 *    entirely by running with `cwd` set to the job directory and passing the
 *    model path as a relative, forward-slashed path.
 */
export async function transcribeWords(params: {
  audioWavPath: string;
  jobDir: string;
  language?: string;
}): Promise<Word[]> {
  const { audioWavPath, jobDir, language = "en" } = params;
  const destinationName = "words.json";
  const destinationPath = path.join(jobDir, destinationName);

  const options = [
    `model=${MODEL_RELATIVE_FROM_JOB_DIR}`,
    `language=${language}`,
    "queue=30",
    "max_len=1",
    "format=json",
    `destination=${destinationName}`,
  ].join(":");
  const filter = `whisper=${options}`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-y", "-i", path.resolve(audioWavPath), "-af", filter, "-f", "null", "-"],
      { cwd: jobDir }
    );
    let stderrTail = "";
    proc.stderr.on("data", (c) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg whisper filter exited with code ${code}\n${stderrTail}`));
    });
  });

  const raw = await readFile(destinationPath, "utf-8");
  return parseWhisperWordStream(raw);
}

// Every object the whisper filter writes has this exact fixed shape.
// eslint-disable-next-line no-useless-escape
const WORD_OBJECT_RE = /^\{"start":(\d+),"end":(\d+),"text":"([\s\S]*)"\}$/;

/**
 * Parses the whisper filter's word-level JSON output leniently, based on its
 * known fixed schema, instead of trusting `JSON.parse` on each line.
 *
 * On longer videos this has been observed to break in two ways: (1) two
 * objects glued together with no separating newline, and (2) whisper
 * occasionally transcribing a bare quotation mark as its own "word", which
 * ffmpeg's JSON writer does not escape — producing a stray unescaped `"`
 * inside the `text` value that breaks strict JSON parsing. Splitting on the
 * literal `{"start":` marker (rather than newlines) fixes (1); matching the
 * fixed `{"start":N,"end":N,"text":"...".}` shape with a greedy capture for
 * `text` (rather than calling JSON.parse) fixes (2), since the regex anchors
 * on the *last* `"}` in the chunk regardless of quotes embedded earlier in
 * the text. A chunk that still doesn't fit the shape is skipped rather than
 * failing the whole transcription.
 */
export function parseWhisperWordStream(raw: string): Word[] {
  const chunks = raw
    .split(/(?=\{"start":)/)
    .map((c) => c.trim())
    .filter(Boolean);

  const words: Word[] = [];
  for (const chunk of chunks) {
    const match = chunk.match(WORD_OBJECT_RE);
    if (!match) continue;
    const [, startStr, endStr, textRaw] = match;
    const text = textRaw.replace(/\\(.)/g, "$1"); // undo \" \\ etc. escaping
    if (text.trim().length > 0) {
      words.push({ start: Number(startStr), end: Number(endStr), text });
    }
  }
  return words;
}
