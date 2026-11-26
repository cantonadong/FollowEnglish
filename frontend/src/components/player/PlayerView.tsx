import { useRef, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
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
  subtitleControls?: ReactNode;
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

const DEFAULT_SIDEBAR_WIDTH = 300;

export function PlayerView({ videoSrc, sentences, positionStorageKey = videoSrc, onSaveSentence, subtitleControls }: Props) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const initialSavedPositionRef = useRef(readSavedPosition(positionStorageKey));
  const initialSentenceIndex = initialSavedPositionRef.current.enabled
    ? Math.min(Math.max(initialSavedPositionRef.current.sentenceIndex, 0), Math.max(sentences.length - 1, 0))
    : 0;
  const videoRef = useRef<HTMLMediaElement | null>(null);
  const setMediaRef = useCallback((media: HTMLMediaElement | null) => { videoRef.current = media; }, []);
  const [audioOnly, setAudioOnly] = useState(true);
  const resumeMedia = useRef<{ time: number; playing: boolean } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(sentences[initialSentenceIndex]?.start ?? 0);
  const [duration, setDuration] = useState(0);
  const [subtitleVisible, setSubtitleVisible] = useState(true);
  const [repeatEnabled, setRepeatEnabled] = useState(true);
  const [repeatGapEnabled, setRepeatGapEnabled] = useState(true);
  const [repeatGapSeconds, setRepeatGapSeconds] = useState(1);
  const [repeatGapActive, setRepeatGapActive] = useState(false);
  const [fontSizeCqh, setFontSizeCqh] = useState(DEFAULT_FONT_CQH);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedHint, setSpeedHint] = useState<{ value: number; key: number } | null>(null);
  const [volume, setVolume] = useState(1);
  const audioOutput = useRef<{ context: AudioContext; gain: GainNode; source?: MediaElementAudioSourceNode } | null>(null);
  const pendingSeek = useRef<number | null>(null);
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
    activeSentence && currentTime + 0.001 >= activeSentence.start && currentTime < activeSentence.end && !repeatGapActive
      ? sentenceTexts[activeIndex] ?? activeSentence.text
      : null;

  useEffect(() => setSentenceTexts(sentences.map((sentence) => sentence.text)), [sentences]);
  const displayedSentences = useMemo(
    () => sentences.map((sentence, index) => ({ ...sentence, text: sentenceTexts[index] ?? sentence.text })),
    [sentences, sentenceTexts]
  );

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
    (time: number, index = findActiveIndex(sentences, time)) => {
      const video = videoRef.current;
      if (!video) return;
      activeIndexRef.current = index;
      setActiveIndex(index);
      clearRepeatGap();
      if (video.readyState === 0) pendingSeek.current = time;
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
      seekTo(sentence.start, index);
    },
    [sentences, seekTo]
  );

  const playSentence = useCallback((index: number) => {
    seekToSentence(index);
    void videoRef.current?.play().catch(() => setPlaying(false));
  }, [seekToSentence]);

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
    playSentence(Math.max(0, activeIndexRef.current - 1));
  }, [sentences.length, playSentence]);

  const handleNext = useCallback(() => {
    if (sentences.length === 0) return;
    playSentence(Math.min(sentences.length - 1, activeIndexRef.current + 1));
  }, [sentences.length, playSentence]);

  const handleReplay = useCallback(() => {
    if (activeIndex < 0) return;
    seekToSentence(activeIndex);
  }, [activeIndex, seekToSentence]);

  const toggleSubtitle = useCallback(() => setSubtitleVisible((v) => !v), []);
  const toggleAudio = () => {
    const media = videoRef.current;
    if (media) {
      resumeMedia.current = { time: media.currentTime, playing: !media.paused || repeatGapActive };
      media.pause();
    }
    setAudioOnly((enabled) => !enabled);
  };
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
  const setVideoVolume = useCallback((nextVolume: number) => {
    const normalizedVolume = Math.min(2, Math.max(0, Math.round(nextVolume * 20) / 20));
    if (normalizedVolume > 1 && !audioOutput.current) {
      const context = new AudioContext();
      const gain = context.createGain();
      gain.connect(context.destination);
      audioOutput.current = { context, gain };
    }
    const context = audioOutput.current?.context;
    if (context?.state === "suspended") void context.resume().catch(() => {});
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
  }, [videoSrc, audioOnly, playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const output = audioOutput.current;
    if (output) {
      if (output.source?.mediaElement !== video) {
        output.source?.disconnect();
        output.source = output.context.createMediaElementSource(video);
        output.source.connect(output.gain);
      }
      output.gain.gain.value = Math.max(1, volume);
    }
    video.volume = Math.min(1, volume);
  }, [videoSrc, audioOnly, volume]);

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
      const resume = resumeMedia.current;
      const seek = pendingSeek.current;
      pendingSeek.current = null;
      if (seek !== null) {
        resumeMedia.current = null;
        video.currentTime = Math.min(seek, video.duration);
        setCurrentTime(video.currentTime);
        return;
      }
      if (resume) {
        resumeMedia.current = null;
        video.currentTime = Math.min(resume.time, video.duration);
        setCurrentTime(video.currentTime);
        if (resume.playing) void video.play().catch(() => setPlaying(false));
        return;
      }
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
    let repeatBoundaryInterval: number | undefined;
    const startRepeatClock = () => {
      if (repeatEnabled && repeatBoundaryInterval === undefined) {
        repeatBoundaryInterval = window.setInterval(checkRepeatBoundary, 30);
      }
    };
    const stopRepeatClock = () => {
      window.clearInterval(repeatBoundaryInterval);
      repeatBoundaryInterval = undefined;
    };
    video.addEventListener("playing", startRepeatClock);
    video.addEventListener("pause", stopRepeatClock);
    video.addEventListener("ended", stopRepeatClock);
    if (!video.paused) startRepeatClock();
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("playing", startRepeatClock);
      video.removeEventListener("pause", stopRepeatClock);
      video.removeEventListener("ended", stopRepeatClock);
      stopRepeatClock();
      clearRepeatGap();
    };
  }, [
    videoSrc,
    audioOnly,
    sentences,
    initialSentenceIndex,
    repeatEnabled,
    repeatGapEnabled,
    scheduleRepeatGap,
    clearRepeatGap,
  ]);

  useEffect(() => {
    if (!initialSavedPositionRef.current.enabled || activeIndex < 0) return;
    writeSavedPosition(positionStorageKey, { enabled: true, sentenceIndex: activeIndex });
  }, [positionStorageKey, activeIndex]);

  useEffect(() => {
    if (!repeatEnabled || !repeatGapEnabled) {
      clearRepeatGap();
    }
  }, [repeatEnabled, repeatGapEnabled, clearRepeatGap]);

  useEffect(() => {
    return () => {
      if (audioOutput.current) {
        void audioOutput.current.context.close();
        audioOutput.current = null;
      }
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
        <div className="player-view__stage" onClick={togglePlay} onWheel={(event) => {
          if (event.ctrlKey) return;
          if (event.deltaY < 0) handlePrev();
          if (event.deltaY > 0) handleNext();
        }}>
          {audioOnly
            ? <audio ref={setMediaRef} src={videoSrc} preload="metadata" />
            : <video ref={setMediaRef} className="player-view__video" src={videoSrc} preload="metadata" />}
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
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onToggleSubtitle={toggleSubtitle}
          onToggleRepeat={toggleRepeat}
          onToggleRepeatGap={toggleRepeatGap}
          onRepeatGapSecondsChange={updateRepeatGapSeconds}
          onFontDecrease={fontDecrease}
          onFontIncrease={fontIncrease}
          onToggleAudio={toggleAudio}
          audioOnly={audioOnly}
          subtitleControls={subtitleControls}
        />

        <div className="player-view__shortcuts-hint">
          ← 上一句　空格/点击视频 播放/暂停　→ 下一句　Q 重播本句　R 单句循环开关　X/C 减速/加速　Z 恢复 1.0x　M 字幕开关　- / = 字幕缩放　间隔秒数支持 ↑ / ↓
        </div>
      </div>

      <div
        className="player-view__divider"
        role="separator"
        aria-label="字幕栏宽度"
        aria-orientation="vertical"
        tabIndex={0}
        title="拖动调整字幕栏宽度，双击重置"
        onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || !sidebarRef.current) return;
          sidebarDrag.current = { x: event.clientX, width: sidebarRef.current.offsetWidth };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = sidebarDrag.current;
          if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) {
            setSidebarWidth(Math.max(180, drag.width + drag.x - event.clientX));
          }
        }}
        onLostPointerCapture={() => { sidebarDrag.current = null; }}
        onKeyDown={(event) => {
          const width = sidebarRef.current?.offsetWidth ?? sidebarWidth;
          if (event.key === "ArrowLeft") setSidebarWidth(Math.max(180, width + 16));
          else if (event.key === "ArrowRight") setSidebarWidth(Math.max(180, width - 16));
          else if (event.key === "Home") setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
          else return;
          event.stopPropagation();
          event.preventDefault();
        }}
      />
      <aside ref={sidebarRef} className="player-view__sidebar" style={{ width: sidebarWidth }}>
        <SentenceList
          sentences={displayedSentences}
          activeIndex={activeIndex}
          autoCopyEnabled
          onSelect={playSentence}
          onSave={async (index, text) => {
            await onSaveSentence?.(index, text);
            setSentenceTexts((current) => current.map((value, i) => (i === index ? text : value)));
          }}
        />
      </aside>
    </div>
  );
}
