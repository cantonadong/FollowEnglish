import path from "node:path";
import { execFile } from "node:child_process";
import type { Sentence } from "./buildSentences.js";

interface Result {
  sentences: Sentence[];
  warning?: string;
  source?: string;
}

export function desktopSubtitles(video: string, action = "resolve", index?: number, text?: string, signal?: AbortSignal) {
  return new Promise<Result>((resolve, reject) => {
    const child = execFile(
      path.resolve("../target/release/FollowEnglish-subtitles.exe"),
      ["--web-subtitles", action, video, ...(index === undefined ? [] : [String(index)])],
      { env: { ...process.env, FOLLOWENGLISH_APP_DIR: path.resolve("..") }, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        signal?.removeEventListener("abort", cancel);
        if (error) {
          reject(error);
          return;
        }
        try {
          const encoded = stdout.split(/\r?\n/).find((line) => line.startsWith("FOLLOWENGLISH_SUBTITLES="));
          if (!encoded) throw new Error("字幕引擎未返回结果");
          const result = JSON.parse(encoded.slice("FOLLOWENGLISH_SUBTITLES=".length));
          if (result.error) throw new Error(result.error);
          resolve({
            ...result,
            sentences: result.sentences.map((sentence: Omit<Sentence, "index">, i: number) => ({ ...sentence, index: i })),
          });
        } catch (error) {
          reject(error);
        }
      }
    );
    const cancel = () => child.stdin?.end("cancel\n");
    child.stdin?.on("error", () => {});
    if (action === "recognize") {
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
    } else {
      child.stdin?.end(text === undefined ? undefined : JSON.stringify(text));
    }
  });
}
