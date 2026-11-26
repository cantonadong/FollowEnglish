import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PlayerView } from "../../components/player/PlayerView";
import type { Sentence } from "../../types";
import "../PlayerPreview/PlayerPreview.css";

export function Player() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { key: locationKey } = useLocation();
  const [activeJobId, setActiveJobId] = useState<string>();
  const activeJob = useRef<string>(undefined);
  const openRequest = useRef<AbortController | null>(null);
  const [opening, setOpening] = useState(false);
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [videoFile, setVideoFile] = useState("video.mp4");
  const [error, setError] = useState<string | null>(null);
  const [canSelectSource, setCanSelectSource] = useState(false);
  const [sourceAction, setSourceAction] = useState("");
  const [sourceWarning, setSourceWarning] = useState("");
  const [openError, setOpenError] = useState("");

  useEffect(() => () => openRequest.current?.abort(), []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    fetch(`/api/jobs/${jobId}/subtitles`)
      .then((res) => {
        if (!res.ok) throw new Error("字幕数据获取失败");
        return res.json();
      })
      .then((data: { sentences: Sentence[]; videoFile?: string; canSelectSource?: boolean; warning?: string }) => {
        if (!cancelled) {
          activeJob.current = jobId;
          setActiveJobId(jobId);
          setError(null);
          setVideoFile(data.videoFile ?? "video.mp4");
          setSentences(data.sentences);
          setCanSelectSource(!!data.canSelectSource);
          setSourceAction("");
          setSourceWarning(data.warning ?? "");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, locationKey]);

  const openVideo = async () => {
    if (openRequest.current) return;
    const request = new AbortController();
    openRequest.current = request;
    setOpening(true);
    setOpenError("");
    try {
      const response = await fetch("/api/open-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: request.signal,
      });
      if (response.status === 204) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法打开视频。");
      while (!request.signal.aborted) {
        const status = await fetch(`/api/jobs/${result.jobId}`, { signal: request.signal });
        if (!status.ok) throw new Error("查询任务状态失败");
        const job = await status.json();
        if (request.signal.aborted) return;
        if (job.status === "ready") {
          navigate(`/player/${result.jobId}`);
          return;
        }
        if (job.status === "error") throw new Error(job.errorMessage ?? "处理失败");
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (!request.signal.aborted) setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      openRequest.current = null;
      if (!request.signal.aborted) setOpening(false);
    }
  };

  const selectSource = async (source: string) => {
    if (source !== "cancel") setSourceAction(source);
    setSourceWarning("");
    try {
      const response = await fetch(`/api/jobs/${activeJobId}/subtitle-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (response.status === 204) return;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (activeJob.current !== activeJobId) return;
      setSentences(data.sentences);
      setSourceWarning(data.warning ?? "");
    } catch (error) {
      if (activeJob.current === activeJobId) setSourceWarning(error instanceof Error ? error.message : String(error));
    } finally {
      if (source !== "cancel" && activeJob.current === activeJobId) setSourceAction("");
    }
  };

  return (
    <div className="player-preview">
      <div className="player-preview__stage">
        {error && !sentences && (
          <div className="player-preview__status">
            <p>加载失败：{error}</p>
          </div>
        )}
        {!error && !sentences && (
          <div className="player-preview__status">
            <div className="player-preview__spinner" />
            <p>正在加载视频与字幕…</p>
          </div>
        )}
        {sentences && (
          <PlayerView
            key={activeJobId}
            videoSrc={`/media/${activeJobId}/${videoFile}`}
            positionStorageKey={activeJobId}
            sentences={sentences}
            subtitleControls={<>
              <button className="controls-bar__btn" disabled={opening} onClick={() => void openVideo()}>打开视频</button>
              {(openError || error) && <span role="alert">{openError || error}</span>}
              {canSelectSource && (sourceAction === "recognize"
                ? <button className="controls-bar__btn" onClick={() => void selectSource("cancel")}>取消识别</button>
                : <select className="controls-bar__btn" aria-label="字幕设置" value="" disabled={!!sourceAction}
                    onChange={(event) => void selectSource(event.target.value)}>
                    <option value="" disabled>字幕设置</option>
                    <option value="external">同名外置字幕</option>
                    <option value="embedded">内置字幕</option>
                    <option value="recognize">离线识别字幕</option>
                  </select>)}
              {sourceWarning && <span role="alert">{sourceWarning}</span>}
            </>}
            onSaveSentence={async (index, text) => {
              const response = await fetch(`/api/jobs/${activeJobId}/subtitles/${index}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
              });
              if (!response.ok) throw new Error("字幕保存失败");
              if (activeJob.current !== activeJobId) return;
              setSentences((current) =>
                current?.map((sentence, i) => (i === index ? { ...sentence, text } : sentence)) ?? null
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
