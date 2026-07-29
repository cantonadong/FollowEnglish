import { Router } from "express";
import { createJob, getJob, updateJob, type Job } from "../pipeline/jobStore.js";
import { loadCachedResult } from "../pipeline/cache.js";

export const jobsRouter = Router();

// Falls back to the on-disk cache when the in-memory job store doesn't know
// this id — e.g. the backend restarted (jobStore is memory-only) but the
// browser still has a /player/:jobId link or reloads that page directly.
async function getOrAdoptJob(id: string): Promise<Job | undefined> {
  const existing = getJob(id);
  if (existing) return existing;

  const cached = await loadCachedResult(id);
  if (!cached) return undefined;

  const job = createJob(id);
  updateJob(id, {
    status: "ready",
    percent: 100,
    videoPath: cached.videoPath,
    sentences: cached.sentences,
  });
  return getJob(id) ?? job;
}

jobsRouter.get("/api/jobs/:id", async (req, res) => {
  const job = await getOrAdoptJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  res.json({
    status: job.status,
    percent: job.percent,
    elapsedSeconds: job.elapsedSeconds,
    errorMessage: job.errorMessage,
  });
});

jobsRouter.get("/api/jobs/:id/subtitles", async (req, res) => {
  const job = await getOrAdoptJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  if (job.status !== "ready" || !job.sentences) {
    res.status(409).json({ error: "字幕尚未生成完成" });
    return;
  }
  res.json({ sentences: job.sentences });
});
