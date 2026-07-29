import path from "node:path";
import { access, readFile, writeFile } from "node:fs/promises";
import type { Sentence } from "./buildSentences.js";
import { PROCESSED_DIR } from "./paths.js";

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
  const videoPath = path.join(jobDir, "video.mp4");
  const subtitlesPath = path.join(jobDir, "subtitles.json");
  try {
    await access(videoPath);
    const raw = await readFile(subtitlesPath, "utf-8");
    const sentences: Sentence[] = JSON.parse(raw);
    return { videoPath, sentences };
  } catch {
    return null;
  }
}

export async function persistSubtitles(jobDir: string, sentences: Sentence[]): Promise<void> {
  await writeFile(path.join(jobDir, "subtitles.json"), JSON.stringify(sentences), "utf-8");
}
