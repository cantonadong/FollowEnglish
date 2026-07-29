import path from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { transcodeToMp4, extractAudioWav } from "./transcode.js";
import { transcribeWords } from "./transcribeWords.js";
import { buildSentences } from "./buildSentences.js";
import { updateJob } from "./jobStore.js";
import { persistSubtitles } from "./cache.js";
import { PROCESSED_DIR } from "./paths.js";

export async function runPipeline(jobId: string, originalPath: string): Promise<void> {
  const jobDir = path.join(PROCESSED_DIR, jobId);
  await mkdir(jobDir, { recursive: true });

  const videoPath = path.join(jobDir, "video.mp4");
  const audioPath = path.join(jobDir, "audio.wav");

  try {
    // A previous attempt for this exact content may have already produced
    // video.mp4/audio.wav before failing at a later stage (e.g. transcription
    // error) — skip the expensive steps that already succeeded on retry.
    if (!existsSync(videoPath)) {
      updateJob(jobId, { status: "transcoding", percent: 0 });
      await transcodeToMp4(originalPath, videoPath, (fraction) => {
        updateJob(jobId, { percent: Math.round(fraction * 100) });
      });
    }

    if (!existsSync(audioPath)) {
      await extractAudioWav(videoPath, audioPath);
    }

    updateJob(jobId, { status: "transcribing", percent: 0, elapsedSeconds: 0 });
    const startedAt = Date.now();
    const tick = setInterval(() => {
      updateJob(jobId, { elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) });
    }, 1000);

    let words;
    try {
      words = await transcribeWords({ audioWavPath: audioPath, jobDir });
    } finally {
      clearInterval(tick);
    }

    const sentences = buildSentences(words);
    await persistSubtitles(jobDir, sentences);

    updateJob(jobId, {
      status: "ready",
      percent: 100,
      videoPath,
      sentences,
    });
  } catch (err) {
    updateJob(jobId, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}
