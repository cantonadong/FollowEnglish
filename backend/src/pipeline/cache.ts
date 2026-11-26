import path from "node:path";
import { access, readFile, writeFile } from "node:fs/promises";
import { buildSentences, type Sentence } from "./buildSentences.js";
import { parseWhisperWordStream } from "./transcribeWords.js";
import { PROCESSED_DIR } from "./paths.js";
import { cachedVideoPath } from "./transcode.js";

export interface CachedResult {
  videoPath: string;
  sentences: Sentence[];
}

/**
 * Looks for a previously-completed result for this content hash on disk, so
 * re-uploading the same video (even after a server restart, when the
 * in-memory job store is empty) skips transcoding + transcription entirely.
 */
export async function loadCachedResult(id: string): Promise<CachedResult | null> {
  const jobDir = path.join(PROCESSED_DIR, id);
  const videoPath = cachedVideoPath(jobDir);
  if (!videoPath) return null;
  const subtitlesPath = path.join(jobDir, "subtitles.json");
  try {
    const raw = await readFile(subtitlesPath, "utf-8");
    let sentences: Sentence[] = JSON.parse(raw);

    // words.json is the source of truth. Rebuilding also repairs subtitle
    // caches produced by older/incorrect sentence-joining logic.
    try {
      await access(path.join(jobDir, "subtitles.edited"));
    } catch {
      try {
        const wordsRaw = await readFile(path.join(jobDir, "words.json"), "utf-8");
        const rebuilt = buildSentences(parseWhisperWordStream(wordsRaw));
        if (JSON.stringify(rebuilt) !== JSON.stringify(sentences)) {
          sentences = rebuilt;
          await persistSubtitles(jobDir, sentences);
        }
      } catch {
        // Some legacy caches do not include the word timestamp stream.
      }
    }
    return { videoPath, sentences };
  } catch {
    return null;
  }
}

export async function persistSubtitles(jobDir: string, sentences: Sentence[]): Promise<void> {
  await writeFile(path.join(jobDir, "subtitles.json"), JSON.stringify(sentences), "utf-8");
}

export async function persistEditedSubtitles(jobDir: string, sentences: Sentence[]): Promise<void> {
  await persistSubtitles(jobDir, sentences);
  await writeFile(path.join(jobDir, "subtitles.edited"), "", "utf-8");
}
