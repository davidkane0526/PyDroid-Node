import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

export function NumericInput({
  label,
  value,
  min,
  max,
  step,
  readOnly = false,
  disabled = false,
  className = "",
  inputClassName = "",
  stopPropagation = false,
  onChange,
}: {
  label: string;
  value: string | number | null | undefined;
  min?: number;
  max?: number;
  step?: number | string;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  stopPropagation?: boolean;
  onChange: (value: number | null) => void;
}) {
  const stop = (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
    if (stopPropagation) event.stopPropagation();
  };
  const stepValue = typeof step === "number" && step > 0 ? step : 1;
  const adjust = (direction: -1 | 1) => {
    const current = value === null || value === undefined || value === "" ? (min ?? 0) : Number(value);
    let next = current + direction * stepValue;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(Number(next.toPrecision(12)));
  };
  return <span className={`numeric-input ${className}`} title={label} onPointerDown={stop} onClick={stop}>
    <input
      className={`numeric-input__field ${inputClassName}`}
      aria-label={label}
      type="number"
      value={value === null || value === undefined ? "" : String(value)}
      min={min}
      max={max}
      step={step ?? "any"}
      readOnly={readOnly}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
    />
    <span className="numeric-input__stepper">
      <button type="button" tabIndex={-1} aria-label={`${label} 增加`} disabled={disabled || readOnly} onClick={(event) => { event.stopPropagation(); adjust(1); }}><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M2 4.2 5 1.8 8 4.2" /></svg></button>
      <button type="button" tabIndex={-1} aria-label={`${label} 减少`} disabled={disabled || readOnly} onClick={(event) => { event.stopPropagation(); adjust(-1); }}><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M2 1.8 5 4.2 8 1.8" /></svg></button>
    </span>
  </span>;
}
