import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PlayerView } from "../../components/player/PlayerView";
import type { Sentence } from "../../types";
import "../PlayerPreview/PlayerPreview.css";

export function Player() {
  const { jobId } = useParams<{ jobId: string }>();
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    fetch(`/api/jobs/${jobId}/subtitles`)
      .then((res) => {
        if (!res.ok) throw new Error("字幕数据获取失败");
        return res.json();
      })
      .then((data: { sentences: Sentence[] }) => {
        if (!cancelled) setSentences(data.sentences);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <div className="player-preview">
      <div className="player-preview__stage">
        {error && (
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
        {!error && sentences && (
          <PlayerView videoSrc={`/media/${jobId}/video.mp4`} sentences={sentences} />
        )}
      </div>
    </div>
  );
}
