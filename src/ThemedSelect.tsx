import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export type ThemedSelectValue = string | number | boolean;
export type ThemedSelectOption<T extends ThemedSelectValue = ThemedSelectValue> = { value: T; label: string };

export function ThemedSelect<T extends ThemedSelectValue>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
  stopPropagation = false,
}: {
  value: T;
  options: ThemedSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options.find((option) => String(option.value) === String(value)) ?? options[0];
  const stop = (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
    if (stopPropagation) event.stopPropagation();
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <div className={`themed-select ${className} ${open ? "open" : ""}`} ref={rootRef} onPointerDown={stop} onClick={stop}>
    <button
      type="button"
      className="themed-select__trigger"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      disabled={disabled}
      onClick={(event) => { stop(event); if (!disabled) setOpen((current) => !current); }}
    ><span>{selected?.label ?? String(value)}</span><svg viewBox="0 0 12 8" aria-hidden="true"><path d="m2 2.25 4 3.5 4-3.5" /></svg></button>
    {open && <div className="themed-select__menu" role="listbox" aria-label={ariaLabel}>
      {options.map((option) => <button
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={option.value === value ? "selected" : ""}
        key={String(option.value)}
        onClick={(event) => { stop(event); onChange(option.value); setOpen(false); }}
      ><span>{option.label}</span>{option.value === value && <svg viewBox="0 0 12 9" aria-hidden="true"><path d="m1.5 4.5 3 3 6-6" /></svg>}</button>)}
    </div>}
  </div>;
}
