import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { createJob, getJob, updateJob } from "../pipeline/jobStore.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import { hashFile } from "../pipeline/hashFile.js";
import { loadCachedResult } from "../pipeline/cache.js";
import { UPLOADS_DIR } from "../pipeline/paths.js";

mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".flv", ".webm", ".wmv"]);
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
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error(`不支持的文件格式：${ext}`));
      return;
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();

uploadRouter.post("/api/upload", (req, res) => {
  upload.single("video")(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "未收到文件" });
      return;
    }

    try {
      // Identify the video by content, not by upload event, so re-uploading
      // something already processed (even after a server restart) reuses the
      // existing transcode + subtitles instead of regenerating them.
      const contentHash = await hashFile(req.file.path);
      const ext = path.extname(req.file.filename);
      const canonicalPath = path.join(UPLOADS_DIR, `${contentHash}${ext}`);

      if (req.file.path !== canonicalPath) {
        if (existsSync(canonicalPath)) {
          await unlink(req.file.path); // identical content already stored once
        } else {
          await rename(req.file.path, canonicalPath);
        }
      }

      const jobId = contentHash;

      const existingJob = getJob(jobId);
      if (existingJob && existingJob.status !== "error") {
        // Already finished, or another upload of the same content is already
        // being processed — piggyback on it instead of starting over.
        res.json({ jobId });
        return;
      }

      const cached = await loadCachedResult(jobId);
      if (cached) {
        createJob(jobId);
        updateJob(jobId, {
          status: "ready",
          percent: 100,
          videoPath: cached.videoPath,
          sentences: cached.sentences,
        });
        res.json({ jobId });
        return;
      }

      createJob(jobId);
      void runPipeline(jobId, canonicalPath);
      res.json({ jobId });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
});
