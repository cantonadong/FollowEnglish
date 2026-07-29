import { useEffect } from "react";

interface Handlers {
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onToggleSubtitle: () => void;
  onToggleRepeat: () => void;
  onFontDecrease: () => void;
  onFontIncrease: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function useKeyboardShortcuts(handlers: Handlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          handlers.onTogglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handlers.onPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          handlers.onNext();
          break;
        case "KeyM":
          e.preventDefault();
          handlers.onToggleSubtitle();
          break;
        case "KeyQ":
          e.preventDefault();
          handlers.onReplay();
          break;
        case "KeyR":
          e.preventDefault();
          handlers.onToggleRepeat();
          break;
        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          handlers.onFontDecrease();
          break;
        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          handlers.onFontIncrease();
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, handlers]);
}
