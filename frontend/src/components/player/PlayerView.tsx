import { useRef, useState, useCallback, useEffect } from "react";
import type { Sentence } from "../../types";
import {
  findActiveIndex,
  MIN_FONT_CQH,
  MAX_FONT_CQH,
  DEFAULT_FONT_CQH,
  FONT_STEP_CQH,
} from "../../lib/sentenceNav";
import { useKeyboardShortcuts } from "../../lib/useKeyboardShortcuts";
import { SubtitleOverlay } from "./SubtitleOverlay";
import { ControlsBar } from "./ControlsBar";
import { SentenceList } from "./SentenceList";
import "./PlayerView.css";

interface Props {
  videoSrc: string;
  sentences: Sentence[];
  positionStorageKey?: string;
  onSaveSentence?: (index: number, text: string) => Promise<void>;
}

interface SavedPosition {
  enabled: boolean;
  sentenceIndex: number;
}

const POSITION_STORAGE_PREFIX = "follow-english:position:";

function readSavedPosition(key: string): SavedPosition {
  try {
    const value = window.localStorage.getItem(POSITION_STORAGE_PREFIX + key);
    if (value) {
      const parsed = JSON.parse(value) as Partial<SavedPosition>;
      if (typeof parsed.enabled === "boolean" && Number.isInteger(parsed.sentenceIndex)) {
        return { enabled: parsed.enabled, sentenceIndex: parsed.sentenceIndex as number };
      }
    }
  } catch {
    // Playback must keep working when storage is unavailable or malformed.
  }
  return { enabled: true, sentenceIndex: 0 };
}

