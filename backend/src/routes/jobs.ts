import { Router } from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createJob, getJob, updateJob, type Job } from "../pipeline/jobStore.js";
import { loadCachedResult, persistEditedSubtitles, persistSubtitles } from "../pipeline/cache.js";
import { desktopSubtitles } from "../pipeline/desktopSubtitles.js";

export const jobsRouter = Router();

// Falls back to the on-disk cache when the in-memory job store doesn't know
// this id — e.g. the backend restarted (jobStore is memory-only) but the
// browser still has a /player/:jobId link or reloads that page directly.
async function getOrAdoptJob(id: string): Promise<Job | undefined> {
  if (!/^[a-f0-9]{64}(?:-[a-f0-9]{64})?$/.test(id)) return undefined;
  const existing = getJob(id);
  if (existing) return existing;

  const cached = await loadCachedResult(id);
  if (!cached) return undefined;

  const source = await readFile(path.join(path.dirname(cached.videoPath), ".source.json"), "utf8")
    .then((raw) => JSON.parse(raw), () => undefined);
  const active = getJob(id);
  if (active) return active;
  const job = createJob(id);
  updateJob(id, {
    status: "ready",
    percent: 100,
    videoPath: cached.videoPath,
    sentences: cached.sentences,
    originalPath: source,
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
  if (job.status !== "ready" || !job.sentences || !job.videoPath) {
    res.status(409).json({ error: "字幕尚未生成完成" });
    return;
  }
  res.json({
    sentences: job.sentences, videoFile: path.basename(job.videoPath),
    canSelectSource: !!job.originalPath, source: job.subtitleSource, warning: job.subtitleWarning,
  });
});

const subtitleActions = new Map<string, AbortController>();
let recognitionJob: string | undefined;

jobsRouter.post("/api/jobs/:id/subtitle-source", async (req, res) => {
  const job = await getOrAdoptJob(req.params.id);
  const action = req.body?.source;
  if (!job?.originalPath || !job.videoPath || job.status !== "ready") {
    res.status(404).json({ error: "无法找到原始视频，请重新选择视频。" });
    return;
  }
  if (action === "cancel") {
    subtitleActions.get(job.id)?.abort();
    res.sendStatus(204);
    return;
  }
  if (!["embedded", "external", "recognize"].includes(action)) {
    res.status(400).json({ error: "无效的字幕来源。" });
    return;
  }
  if (subtitleActions.has(job.id) || (action === "recognize" && recognitionJob)) {
    res.status(409).json({ error: "已有字幕任务正在处理。" });
    return;
  }
  const controller = new AbortController();
  subtitleActions.set(job.id, controller);
  if (action === "recognize") recognitionJob = job.id;
  try {
    const result = await desktopSubtitles(job.originalPath, action, undefined, undefined, controller.signal);
    await persistSubtitles(path.dirname(job.videoPath), result.sentences);
    updateJob(job.id, { sentences: result.sentences, subtitleSource: result.source, subtitleWarning: result.warning });
    res.json(result);
  } catch (error) {
    if (controller.signal.aborted) res.sendStatus(204);
    else res.status(422).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    subtitleActions.delete(job.id);
    if (recognitionJob === job.id) recognitionJob = undefined;
  }
});

jobsRouter.patch("/api/jobs/:id/subtitles/:index", async (req, res) => {
  const job = await getOrAdoptJob(req.params.id);
  const index = Number(req.params.index);
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!job || job.status !== "ready" || !job.sentences || !job.videoPath) {
    res.status(404).json({ error: "字幕任务不存在" });
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= job.sentences.length || !text) {
    res.status(400).json({ error: "字幕内容无效" });
    return;
  }
  if (job.originalPath) {
    if (subtitleActions.has(job.id)) {
      res.status(409).json({ error: "字幕正在处理中。" });
      return;
    }
    subtitleActions.set(job.id, new AbortController());
    try {
      const result = await desktopSubtitles(job.originalPath, "edit", index, text);
      await persistSubtitles(path.dirname(job.videoPath), result.sentences);
      updateJob(job.id, { sentences: result.sentences, subtitleSource: result.source });
      res.json({ sentence: result.sentences[index] });
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      subtitleActions.delete(job.id);
    }
    return;
  }
  const sentences = job.sentences.map((sentence, i) =>
    i === index ? { ...sentence, text } : sentence
  );
  await persistEditedSubtitles(path.dirname(job.videoPath), sentences);
  updateJob(job.id, { sentences });
  res.json({ sentence: sentences[index] });
});
