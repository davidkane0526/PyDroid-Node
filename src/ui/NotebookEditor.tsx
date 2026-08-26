import { useRef } from "react";

export function NotebookEditor({ value, rows, onChange }: { value: string; rows: number; onChange: (value: string) => void }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(1, value.split("\n").length);
  return <div className="notebook-editor"><div ref={gutter} className="notebook-editor__lines" aria-hidden="true">{Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}</div><textarea value={value} rows={rows} spellCheck={false} onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} onChange={(event) => onChange(event.target.value)} /></div>;
}
