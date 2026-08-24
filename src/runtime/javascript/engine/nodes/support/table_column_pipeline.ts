import { Table } from "../../table";
import { columnMath, columnTransformSpec } from "./table_column_math";
import { requireTable } from "./common";

export function columnTransformOutput(params: Record<string, unknown>): Record<string, unknown> {
  return columnTransformSpec(params);
}

export function columnPipeline(upstream: unknown, params: Record<string, unknown>): Table {
  if (!upstream || typeof upstream !== "object" || Array.isArray(upstream) || upstream instanceof Table) throw new Error("Column transform Pipeline requires named inputs");
  const inputs = upstream as Record<string, unknown>;
  let value = requireTable(inputs.input, "Column transform Pipeline");
  const expected = Number(params.transformCount ?? 1);
  if (!Number.isInteger(expected) || expected < 1 || expected > 16) throw new Error("Column transform Pipeline transformCount must be between 1 and 16");
  const transforms = Object.entries(inputs).filter(([port]) => port.startsWith("transform")).map(([port, item]) => {
    const order = Number(port.slice(9));
    if (!Number.isInteger(order) || order < 1) throw new Error(`Invalid Column transform Pipeline port: ${port}`);
    if (!item || typeof item !== "object" || Array.isArray(item) || item instanceof Table) throw new Error(`Column transform Pipeline input ${port} must be a Transform object`);
    return [order, item as Record<string, unknown>] as const;
  }).sort((left, right) => left[0] - right[0]);
  if (transforms.length !== expected) throw new Error(`Column transform Pipeline requires ${expected} connected Transform inputs`);
  transforms.forEach(([order], index) => { if (order !== index + 1) throw new Error("Column transform Pipeline inputs must use consecutive Transform ports"); });
  for (const [, transform] of transforms) value = columnMath(value, transform);
  return value;
}
