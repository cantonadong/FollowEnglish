import { useEffect, useRef, useState } from "react";
import type { Sentence } from "../../types";

interface Props { sentences: Sentence[]; activeIndex: number; autoCopyEnabled: boolean; onSelect: (index: number) => void; onSave: (index: number, text: string) => Promise<void>; }

export function SentenceList({ sentences, activeIndex, autoCopyEnabled, onSelect, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const copyTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const skipScroll = useRef(false);
  const [toast, setToast] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (skipScroll.current) { skipScroll.current = false; return; }
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  useEffect(() => () => { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }, []);

  useEffect(() => {
    if (editingIndex === null) return;
    const cancel = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) { setEditingIndex(null); setDraft(""); }
    };
    document.addEventListener("pointerdown", cancel);
    return () => document.removeEventListener("pointerdown", cancel);
  }, [editingIndex]);

  const showToast = () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    setToast(true);
    copyTimer.current = window.setTimeout(() => setToast(false), 1600);
  };

  if (!sentences.length) return <div className="sentence-list sentence-list--empty"><p>未检测到英文字幕句子</p></div>;

  return <div ref={containerRef} className="sentence-list__container">
    <ul className="sentence-list">
      {sentences.map((sentence, i) => <li key={sentence.index} ref={i === activeIndex ? activeRef : undefined}
        className={"sentence-list__item" + (i === activeIndex ? " sentence-list__item--active" : "")}
        onClick={() => {
          skipScroll.current = true; onSelect(i);
          if (autoCopyEnabled && editingIndex !== i) void navigator.clipboard.writeText(sentence.text).then(showToast).catch(() => {});
        }}>
        <span className="sentence-list__index-column">
          <span className="sentence-list__index">{i + 1}</span>
          <button type="button" className="sentence-list__edit-button" disabled={saving}
            aria-label={editingIndex === i ? "保存字幕" : "编辑字幕"} title={editingIndex === i ? "保存" : "编辑"}
            onClick={(event) => {
              event.stopPropagation();
              if (editingIndex !== i) { setEditingIndex(i); setDraft(sentence.text); return; }
              const text = draft.trim(); if (!text) return;
              setSaving(true);
              void onSave(i, text).then(() => { setEditingIndex(null); setDraft(""); }).finally(() => setSaving(false));
            }}>{editingIndex === i ? "✓" : "✎"}</button>
        </span>
        {editingIndex === i
          ? <textarea className="sentence-list__editor" value={draft} autoFocus onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)} />
          : <span className="sentence-list__text">{sentence.text}</span>}
      </li>)}
    </ul>
    {toast && <div className="sentence-list__copy-toast" role="status">已复制到剪贴板</div>}
  </div>;
}
