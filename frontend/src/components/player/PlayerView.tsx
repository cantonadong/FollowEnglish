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
}

export function PlayerView({ videoSrc, sentences }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subtitleVisible, setSubtitleVisible] = useState(true);
  const [repeatEnabled, setRepeatEnabled] = useState(true);
  const [repeatGapEnabled, setRepeatGapEnabled] = useState(true);
  const [repeatGapSeconds, setRepeatGapSeconds] = useState(1);
  const [repeatGapActive, setRepeatGapActive] = useState(false);
  const [fontSizeCqh, setFontSizeCqh] = useState(DEFAULT_FONT_CQH);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedHint, setSpeedHint] = useState<{ value: number; key: number } | null>(null);
  const repeatGapTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const repeatGapStartedAtRef = useRef(0);
  const repeatGapSentenceRef = useRef<Sentence | null>(null);
  const repeatGapSecondsRef = useRef(1);
  const speedHintTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const detectedIndex = findActiveIndex(sentences, currentTime);
  const [activeIndex, setActiveIndex] = useState(detectedIndex);
  const activeSentence = activeIndex >= 0 ? sentences[activeIndex] : null;
  const activeText =
    activeSentence && currentTime <= activeSentence.end && !repeatGapActive
      ? activeSentence.text
      : null;

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
    const onLoadedMetadata = () => setDuration(video.duration);
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
  }, [videoSrc, sentences, repeatEnabled, repeatGapEnabled, scheduleRepeatGap, clearRepeatGap]);

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
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onToggleSubtitle={toggleSubtitle}
          onToggleRepeat={toggleRepeat}
          onToggleRepeatGap={toggleRepeatGap}
          onRepeatGapSecondsChange={updateRepeatGapSeconds}
          onFontDecrease={fontDecrease}
          onFontIncrease={fontIncrease}
        />

        <div className="player-view__shortcuts-hint">
          ← 上一句　空格/点击视频 播放/暂停　→ 下一句　Q 重播本句　R 单句循环开关　X/C 减速/加速　Z 恢复 1.0x　M 字幕开关　- / = 字幕缩放　间隔秒数支持 ↑ / ↓
        </div>
      </div>

      <aside className="player-view__sidebar">
        <SentenceList sentences={sentences} activeIndex={activeIndex} onSelect={seekToSentence} />
      </aside>
    </div>
  );
}
