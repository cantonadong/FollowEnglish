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
  const [fontSizeCqh, setFontSizeCqh] = useState(DEFAULT_FONT_CQH);

  const activeIndex = findActiveIndex(sentences, currentTime);
  const activeSentence = activeIndex >= 0 ? sentences[activeIndex] : null;
  const activeText =
    activeSentence && currentTime <= activeSentence.end ? activeSentence.text : null;

  // Tracks "the sentence we consider active" for the timeupdate listener
  // below, which must not recompute this from the live (already-advanced)
  // playback time — see the comment on that effect for why. Kept in sync via
  // the effect below (natural playback) and written synchronously by
  // seekToSentence (explicit navigation), since the effect alone would race
  // a 'timeupdate' fired by the seek itself.
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  }, []);

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
      seekTo(sentence.start);
    },
    [sentences, seekTo]
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }, []);

  const handlePrev = useCallback(() => {
    if (sentences.length === 0) return;
    seekToSentence(Math.max(0, activeIndex - 1));
  }, [sentences, activeIndex, seekToSentence]);

  const handleNext = useCallback(() => {
    if (sentences.length === 0) return;
    seekToSentence(Math.min(sentences.length - 1, activeIndex + 1));
  }, [sentences, activeIndex, seekToSentence]);

  const handleReplay = useCallback(() => {
    if (activeIndex < 0) return;
    seekToSentence(activeIndex);
  }, [activeIndex, seekToSentence]);

  const toggleSubtitle = useCallback(() => setSubtitleVisible((v) => !v), []);
  const toggleRepeat = useCallback(() => setRepeatEnabled((v) => !v), []);
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
    onFontDecrease: fontDecrease,
    onFontIncrease: fontIncrease,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (repeatEnabled) {
        // Deliberately check against the sentence active as of the *last
        // render* (activeIndexRef), not one freshly recomputed from
        // video.currentTime. Once currentTime ticks past this sentence's
        // end, findActiveIndex(sentences, video.currentTime) would already
        // report the *next* sentence as active (their boundary is often
        // back-to-back with no gap) — checking against that would almost
        // always read as "not yet at this sentence's end" and repeat would
        // never fire, silently falling through to the next sentence instead.
        const active = sentences[activeIndexRef.current] ?? null;
        if (active && video.currentTime >= active.end) {
          video.currentTime = active.start;
          return;
        }
      }
      setCurrentTime(video.currentTime);
    };
    const onLoadedMetadata = () => setDuration(video.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [videoSrc, sentences, repeatEnabled]);

  return (
    <div className="player-view">
      <div className="player-view__main">
        <div className="player-view__stage" onClick={togglePlay}>
          <video ref={videoRef} className="player-view__video" src={videoSrc} />
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
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onToggleSubtitle={toggleSubtitle}
          onToggleRepeat={toggleRepeat}
          onFontDecrease={fontDecrease}
          onFontIncrease={fontIncrease}
        />

        <div className="player-view__shortcuts-hint">
          ← 上一句　空格/点击视频 播放/暂停　→ 下一句　Q 重播本句　M 字幕开关　- / = 字幕缩放
        </div>
      </div>

      <aside className="player-view__sidebar">
        <SentenceList sentences={sentences} activeIndex={activeIndex} onSelect={seekToSentence} />
      </aside>
    </div>
  );
}
