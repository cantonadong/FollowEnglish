import type { Sentence } from "../types";

// Seeking a <video> to an exact time doesn't land on that exact value —
// verified empirically: requesting 16.56 landed at 16.559999 (browser/codec
// timebase rounding). A strict `currentTime >= start` then rejects the
// sentence we just seeked to (16.559999 is a hair less than its 16.56 start),
// leaving the active index stuck one sentence behind — every subsequent
// next/prev then computes from that stale index, so a sentence is
// unreachable in both directions. The tolerance below absorbs that.
const SEEK_EPSILON = 0.1;

export function findActiveIndex(sentences: Sentence[], currentTime: number): number {
  if (sentences.length === 0) return -1;
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (currentTime + SEEK_EPSILON >= sentences[i].start) return i;
  }
  return 0;
}

/** Subtitle font size expressed in cqh (% of the video stage's height), so max/min scale with the video regardless of window size. */
export const MIN_FONT_CQH = 3;
export const MAX_FONT_CQH = 25; // spec: never exceed 1/4 of the video height
export const DEFAULT_FONT_CQH = 6;
export const FONT_STEP_CQH = 1;
