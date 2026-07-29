export interface Sentence {
  index: number;
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  text: string;
}

export type JobStatus =
  | "uploading"
  | "transcoding"
  | "transcribing"
  | "ready"
  | "error";

export interface JobProgress {
  status: JobStatus;
  /** 0-100, only meaningful for uploading/transcoding */
  percent?: number;
  /** seconds elapsed, used for transcribing (no exact percent available) */
  elapsedSeconds?: number;
  errorMessage?: string;
}
