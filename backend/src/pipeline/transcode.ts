import { runFfmpeg, getMediaDurationSeconds } from "./ffmpegUtils.js";

export async function transcodeToMp4(
  inputPath: string,
  outputPath: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const totalDurationSeconds = await getMediaDurationSeconds(inputPath);
  await runFfmpeg({
    args: [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      // Force a keyframe every ~1s of PTS time regardless of frame rate.
      // libx264's default GOP can space keyframes several seconds apart,
      // which made seeking to short sentence boundaries land imprecisely
      // (the browser has to decode forward from a distant keyframe) — this
      // app's whole interaction model depends on frequent precise seeks.
      "-force_key_frames",
      "expr:gte(t,n_forced*1)",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    onProgress,
    totalDurationSeconds,
  });
}

export async function extractAudioWav(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg({
    args: ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath],
  });
}
