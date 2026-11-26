import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Sentence } from "../../types";

interface Props { sentences: Sentence[]; activeIndex: number; autoCopyEnabled: boolean; onSelect: (index: number) => void; onSave: (index: number, text: string) => Promise<void>; }

export function SentenceList({ sentences, activeIndex, autoCopyEnabled, onSelect, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const copyTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [toast, setToast] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const centerActive = () => {
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active) return;
    const row = active.getBoundingClientRect();
    list.scrollTop += row.top - list.getBoundingClientRect().top + (row.height - list.clientHeight) / 2;
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active) return;
    centerActive();
    const resize = new ResizeObserver(centerActive);
    if (containerRef.current) resize.observe(containerRef.current);
    resize.observe(active);
    return () => resize.disconnect();
  }, [activeIndex, sentences]);

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
    <ul ref={listRef} className="sentence-list">
      {sentences.map((sentence, i) => <li key={sentence.index} ref={i === activeIndex ? activeRef : undefined}
        className={"sentence-list__item" + (i === activeIndex ? " sentence-list__item--active" : "")}
        onClick={() => {
          onSelect(i);
          if (i === activeIndex) centerActive();
          if (autoCopyEnabled && editingIndex !== i) void navigator.clipboard.writeText(sentence.text).then(showToast).catch(() => {});
        }}>
        <span className="sentence-list__index-column">
          <button type="button" className="sentence-list__index"
            onKeyDown={(event) => { if (event.code === "Space") event.stopPropagation(); }}
            aria-label={`播放第 ${i + 1} 句`}>
            {i + 1}
          </button>
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
