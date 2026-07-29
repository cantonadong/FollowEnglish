import { spawn } from "node:child_process";
import readline from "node:readline";

export interface RunFfmpegOptions {
  args: string[];
  cwd?: string;
  /** called with a 0-1 fraction as progress is parsed from ffmpeg's -progress output */
  onProgress?: (fraction: number) => void;
  /** total duration of the input, in seconds — needed to turn out_time into a fraction */
  totalDurationSeconds?: number;
}

export function runFfmpeg({ args, cwd, onProgress, totalDurationSeconds }: RunFfmpegOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const fullArgs = onProgress ? [...args, "-progress", "pipe:1", "-nostats"] : args;
    const proc = spawn("ffmpeg", fullArgs, { cwd });

    let stderrTail = "";
    proc.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    if (onProgress && totalDurationSeconds && totalDurationSeconds > 0) {
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match) {
          const outSeconds = Number(match[1]) / 1_000_000;
          onProgress(Math.min(1, outSeconds / totalDurationSeconds));
        }
      });
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderrTail}`));
    });
  });
}

export function getMediaDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c.toString()));
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(parseFloat(out.trim()));
      else reject(new Error(`ffprobe exited with code ${code}\n${err}`));
    });
  });
}
