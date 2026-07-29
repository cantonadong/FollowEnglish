import { useState } from "react";
import { PlayerView } from "../../components/player/PlayerView";
import {
  mockSentencesNormal,
  mockSentencesEdgeCase,
  mockSentencesEmpty,
} from "../../mocks/sentences";
import "./PlayerPreview.css";

type Scenario = "normal" | "loading" | "empty" | "error" | "edge-case";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "normal", label: "normal 正常" },
  { key: "loading", label: "loading 加载中" },
  { key: "empty", label: "empty 无字幕" },
  { key: "error", label: "error 加载失败" },
  { key: "edge-case", label: "edge-case 极端文本" },
];

const VIDEO_SRC = "/mock/sample.mp4";

export function PlayerPreview() {
  const [scenario, setScenario] = useState<Scenario>("normal");

  return (
    <div className="player-preview">
      <div className="player-preview__toolbar">
        <span className="player-preview__label">播放页 Preview　场景：</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            className={
              "player-preview__tab" + (scenario === s.key ? " player-preview__tab--active" : "")
            }
            onClick={() => setScenario(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="player-preview__stage">
        {scenario === "loading" && (
          <div className="player-preview__status">
            <div className="player-preview__spinner" />
            <p>正在加载视频与字幕…</p>
          </div>
        )}

        {scenario === "error" && (
          <div className="player-preview__status">
            <p>加载失败：无法获取字幕数据（模拟网络错误）</p>
            <button className="player-preview__retry" onClick={() => setScenario("normal")}>
              重试
            </button>
          </div>
        )}

        {scenario === "normal" && <PlayerView videoSrc={VIDEO_SRC} sentences={mockSentencesNormal} />}
        {scenario === "empty" && <PlayerView videoSrc={VIDEO_SRC} sentences={mockSentencesEmpty} />}
        {scenario === "edge-case" && (
          <PlayerView videoSrc={VIDEO_SRC} sentences={mockSentencesEdgeCase} />
        )}
      </div>
    </div>
  );
}
