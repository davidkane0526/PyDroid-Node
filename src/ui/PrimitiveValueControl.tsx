import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ParameterSpec } from "../nodeCatalog";
import { NumericInput } from "../NumericInput";
import { TRANSIENT_UI_DISMISS_EVENT } from "./transientUi";

const COLOR_PRESETS = ["#2563eb", "#0ea5e9", "#14b8a6", "#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b", "#111827"];
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function stopPropagation(stop: boolean, event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): void {
  if (stop) event.stopPropagation();
}

function normalizeHex(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text.slice(1).split("").map((char) => `${char}${char}`).join("")}`.toLowerCase();
  return "#3b82f6";
}

function pad2(value: number): string { return String(value).padStart(2, "0"); }
function formatLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
function parseLocalDateTime(value: unknown): Date {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return new Date(2026, 0, 1, 0, 0, 0, 0);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
  return Number.isNaN(date.getTime()) ? new Date(2026, 0, 1, 0, 0, 0, 0) : date;
}
function displayDateTime(value: unknown): string {
  const date = parseLocalDateTime(value);
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}  ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function usePrimitivePopover(disabled: boolean) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const dismiss = () => setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", keydown);
    window.addEventListener(TRANSIENT_UI_DISMISS_EVENT, dismiss);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener(TRANSIENT_UI_DISMISS_EVENT, dismiss);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return { open, setOpen, rootRef };
}

function BooleanPrimitive({ value, disabled, label, onChange, stop }: { value: unknown; disabled: boolean; label: string; onChange: (value: boolean) => void; stop: boolean }) {
  const active = Boolean(value);
  return <button
    type="button"
    className={`primitive-toggle nodrag nopan ${active ? "on" : "off"}`}
    role="switch"
    aria-checked={active}
    aria-label={label}
    disabled={disabled}
    onPointerDown={(event) => stopPropagation(stop, event)}
    onClick={(event) => { stopPropagation(stop, event); if (!disabled) onChange(!active); }}
  ><span className="primitive-toggle__track" aria-hidden="true"><i /></span><span className="primitive-toggle__state">{active ? "开" : "关"}</span></button>;
}

function ColorPrimitive({ value, disabled, label, onChange, stop }: { value: unknown; disabled: boolean; label: string; onChange: (value: string) => void; stop: boolean }) {
  const color = normalizeHex(value);
  const { open, setOpen, rootRef } = usePrimitivePopover(disabled);
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);
  const commitDraft = () => { if (/^#[0-9a-f]{6}$/i.test(draft)) onChange(draft.toLowerCase()); };
  return <div className={`primitive-popover-root primitive-color-control nodrag nopan ${open ? "open" : ""}`} ref={rootRef} onPointerDown={(event) => stopPropagation(stop, event)} onClick={(event) => stopPropagation(stop, event)}>
    <button type="button" className="primitive-color-trigger" aria-label={label} aria-expanded={open} disabled={disabled} onClick={() => !disabled && setOpen((current) => !current)}>
      <span className="primitive-color-trigger__swatch" style={{ backgroundColor: color }} aria-hidden="true"/><code>{color.toUpperCase()}</code>
    </button>
    {open && <div className="primitive-popover primitive-color-popover" role="dialog" aria-label={`${label}选择器`}>
      <div className="primitive-color-presets">{COLOR_PRESETS.map((preset) => <button type="button" key={preset} aria-label={preset} className={preset === color ? "selected" : ""} style={{ "--primitive-swatch": preset } as CSSProperties} onClick={() => { onChange(preset); setDraft(preset); }} />)}</div>
      <label className="primitive-hex-field"><span>HEX</span><input value={draft} spellCheck={false} maxLength={7} onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft} onKeyDown={(event) => { if (event.key === "Enter") { commitDraft(); setOpen(false); } }} /></label>
    </div>}
  </div>;
}

function DateTimePrimitive({ value, disabled, label, onChange, stop }: { value: unknown; disabled: boolean; label: string; onChange: (value: string) => void; stop: boolean }) {
  const selected = useMemo(() => parseLocalDateTime(value), [value]);
  const { open, setOpen, rootRef } = usePrimitivePopover(disabled);
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  useEffect(() => { if (open) setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1)); }, [open, selected]);
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - mondayOffset + 1;
    return day >= 1 && day <= monthDays ? day : null;
  });
  const updateDate = (day: number) => {
    const next = new Date(month.getFullYear(), month.getMonth(), day, selected.getHours(), selected.getMinutes(), 0, 0);
    onChange(formatLocalDateTime(next));
  };
  const updateTime = (kind: "hour" | "minute", raw: string) => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return;
    const next = new Date(selected);
    if (kind === "hour") next.setHours(Math.min(23, Math.max(0, numeric)));
    else next.setMinutes(Math.min(59, Math.max(0, numeric)));
    onChange(formatLocalDateTime(next));
  };
  const sameDay = (day: number) => selected.getFullYear() === month.getFullYear() && selected.getMonth() === month.getMonth() && selected.getDate() === day;
  return <div className={`primitive-popover-root primitive-datetime-control nodrag nopan ${open ? "open" : ""}`} ref={rootRef} onPointerDown={(event) => stopPropagation(stop, event)} onClick={(event) => stopPropagation(stop, event)}>
    <button type="button" className="primitive-datetime-trigger" aria-label={label} aria-expanded={open} disabled={disabled} onClick={() => !disabled && setOpen((current) => !current)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M5 2v3M11 2v3M3 6.5h10"/></svg><span>{displayDateTime(value)}</span>
    </button>
    {open && <div className="primitive-popover primitive-datetime-popover" role="dialog" aria-label={`${label}选择器`}>
      <div className="primitive-calendar-head"><button type="button" aria-label="上个月" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹</button><strong>{month.getFullYear()}年{month.getMonth() + 1}月</strong><button type="button" aria-label="下个月" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>›</button></div>
      <div className="primitive-calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="primitive-calendar-grid">{cells.map((day, index) => day ? <button type="button" key={`${month.getMonth()}-${day}`} className={sameDay(day) ? "selected" : ""} onClick={() => updateDate(day)}>{day}</button> : <span key={`empty-${index}`} />)}</div>
      <div className="primitive-time-row"><span>时间</span><input aria-label="小时" inputMode="numeric" value={pad2(selected.getHours())} onChange={(event) => updateTime("hour", event.target.value)} /><i>:</i><input aria-label="分钟" inputMode="numeric" value={pad2(selected.getMinutes())} onChange={(event) => updateTime("minute", event.target.value)} /><button type="button" onClick={() => onChange(formatLocalDateTime(new Date()))}>现在</button></div>
    </div>}
  </div>;
}

export function PrimitiveValueControl({ spec, value, stopPropagation: stop = false, onChange }: { spec: ParameterSpec; value: unknown; stopPropagation?: boolean; onChange: (value: string | number | boolean | null) => void }) {
  const disabled = Boolean(spec.disabled || spec.readOnly);
  if (spec.kind === "boolean") return <BooleanPrimitive value={value} disabled={disabled} label={spec.label} stop={stop} onChange={(next) => onChange(next)} />;
  if (spec.kind === "color") return <ColorPrimitive value={value} disabled={disabled} label={spec.label} stop={stop} onChange={(next) => onChange(next)} />;
  if (spec.kind === "datetime") return <DateTimePrimitive value={value} disabled={disabled} label={spec.label} stop={stop} onChange={(next) => onChange(next)} />;
  if (spec.kind === "number") return <NumericInput label={spec.label} value={value as string | number | null | undefined} min={spec.min} max={spec.max} step={spec.step} readOnly={Boolean(spec.readOnly)} disabled={Boolean(spec.disabled)} className="numeric-input--primitive nodrag nopan" inputClassName="primitive-number-input" stopPropagation={stop} onChange={onChange} />;
  return <input className="primitive-text-input nodrag nopan" aria-label={spec.label} title={spec.label} type="text" value={String(value ?? "")} placeholder="输入文本" readOnly={Boolean(spec.readOnly)} disabled={Boolean(spec.disabled)} onPointerDown={(event) => stopPropagation(stop, event)} onClick={(event) => stopPropagation(stop, event)} onChange={(event) => onChange(event.target.value)} />;
}
