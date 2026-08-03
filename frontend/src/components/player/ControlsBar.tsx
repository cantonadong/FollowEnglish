interface Props {
  playing: boolean;
  currentTime: number;
  duration: number;
  sentenceIndex: number; // 0-based, -1 if none
  sentenceCount: number;
  subtitleVisible: boolean;
  repeatEnabled: boolean;
  repeatGapEnabled: boolean;
  repeatGapSeconds: number;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onToggleSubtitle: () => void;
  onToggleRepeat: () => void;
  onToggleRepeatGap: () => void;
  onRepeatGapSecondsChange: (seconds: number) => void;
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
  repeatGapEnabled,
  repeatGapSeconds,
  onTogglePlay,
  onSeek,
  onToggleSubtitle,
  onToggleRepeat,
  onToggleRepeatGap,
  onRepeatGapSecondsChange,
  onFontDecrease,
  onFontIncrease,
}: Props) {
  const handleRepeatGapChange = (value: string) => {
    const nextValue = value.replace(/\D/g, "").slice(-1);
    if (!nextValue) return;
    const nextSeconds = Number(nextValue);
    if (nextSeconds >= 1 && nextSeconds <= 9) {
      onRepeatGapSecondsChange(nextSeconds);
    }
  };

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

      <div className="controls-bar__gap-group" title="重复间隔：当前句播完后暂停空白秒数，再重复播放">
        <button
          className={"controls-bar__btn" + (repeatGapEnabled ? " controls-bar__btn--active" : "")}
          onClick={onToggleRepeatGap}
          aria-pressed={repeatGapEnabled}
          disabled={!repeatEnabled}
        >
          间隔：{repeatGapEnabled ? "开" : "关"}
        </button>
        <input
          className="controls-bar__gap-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={9}
          step={1}
          pattern="[1-9]"
          value={repeatGapSeconds}
          onChange={(e) => handleRepeatGapChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onRepeatGapSecondsChange(Math.min(9, repeatGapSeconds + 1));
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              onRepeatGapSecondsChange(Math.max(1, repeatGapSeconds - 1));
              return;
            }
            if (
              e.key.length === 1 &&
              !/^[1-9]$/.test(e.key) &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey
            ) {
              e.preventDefault();
            }
          }}
          aria-label="重复间隔秒数"
          title="只允许输入 1-9，可用键盘上下键调整"
          disabled={!repeatEnabled || !repeatGapEnabled}
        />
        <span className="controls-bar__gap-unit">秒</span>
      </div>

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
