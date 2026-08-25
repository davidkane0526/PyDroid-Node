import type { ParameterSpec } from "./nodeCatalog";
import { NumericInput } from "./NumericInput";

export function ParameterField({
  spec,
  value,
  onChange,
  onExpand,
  validation,
}: {
  spec: ParameterSpec;
  value: string | number | boolean | null | undefined;
  onChange: (value: string | number | boolean | null) => void;
  onExpand?: () => void;
  validation?: { message: string; severity: "error" | "warning" };
}) {
  const displayValue = value === undefined ? spec.defaultValue : value;
  const validationHint = validation ? <small className={`field__validation field__validation--${validation.severity}`}>{validation.message}</small> : null;
  if (spec.kind === "boolean") {
    return (
      <label className="field field--checkbox">
        <span>{spec.label}</span>
        <span className="switch"><input type="checkbox" checked={Boolean(displayValue)} disabled={Boolean(spec.disabled || spec.readOnly)} onChange={(event) => onChange(event.target.checked)} /><i /></span>
        {validationHint}
      </label>
    );
  }
  if (spec.kind === "select") {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <select
          value={String(displayValue ?? "")}
          disabled={Boolean(spec.disabled || spec.readOnly)}
          onChange={(event) => {
            const option = spec.options?.find((item) => String(item.value) === event.target.value);
            onChange(option?.value ?? event.target.value);
          }}
        >
          {spec.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
        </select>
        {validationHint}
      </label>
    );
  }
  if (spec.kind === "textarea") {
    return (
      <label className="field">
        <span className="field__heading">{spec.label}{onExpand && !spec.readOnly && !spec.disabled && <button type="button" onClick={onExpand}>全屏编辑</button>}</span>
        <textarea
          value={String(displayValue ?? "")}
          placeholder={spec.placeholder}
          required={spec.required}
          readOnly={Boolean(spec.readOnly)}
          disabled={Boolean(spec.disabled)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (spec.readOnly || spec.disabled || event.key !== "Tab") return;
            event.preventDefault();
            const input = event.currentTarget;
            const start = input.selectionStart;
            const next = `${input.value.slice(0, start)}    ${input.value.slice(input.selectionEnd)}`;
            onChange(next);
            window.requestAnimationFrame(() => input.setSelectionRange(start + 4, start + 4));
          }}
          spellCheck={false}
        />
        {spec.description && <small>{spec.description}</small>}
        {validationHint}
      </label>
    );
  }
  if (spec.kind === "list") {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <input
          type="text"
          value={String(displayValue ?? "")}
          placeholder={spec.placeholder ?? (spec.itemType === "text" ? "a,b,c" : "0,1,2")}
          required={spec.required}
          readOnly={Boolean(spec.readOnly)}
          disabled={Boolean(spec.disabled)}
          onChange={(event) => onChange(event.target.value)}
        />
        <small>{spec.description ? `${spec.description} · ` : ""}可输入 JSON 数组或用英文逗号分隔。</small>
        {validationHint}
      </label>
    );
  }
  if (spec.kind === "number" && spec.control === "slider" && spec.min !== undefined && spec.max !== undefined) {
    const numericValue = Number(displayValue ?? spec.min);
    return (
      <label className="field field--range">
        <span>{spec.label}<output>{numericValue}</output></span>
        <input
          type="range"
          value={numericValue}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          disabled={Boolean(spec.disabled || spec.readOnly)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {spec.description && <small>{spec.description}</small>}
        {validationHint}
      </label>
    );
  }
  if (spec.kind === "number") {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <NumericInput label={spec.label} value={displayValue as string | number | null | undefined} min={spec.min} max={spec.max} step={spec.step} readOnly={Boolean(spec.readOnly)} disabled={Boolean(spec.disabled)} onChange={onChange} />
        {spec.description && <small>{spec.description}</small>}
        {validationHint}
      </label>
    );
  }

  return (
    <label className="field">
      <span>{spec.label}</span>
      <input
        type="text"
        value={String(displayValue ?? "")}
        placeholder={spec.placeholder}
        required={spec.required}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        readOnly={Boolean(spec.readOnly)}
        disabled={Boolean(spec.disabled)}
        onChange={(event) => onChange(event.target.value)}
      />
      {spec.description && <small>{spec.description}</small>}
      {validationHint}
    </label>
  );
}

