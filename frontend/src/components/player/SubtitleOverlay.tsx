interface Props {
  text: string | null;
  visible: boolean;
  /** font size in cqh (% of the video stage's height) */
  fontSizeCqh: number;
}

export function SubtitleOverlay({ text, visible, fontSizeCqh }: Props) {
  if (!visible || !text) return null;

  return (
    <div className="subtitle-overlay">
      <span className="subtitle-overlay__text" style={{ fontSize: `${fontSizeCqh}cqh` }}>
        {text}
      </span>
    </div>
  );
}