function writeSavedPosition(key: string, value: SavedPosition): void {
  try {
    window.localStorage.setItem(POSITION_STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Browsers can deny localStorage (for example in private mode).
  }
}

export function PlayerView({ videoSrc, sentences, positionStorageKey = videoSrc, onSaveSentence }: Props) {
  const initialSavedPositionRef = useRef(readSavedPosition(positionStorageKey));
  const initialSentenceIndex = initialSavedPositionRef.current.enabled
    ? Math.min(Math.max(initialSavedPositionRef.current.sentenceIndex, 0), Math.max(sentences.length - 1, 0))
    : 0;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(sentences[initialSentenceIndex]?.start ?? 0);
  const [duration, setDuration] = useState(0);
  const [subtitleVisible, setSubtitleVisible] = useState(true);
  const [repeatEnabled, setRepeatEnabled] = useState(true);
  const [repeatGapEnabled, setRepeatGapEnabled] = useState(true);
  const [repeatGapSeconds, setRepeatGapSeconds] = useState(1);
  const [autoCopyEnabled, setAutoCopyEnabled] = useState(true);
  const [rememberPositionEnabled, setRememberPositionEnabled] = useState(
    initialSavedPositionRef.current.enabled
  );
  const [repeatGapActive, setRepeatGapActive] = useState(false);
  const [fontSizeCqh, setFontSizeCqh] = useState(DEFAULT_FONT_CQH);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedHint, setSpeedHint] = useState<{ value: number; key: number } | null>(null);
  const [volume, setVolume] = useState(1);
  const [volumeHint, setVolumeHint] = useState<{ value: number; key: number } | null>(null);
  const [sentenceTexts, setSentenceTexts] = useState(() => sentences.map((sentence) => sentence.text));
  const repeatGapTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const repeatGapStartedAtRef = useRef(0);
  const repeatGapSentenceRef = useRef<Sentence | null>(null);
  const repeatGapSecondsRef = useRef(1);
  const speedHintTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const volumeHintTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const detectedIndex = findActiveIndex(sentences, currentTime);
  const [activeIndex, setActiveIndex] = useState(
    sentences.length > 0 ? initialSentenceIndex : detectedIndex
  );
  const activeSentence = activeIndex >= 0 ? sentences[activeIndex] : null;
  const activeText =
    activeSentence && currentTime <= activeSentence.end && !repeatGapActive
      ? sentenceTexts[activeIndex] ?? activeSentence.text
      : null;

  useEffect(() => setSentenceTexts(sentences.map((sentence) => sentence.text)), [sentences]);

  // Tracks "the sentence we consider active" for the timeupdate listener
  // below, which must not recompute this from the live (already-advanced)
  // playback time — see the comment on that effect for why. Kept in sync via
  // the effect below (natural playback) and written synchronously by
  // seekToSentence (explicit navigation), since the effect alone would race
  // a 'timeupdate' fired by the seek itself.
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (!repeatEnabled && !repeatGapActive) {
      activeIndexRef.current = detectedIndex;
      setActiveIndex(detectedIndex);
    }
  }, [detectedIndex, repeatEnabled, repeatGapActive]);

  const clearRepeatGap = useCallback(() => {
    if (repeatGapTimerRef.current !== null) {
      window.clearTimeout(repeatGapTimerRef.current);
      repeatGapTimerRef.current = null;
    }
    repeatGapStartedAtRef.current = 0;
    repeatGapSentenceRef.current = null;
    setRepeatGapActive(false);
  }, []);

  const finishRepeatGap = useCallback(() => {
    const video = videoRef.current;
    const active = repeatGapSentenceRef.current;
    repeatGapTimerRef.current = null;
    repeatGapStartedAtRef.current = 0;
    repeatGapSentenceRef.current = null;
    setRepeatGapActive(false);
    if (!video || !active) return;
    video.currentTime = active.start;
    setCurrentTime(active.start);
    void video.play();
  }, []);

  const scheduleRepeatGap = useCallback(
    (active: Sentence) => {
      const video = videoRef.current;
      if (!video) return;
      if (repeatGapTimerRef.current !== null) {
        window.clearTimeout(repeatGapTimerRef.current);
      }
      video.pause();
      video.currentTime = active.end;
      setCurrentTime(active.end);
      setRepeatGapActive(true);
      repeatGapStartedAtRef.current = Date.now();
      repeatGapSentenceRef.current = active;
      repeatGapTimerRef.current = window.setTimeout(
        finishRepeatGap,
        repeatGapSecondsRef.current * 1000
      );
    },
    [finishRepeatGap]
  );

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const nextIndex = findActiveIndex(sentences, time);
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
      clearRepeatGap();
      video.currentTime = time;
      setCurrentTime(time);
    },
    [sentences, clearRepeatGap]
  );

  // Jumps to a specific sentence by array index (never by re-deriving an
  // index from a time value — see the comment on activeIndexRef for why that
  // is unreliable for sentences with no gap between them). Updates the ref
  // synchronously, right alongside the seek, instead of waiting for the
  // render -> effect round trip: a 'timeupdate' fired by the seek itself can
  // otherwise reach the listener below before that effect has run, which
  // would make it check against the sentence we just navigated away from.
  const seekToSentence = useCallback(
    (index: number) => {
      const sentence = sentences[index];
      if (!sentence) return;
      activeIndexRef.current = index;
      setActiveIndex(index);
      seekTo(sentence.start);
    },
    [sentences, seekTo]
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (repeatGapActive) {
      const active = sentences[activeIndexRef.current] ?? null;
      clearRepeatGap();
      if (active) {
        video.currentTime = active.start;
        setCurrentTime(active.start);
      }
      void video.play();
      return;
    }
    if (video.paused) video.play();
    else video.pause();
  }, [clearRepeatGap, repeatGapActive, sentences]);

  const handlePrev = useCallback(() => {
    if (sentences.length === 0) return;
    seekToSentence(Math.max(0, activeIndex - 1));
    void videoRef.current?.play();
  }, [sentences, activeIndex, seekToSentence]);

  const handleNext = useCallback(() => {
    if (sentences.length === 0) return;
    seekToSentence(Math.min(sentences.length - 1, activeIndex + 1));
    void videoRef.current?.play();
  }, [sentences, activeIndex, seekToSentence]);

  const handleReplay = useCallback(() => {
    if (activeIndex < 0) return;
    seekToSentence(activeIndex);
  }, [activeIndex, seekToSentence]);

  const toggleSubtitle = useCallback(() => setSubtitleVisible((v) => !v), []);
  const toggleRepeat = useCallback(() => setRepeatEnabled((v) => !v), []);
  const toggleRepeatGap = useCallback(() => setRepeatGapEnabled((v) => !v), []);
  const toggleAutoCopy = useCallback(() => setAutoCopyEnabled((v) => !v), []);
  const toggleRememberPosition = useCallback(() => {
    setRememberPositionEnabled((enabled) => {
      const nextEnabled = !enabled;
      writeSavedPosition(positionStorageKey, {
        enabled: nextEnabled,
        sentenceIndex: nextEnabled ? Math.max(activeIndexRef.current, 0) : 0,
      });
      return nextEnabled;
    });
  }, [positionStorageKey]);
  const updateRepeatGapSeconds = useCallback(
    (seconds: number) => {
      const nextSeconds = Math.min(9, Math.max(1, seconds));
      repeatGapSecondsRef.current = nextSeconds;
      setRepeatGapSeconds(nextSeconds);
    },
    []
  );
  const showSpeedHint = useCallback((value: number) => {
    if (speedHintTimerRef.current !== null) {
      window.clearTimeout(speedHintTimerRef.current);
    }
    setSpeedHint({ value, key: Date.now() });
    speedHintTimerRef.current = window.setTimeout(() => {
      speedHintTimerRef.current = null;
      setSpeedHint(null);
    }, 2000);
  }, []);
  const setVideoPlaybackRate = useCallback(
    (nextRate: number) => {
      const normalizedRate = Math.min(4, Math.max(0.1, Math.round(nextRate * 10) / 10));
      const video = videoRef.current;
      if (video) {
        video.playbackRate = normalizedRate;
      }
      setPlaybackRate(normalizedRate);
      showSpeedHint(normalizedRate);
    },
    [showSpeedHint]
  );
  const speedDown = useCallback(
    () => setVideoPlaybackRate(playbackRate - 0.1),
    [playbackRate, setVideoPlaybackRate]
  );
  const speedUp = useCallback(
    () => setVideoPlaybackRate(playbackRate + 0.1),
    [playbackRate, setVideoPlaybackRate]
  );
  const speedReset = useCallback(() => setVideoPlaybackRate(1), [setVideoPlaybackRate]);
  const setVideoVolume = useCallback((nextVolume: number) => {
    const normalizedVolume = Math.min(1, Math.max(0, Math.round(nextVolume * 20) / 20));
    const video = videoRef.current;
    if (video) {
      video.volume = normalizedVolume;
      video.muted = false;
    }
    setVolume(normalizedVolume);
    if (volumeHintTimerRef.current !== null) {
      window.clearTimeout(volumeHintTimerRef.current);
    }
    setVolumeHint({ value: normalizedVolume, key: Date.now() });
    volumeHintTimerRef.current = window.setTimeout(() => {
      volumeHintTimerRef.current = null;
      setVolumeHint(null);
    }, 2000);
  }, []);
  const volumeDown = useCallback(
    () => setVideoVolume(volume - 0.05),
    [volume, setVideoVolume]
  );
  const volumeUp = useCallback(
    () => setVideoVolume(volume + 0.05),
    [volume, setVideoVolume]
  );
  const fontDecrease = useCallback(
    () => setFontSizeCqh((v) => Math.max(MIN_FONT_CQH, v - FONT_STEP_CQH)),
    []
  );
  const fontIncrease = useCallback(
    () => setFontSizeCqh((v) => Math.min(MAX_FONT_CQH, v + FONT_STEP_CQH)),
    []
  );

  useKeyboardShortcuts({
    onTogglePlay: togglePlay,
    onPrev: handlePrev,
    onNext: handleNext,
    onReplay: handleReplay,
    onToggleSubtitle: toggleSubtitle,
    onToggleRepeat: toggleRepeat,
    onSpeedDown: speedDown,
    onSpeedUp: speedUp,
    onSpeedReset: speedReset,
    onFontDecrease: fontDecrease,
    onFontIncrease: fontIncrease,
    onVolumeDown: volumeDown,
    onVolumeUp: volumeUp,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackRate;
    }
  }, [videoSrc, playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkRepeatBoundary = () => {
      if (repeatEnabled) {
        const active = sentences[activeIndexRef.current] ?? null;
        if (active && video.currentTime >= active.end) {
          if (repeatGapEnabled) {
            if (repeatGapTimerRef.current !== null) return true;
            scheduleRepeatGap(active);
          } else {
            video.currentTime = active.start;
            setCurrentTime(active.start);
          }
          return true;
        }
      }
      return false;
    };

    const onTimeUpdate = () => {
      if (checkRepeatBoundary()) return;
      setCurrentTime(video.currentTime);
    };
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      if (initialSavedPositionRef.current.enabled) {
        const sentence = sentences[initialSentenceIndex];
        if (sentence) {
          video.currentTime = sentence.start;
          setCurrentTime(sentence.start);
        }
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    const repeatBoundaryInterval = window.setInterval(() => {
      if (!video.paused) {
        checkRepeatBoundary();
      }
    }, 40);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      window.clearInterval(repeatBoundaryInterval);
      clearRepeatGap();
    };
  }, [
    videoSrc,
    sentences,
    initialSentenceIndex,
    repeatEnabled,
    repeatGapEnabled,
    scheduleRepeatGap,
    clearRepeatGap,
  ]);

  useEffect(() => {
    if (!rememberPositionEnabled || activeIndex < 0) return;
    writeSavedPosition(positionStorageKey, { enabled: true, sentenceIndex: activeIndex });
  }, [positionStorageKey, rememberPositionEnabled, activeIndex]);

  useEffect(() => {
    if (!repeatEnabled || !repeatGapEnabled) {
      clearRepeatGap();
    }
  }, [repeatEnabled, repeatGapEnabled, clearRepeatGap]);

  useEffect(() => {
    return () => {
      if (speedHintTimerRef.current !== null) {
        window.clearTimeout(speedHintTimerRef.current);
      }
      if (volumeHintTimerRef.current !== null) {
        window.clearTimeout(volumeHintTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="player-view">
      <div className="player-view__main">
        <div className="player-view__stage" onClick={togglePlay}>
          <video ref={videoRef} className="player-view__video" src={videoSrc} />
          {speedHint && (
            <div key={speedHint.key} className="player-view__speed-hint">
              {speedHint.value.toFixed(1)}x
            </div>
          )}
          {volumeHint && (
            <div key={volumeHint.key} className="player-view__volume-hint">
              音量 {Math.round(volumeHint.value * 100)}%
            </div>
          )}
          <SubtitleOverlay text={activeText} visible={subtitleVisible} fontSizeCqh={fontSizeCqh} />
        </div>

        <ControlsBar
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          sentenceIndex={activeIndex}
          sentenceCount={sentences.length}
          subtitleVisible={subtitleVisible}
          repeatEnabled={repeatEnabled}
          repeatGapEnabled={repeatGapEnabled}
          repeatGapSeconds={repeatGapSeconds}
          autoCopyEnabled={autoCopyEnabled}
          rememberPositionEnabled={rememberPositionEnabled}
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onToggleSubtitle={toggleSubtitle}
          onToggleRepeat={toggleRepeat}
          onToggleRepeatGap={toggleRepeatGap}
          onRepeatGapSecondsChange={updateRepeatGapSeconds}
          onToggleAutoCopy={toggleAutoCopy}
          onToggleRememberPosition={toggleRememberPosition}
          onFontDecrease={fontDecrease}
          onFontIncrease={fontIncrease}
        />

        <div className="player-view__shortcuts-hint">
          ← 上一句　空格/点击视频 播放/暂停　→ 下一句　Q 重播本句　R 单句循环开关　X/C 减速/加速　Z 恢复 1.0x　M 字幕开关　- / = 字幕缩放　间隔秒数支持 ↑ / ↓
        </div>
      </div>

      <aside className="player-view__sidebar">
        <SentenceList
          sentences={sentences.map((sentence, index) => ({
            ...sentence,
            text: sentenceTexts[index] ?? sentence.text,
          }))}
          activeIndex={activeIndex}
          autoCopyEnabled={autoCopyEnabled}
          onSelect={seekToSentence}
          onSave={async (index, text) => {
            await onSaveSentence?.(index, text);
            setSentenceTexts((current) => current.map((value, i) => (i === index ? text : value)));
          }}
        />
      </aside>
    </div>
  );
}
