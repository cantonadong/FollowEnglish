import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, existsSync } from "node:fs";
import { rename, stat, unlink } from "node:fs/promises";
import { createJob, getJob, updateJob } from "../pipeline/jobStore.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import { hashFile } from "../pipeline/hashFile.js";
import { loadCachedResult } from "../pipeline/cache.js";
import { UPLOADS_DIR } from "../pipeline/paths.js";

mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".avi", ".mkv", ".flv", ".webm", ".wmv"]);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, per docs/需求开发文档.md

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!(file.fieldname === "subtitle" ? [".srt", ".vtt", ".ass", ".ssa"].includes(ext) : ALLOWED_EXTENSIONS.has(ext))) {
      cb(new Error(`不支持的文件格式：${ext}`));
      return;
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();

async function openVideo(jobId: string, video: string, sidecar?: string, cleanup?: () => Promise<void>) {
  const cached = await loadCachedResult(jobId);
  const active = getJob(jobId);
  if (active && active.status !== "ready" && active.status !== "error") return;
  if (active?.status === "ready") return;
  createJob(jobId);
  if (cached) {
    updateJob(jobId, { ...cached, status: "ready", percent: 100 });
  } else {
    void runPipeline(jobId, video, sidecar).finally(cleanup);
    return true;
  }
}

let picking = false;
uploadRouter.post("/api/open-local", async (req, res) => {
  const port = req.socket.localPort;
  const origin = req.get("origin");
  if (!req.is("application/json") || (origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`)) {
    res.sendStatus(403);
    return;
  }
  if (picking) {
    res.status(409).json({ error: "视频选择窗口已打开。" });
    return;
  }
  picking = true;
  const picker = new AbortController();
  const stopPicker = () => {
    if (!res.writableEnded) picker.abort();
  };
  res.once("close", stopPicker);
  try {
    const { stdout } = await promisify(execFile)(path.resolve("../FollowEnglish.exe"), ["--pick-video"], { signal: picker.signal });
    const video = stdout.match(/^VIDEO_PATH=(.+)$/m)?.[1].trimEnd();
    if (!video) {
      res.sendStatus(204);
      return;
    }
    const { ext } = path.parse(video);
    if (!ALLOWED_EXTENSIONS.has(ext.toLowerCase())) {
      res.status(400).json({ error: "不支持的视频文件格式。" });
      return;
    }
    const file = await stat(video);
    const jobId = createHash("sha256").update(JSON.stringify([video.toLowerCase(), file.size, file.mtimeMs])).digest("hex");
    const job = getJob(jobId);
    if (!job || job.status === "ready" || job.status === "error") {
      createJob(jobId);
      void runPipeline(jobId, video, undefined, true);
    }
    res.json({ jobId });
  } catch (error) {
    if (!picker.signal.aborted) res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    res.off("close", stopPicker);
    picking = false;
  }
});

uploadRouter.post("/api/upload", (req, res) => {
  upload.fields([{ name: "video", maxCount: 1 }, { name: "subtitle", maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const video = files?.video?.[0];
    const sidecar = files?.subtitle?.[0];
    if (!video) {
      if (sidecar) await unlink(sidecar.path).catch(() => {});
      res.status(400).json({ error: "未收到文件" });
      return;
    }

    try {
      // Identify the video by content, not by upload event, so re-uploading
      // something already processed (even after a server restart) reuses the
      // existing transcode + subtitles instead of regenerating them.
      const contentHash = await hashFile(video.path);
      const ext = path.extname(video.filename);
      const canonicalPath = path.join(UPLOADS_DIR, `${contentHash}${ext}`);

      if (video.path !== canonicalPath) {
        if (existsSync(canonicalPath)) {
          await unlink(video.path); // identical content already stored once
        } else {
          await rename(video.path, canonicalPath);
        }
      }

      const jobId = sidecar ? `${contentHash}-${await hashFile(sidecar.path)}` : contentHash;
      const inUse = await openVideo(jobId, canonicalPath, sidecar?.path,
        sidecar && (() => unlink(sidecar.path).catch(() => {})));
      if (sidecar && !inUse) await unlink(sidecar.path);
      res.json({ jobId });
    } catch (e) {
      if (sidecar) await unlink(sidecar.path).catch(() => {});
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
});
