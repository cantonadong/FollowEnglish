import path from "node:path";
import { existsSync } from "node:fs";
import { copyFile, link, rename, rm } from "node:fs/promises";
import { runFfmpeg, probeMedia } from "./ffmpegUtils.js";

export function cachedVideoPath(jobDir: string): string | undefined {
  return ["video.mp4", "video.webm"]
    .map((name) => path.join(jobDir, name))
    .find((file) => existsSync(file));
}

export async function prepareVideo(
  inputPath: string,
  jobDir: string,
  onProgress: (fraction: number, remuxing: boolean) => void
): Promise<string> {
  const cached = cachedVideoPath(jobDir);
  if (cached) return cached;

  const { format, streams } = await probeMedia(inputPath);
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("No video stream found");

  // shortcut: conservative browser codec list, expand when playback support is verified.
  const copyVideo = video.codec_name === "h264" && video.pix_fmt === "yuv420p";
  const copyAudio = !audio || audio.codec_name === "aac";
  const webmCompatible = ["vp8", "vp9"].includes(video.codec_name) && video.pix_fmt === "yuv420p"
    && (!audio || ["opus", "vorbis"].includes(audio.codec_name));
  const ext = path.extname(inputPath).toLowerCase();
  const formats = format.format_name.split(",");
  const directMp4 = [".mp4", ".m4v"].includes(ext) && formats.includes("mp4") && copyVideo && copyAudio;
  const directWebm = ext === ".webm" && formats.includes("webm") && webmCompatible;
  const outputExt = webmCompatible ? "webm" : "mp4";
  const outputPath = path.join(jobDir, `video.${outputExt}`);
  const temporary = path.join(jobDir, `video.partial.${outputExt}`);

  if (directMp4 || directWebm) {
    try {
      await link(inputPath, outputPath);
    } catch (error) {
      if (!["EXDEV", "EPERM", "ENOTSUP", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      try {
        await copyFile(inputPath, temporary);
        await rename(temporary, outputPath);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    return outputPath;
  }

  const videoArgs = copyVideo || webmCompatible
    ? ["-c:v", "copy"]
    : ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
       "-force_key_frames", "expr:gte(t,n_forced*1)"];
  try {
    const remuxing = webmCompatible || (copyVideo && copyAudio);
    onProgress(0, remuxing);
    await runFfmpeg({
      args: [
        "-y", "-i", inputPath, "-map", `0:${video.index}`,
        ...(audio ? ["-map", `0:${audio.index}`, "-c:a", copyAudio || webmCompatible ? "copy" : "aac"] : []),
        ...videoArgs, ...(outputExt === "mp4" ? ["-movflags", "+faststart"] : []), temporary,
      ],
      onProgress: (fraction) => onProgress(fraction, remuxing),
      totalDurationSeconds: Number(format.duration),
    });
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return outputPath;
}

export async function extractAudioWav(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg({
    args: ["-y", "-i", inputPath, "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath],
  });
}
