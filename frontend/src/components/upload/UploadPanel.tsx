import { useCallback, useRef, useState } from "react";
import type { JobStatus } from "../../types";
import "./UploadPanel.css";

export type UploadUiState = "idle" | JobStatus;

const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".flv", ".webm", ".wmv"];

interface Props {
  state: UploadUiState;
  percent?: number;
  elapsedSeconds?: number;
  errorMessage?: string;
  fileName?: string;
  onFileSelected: (file: File) => void;
  onRetry: () => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function StageLabel({ state }: { state: UploadUiState }) {
  const labels: Record<UploadUiState, string> = {
    idle: "",
    uploading: "正在上传视频…",
    transcoding: "正在转码视频…",
    transcribing: "正在识别英文字幕…",
    ready: "处理完成，正在进入播放页…",
    error: "处理失败",
  };
  return <p className="upload-panel__stage-label">{labels[state]}</p>;
}

export function UploadPanel({
  state,
  percent = 0,
  elapsedSeconds = 0,
  errorMessage,
  fileName,
  onFileSelected,
  onRetry,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (files && files[0]) onFileSelected(files[0]);
    },
    [onFileSelected]
  );

  if (state === "idle") {
    return (
      <div
        className={"upload-panel__dropzone" + (dragOver ? " upload-panel__dropzone--over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="upload-panel__icon">⬆</div>
        <p className="upload-panel__title">拖拽视频文件到此处，或点击选择</p>
        <p className="upload-panel__hint">
          支持格式：{ACCEPTED_EXTENSIONS.map((e) => e.slice(1)).join(" / ")}
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="upload-panel__status upload-panel__status--error">
        <div className="upload-panel__icon upload-panel__icon--error">⚠</div>
        <p className="upload-panel__title">处理失败</p>
        <p className="upload-panel__hint">{errorMessage ?? "未知错误，请重试"}</p>
        <button className="upload-panel__retry" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="upload-panel__status">
      {fileName && <p className="upload-panel__filename">{fileName}</p>}

      {(state === "uploading" || state === "transcoding") && (
        <>
          <div className="upload-panel__progress-track">
            <div className="upload-panel__progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="upload-panel__percent">{Math.round(percent)}%</p>
        </>
      )}

      {state === "transcribing" && (
        <>
          <div className="upload-panel__spinner" />
          <p className="upload-panel__elapsed">已用时 {formatElapsed(elapsedSeconds)}</p>
        </>
      )}

      {state === "ready" && <div className="upload-panel__spinner" />}

      <StageLabel state={state} />
    </div>
  );
}
