import type { Sentence } from "./buildSentences.js";

export type JobStatus = "uploading" | "preparing" | "remuxing" | "transcoding" | "transcribing" | "ready" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  percent: number;
  elapsedSeconds: number;
  errorMessage?: string;
  originalPath?: string;
  videoPath?: string;
  sentences?: Sentence[];
  subtitleSource?: string;
  subtitleWarning?: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();

export function createJob(id: string): Job {
  const job: Job = {
    id,
    status: "preparing",
    percent: 0,
    elapsedSeconds: 0,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}
