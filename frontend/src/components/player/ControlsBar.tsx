interface Props {
  playing: boolean;
  currentTime: number;
  duration: number;
  sentenceIndex: number; // 0-based, -1 if none
  sentenceCount: number;
  subtitleVisible: boolean;
  repeatEnabled: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onToggleSubtitle: () => void;
  onToggleRepeat: () => void;
  onFontDecrease: () => void;
  onFontIncrease: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ControlsBar({
  playing,
  currentTime,
  duration,
  sentenceIndex,
  sentenceCount,
  subtitleVisible,
  repeatEnabled,
  onTogglePlay,
  onSeek,
  onToggleSubtitle,
  onToggleRepeat,
  onFontDecrease,
  onFontIncrease,
}: Props) {
  return (
    <div className="controls-bar">
      <button
        className="controls-bar__btn controls-bar__btn--play"
        onClick={onTogglePlay}
        aria-label={playing ? "暂停" : "播放"}
        title="空格：播放/暂停"
      >
        {playing ? "⏸" : "▶"}
      </button>

      <span className="controls-bar__time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <input
        className="controls-bar__seek"
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => onSeek(Number(e.target.value))}
      />

      <span className="controls-bar__sentence-count" title="当前句 / 总句数">
        {sentenceCount === 0 ? "0 / 0" : `${sentenceIndex + 1} / ${sentenceCount}`}
      </span>

      <button
        className={"controls-bar__btn" + (subtitleVisible ? " controls-bar__btn--active" : "")}
        onClick={onToggleSubtitle}
        aria-pressed={subtitleVisible}
        title="M：显示/隐藏字幕"
      >
        {subtitleVisible ? "字幕：开" : "字幕：关"}
      </button>

      <button
        className={"controls-bar__btn" + (repeatEnabled ? " controls-bar__btn--active" : "")}
        onClick={onToggleRepeat}
        aria-pressed={repeatEnabled}
        title="单句循环：开启后当前句播完自动回到句首重复播放"
      >
        {repeatEnabled ? "单句循环：开" : "单句循环：关"}
      </button>

      <div className="controls-bar__font-group" title="-/=：缩放字幕字号">
        <button className="controls-bar__btn" onClick={onFontDecrease} aria-label="字幕缩小">
          A-
        </button>
        <button className="controls-bar__btn" onClick={onFontIncrease} aria-label="字幕放大">
          A+
        </button>
      </div>
    </div>
  );
}
