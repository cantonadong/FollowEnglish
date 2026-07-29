import type { Sentence } from "../types";

export const mockSentencesNormal: Sentence[] = [
  { index: 0, start: 0.5, end: 3.2, text: "Hello, and welcome to this short lesson." },
  { index: 1, start: 3.6, end: 7.1, text: "Today we're going to talk about listening practice." },
  { index: 2, start: 7.5, end: 11.0, text: "Shadowing is one of the best ways to improve your pronunciation." },
  { index: 3, start: 11.4, end: 14.8, text: "You repeat what you hear, right after the speaker." },
  { index: 4, start: 15.2, end: 19.6, text: "At first it feels difficult, but it gets easier with practice." },
  { index: 5, start: 20.0, end: 23.4, text: "Try to match the rhythm and the intonation." },
  { index: 6, start: 23.8, end: 27.9, text: "Don't worry about understanding every single word." },
  { index: 7, start: 28.3, end: 32.0, text: "Focus on the overall sound and flow of the sentence." },
  { index: 8, start: 32.4, end: 36.5, text: "You can pause, rewind, and repeat a sentence as many times as you like." },
  { index: 9, start: 37.0, end: 40.2, text: "That's exactly what this tool is designed for." },
  { index: 10, start: 40.6, end: 44.9, text: "Use the arrow keys to jump between sentences." },
  { index: 11, start: 45.3, end: 49.0, text: "And use the space bar to play or pause the video." },
  { index: 12, start: 49.4, end: 53.2, text: "Press M any time to show or hide the subtitles." },
  { index: 13, start: 53.6, end: 58.5, text: "Good luck, and enjoy your listening practice!" },
];

/** Edge cases: a very short segment, a very long line that must wrap, and a segment near the very end. */
export const mockSentencesEdgeCase: Sentence[] = [
  { index: 0, start: 0.2, end: 0.6, text: "Hi." },
  {
    index: 1,
    start: 1.0,
    end: 9.5,
    text:
      "This is a deliberately long subtitle line used to verify that wrapping, centering, and the maximum eighty percent width constraint all behave correctly on screen.",
  },
  { index: 2, start: 10.0, end: 13.0, text: "Short line after a long one." },
  { index: 3, start: 58.8, end: 59.9, text: "One last sentence near the end." },
];

export const mockSentencesEmpty: Sentence[] = [];
