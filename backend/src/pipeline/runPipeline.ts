import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { prepareVideo } from "./transcode.js";
import { updateJob } from "./jobStore.js";
import { persistSubtitles } from "./cache.js";
import { PROCESSED_DIR } from "./paths.js";
import { runFfmpeg } from "./ffmpegUtils.js";
import type { Sentence } from "./buildSentences.js";
import { desktopSubtitles } from "./desktopSubtitles.js";

async function readSidecar(file: string, jobDir: string): Promise<Sentence[]> {
  const temporary = path.join(jobDir, "sidecar.partial.srt");
  try {
    await runFfmpeg({ args: ["-y", "-i", file, "-map", "0:s:0", temporary] });
    const text = (await readFile(temporary, "utf8")).replace(/\r/g, "");
    const sentences: Sentence[] = [];
    const seconds = (time: string) => time.replace(",", ".").split(":")
      .reduce((total, part) => total * 60 + Number(part), 0);
    for (const cue of text.trim().split(/\n\s*\n/)) {
      const match = cue.match(/^(?:\d+\n)?(\d+:\d{2}:\d{2},\d{3}) --> (\d+:\d{2}:\d{2},\d{3})[^\n]*\n([\s\S]+)$/);
      if (match) {
        const caption = match[3].replace(/<\/?(?:i|b|u|font)(?:\s[^>]*)?>/gi, "").trim();
        if (caption) sentences.push({ index: sentences.length, start: seconds(match[1]), end: seconds(match[2]), text: caption });
      }
    }
    if (!sentences.length) throw new Error("同名字幕文件没有可读取的字幕。");
    return sentences;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runPipeline(jobId: string, originalPath: string, sidecar?: string, desktop = false): Promise<void> {
  const jobDir = path.join(PROCESSED_DIR, jobId);

  try {
    await mkdir(jobDir, { recursive: true });
    const videoPath = await prepareVideo(originalPath, jobDir, (fraction, remuxing) => {
      updateJob(jobId, {
        status: remuxing ? "remuxing" : "transcoding",
        percent: Math.round(fraction * 100),
      });
    });

    if (desktop) {
      const result = await desktopSubtitles(originalPath);
      await writeFile(path.join(jobDir, ".source.json"), JSON.stringify(originalPath));
      await persistSubtitles(jobDir, result.sentences);
      updateJob(jobId, { status: "ready", percent: 100, videoPath, originalPath, sentences: result.sentences, subtitleWarning: result.warning, subtitleSource: result.source });
      return;
    }

    const sentences = sidecar ? await readSidecar(sidecar, jobDir) : [];
    await persistSubtitles(jobDir, sentences);
    updateJob(jobId, { status: "ready", percent: 100, videoPath, sentences });
  } catch (err) {
    updateJob(jobId, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}
