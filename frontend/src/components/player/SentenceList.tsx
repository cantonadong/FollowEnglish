import { useEffect, useRef } from "react";
import type { Sentence } from "../../types";

interface Props {
  sentences: Sentence[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function SentenceList({ sentences, activeIndex, onSelect }: Props) {
  const activeRef = useRef<HTMLLIElement>(null);
  // Set right before a click-driven onSelect, so the effect below can tell
  // "the user just clicked this item" (already visible, don't yank the
  // scroll) apart from "we arrived here via playback/prev/next" (should
  // re-center to keep the next few sentences in view).
  const skipNextScrollRef = useRef(false);

  useEffect(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  if (sentences.length === 0) {
    return (
      <div className="sentence-list sentence-list--empty">
        <p>未检测到英文字幕句子</p>
        <p className="sentence-list__hint">该视频可能没有可识别的语音内容</p>
      </div>
    );
  }

  return (
    <ul className="sentence-list">
      {sentences.map((s, i) => (
        <li
          key={s.index}
          ref={i === activeIndex ? activeRef : undefined}
          className={
            "sentence-list__item" + (i === activeIndex ? " sentence-list__item--active" : "")
          }
          onClick={() => {
            skipNextScrollRef.current = true;
            onSelect(i);
          }}
        >
          <span className="sentence-list__index">{i + 1}</span>
          <span className="sentence-list__text">{s.text}</span>
        </li>
      ))}
    </ul>
  );
}
