import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
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
    } else {
      proc.stdout.resume();
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderrTail}`));
    });
  });
}

export async function probeMedia(filePath: string) {
  const { stdout } = await promisify(execFile)("ffprobe", [
    "-v", "error", "-show_entries",
    "format=format_name,duration:stream=index,codec_type,codec_name,pix_fmt:stream_disposition=attached_pic",
    "-of", "json", filePath,
  ]);
  return JSON.parse(stdout) as {
    format: { format_name: string; duration?: string };
    streams: {
      index: number;
      codec_type: string;
      codec_name: string;
      pix_fmt?: string;
      disposition?: { attached_pic?: number };
    }[];
  };
}
