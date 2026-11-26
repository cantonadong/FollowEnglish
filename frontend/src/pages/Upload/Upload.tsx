import { useCallback, useEffect, useRef, useState } from "react";
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pickingRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

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

  const openLocal = async () => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setErrorMessage(undefined);
    setPercent(0);
    setElapsedSeconds(0);
    try {
      const response = await fetch("/api/open-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 204) {
        setState("idle");
        return;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法打开视频。");
      setState("preparing");
      pollJob(result.jobId);
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      pickingRef.current = false;
    }
  };

  const handleRetry = useCallback(() => {
    stopPolling();
    setState("idle");
    setErrorMessage(undefined);
    setPercent(0);
    setElapsedSeconds(0);
  }, [stopPolling]);

  return (
    <div className="upload-preview">
      <div className="upload-preview__stage">
        <div className="upload-preview__card">
          <h1 className="upload-preview__app-title">FollowEnglish</h1>
          <p className="upload-preview__app-subtitle">选择视频，自动加载同名字幕，开始精听 / shadowing 练习</p>
          <UploadPanel
            state={state}
            percent={percent}
            elapsedSeconds={elapsedSeconds}
            errorMessage={errorMessage}
            onOpenLocal={openLocal}
            onRetry={handleRetry}
          />
        </div>
      </div>
    </div>
  );
}
