import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadPanel, type UploadUiState } from "../../components/upload/UploadPanel";
import "../UploadPreview/UploadPreview.css";

interface JobStatusResponse {
  status: UploadUiState;
  percent: number;
  elapsedSeconds: number;
  errorMessage?: string;
}

export function Upload() {
  const navigate = useNavigate();
  const [state, setState] = useState<UploadUiState>("idle");
  const [percent, setPercent] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (!res.ok) throw new Error("查询任务状态失败");
          const data: JobStatusResponse = await res.json();
          setState(data.status);
          setPercent(data.percent);
          setElapsedSeconds(data.elapsedSeconds);
          if (data.status === "ready") {
            stopPolling();
            navigate(`/player/${jobId}`);
          } else if (data.status === "error") {
            stopPolling();
            setErrorMessage(data.errorMessage ?? "处理失败");
          }
        } catch (err) {
          stopPolling();
          setState("error");
          setErrorMessage(err instanceof Error ? err.message : String(err));
        }
      }, 1000);
    },
    [navigate, stopPolling]
  );

  const handleFileSelected = useCallback(
    (file: File) => {
      setFileName(file.name);
      setState("uploading");
      setPercent(0);
      setErrorMessage(undefined);

      const formData = new FormData();
      formData.append("video", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setPercent((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const { jobId } = JSON.parse(xhr.responseText);
          setState("transcoding");
          setPercent(0);
          pollJob(jobId);
        } else {
          setState("error");
          try {
            setErrorMessage(JSON.parse(xhr.responseText).error ?? "上传失败");
          } catch {
            setErrorMessage("上传失败");
          }
        }
      };
      xhr.onerror = () => {
        setState("error");
        setErrorMessage("网络错误，上传失败");
      };
      xhr.send(formData);
    },
    [pollJob]
  );

  const handleRetry = useCallback(() => {
    stopPolling();
    setState("idle");
    setErrorMessage(undefined);
    setFileName(undefined);
    setPercent(0);
    setElapsedSeconds(0);
  }, [stopPolling]);

  return (
    <div className="upload-preview">
      <div className="upload-preview__stage">
        <div className="upload-preview__card">
          <h1 className="upload-preview__app-title">FollowEnglish</h1>
          <p className="upload-preview__app-subtitle">上传视频，自动生成英文字幕，开始精听 / shadowing 练习</p>
          <UploadPanel
            state={state}
            percent={percent}
            elapsedSeconds={elapsedSeconds}
            errorMessage={errorMessage}
            fileName={fileName}
            onFileSelected={handleFileSelected}
            onRetry={handleRetry}
          />
        </div>
      </div>
    </div>
  );
}
