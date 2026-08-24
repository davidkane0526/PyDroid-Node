import { Table, isMissing, toNumber } from "../../table";
import { optionalFloat, resolveColumn, resolveColumns } from "./common";
export function groupAggregate(frame: Table, params: Record<string, unknown>): Table {
  const groupSize = Number(params.groupSize ?? 20);
  const start = Number(params.startRow ?? 0);
  const endRaw = params.endRow;
  const end = String(endRaw ?? "").trim() ? Number(endRaw) : groupSize;
  const method = String(params.method ?? "mean");
  if (!["mean", "median", "min", "max", "sum"].includes(method)) throw new Error(`Unsupported aggregation method: ${method}`);
  return frame.groupAggregate(groupSize, start, end, method as "mean" | "median" | "min" | "max" | "sum");
}

export function groupByAggregate(frame: Table, params: Record<string, unknown>): Table {
  const groupBy = resolveColumns(frame, params.groupBy);
  if (!groupBy.length) throw new Error("Groupby aggregate requires at least one grouping column");
  const allowed = new Set(["mean", "median", "sum", "min", "max", "std", "count"]);
  const aggregateMode = String(params.aggregateMode ?? "single");
  const groupIndexes = groupBy.map((column) => frame.columnIndex(column));
  const groups = new Map<string, { keys: unknown[]; rows: unknown[][] }>();
  for (const row of frame.rows()) {
    const keys = groupIndexes.map((index) => row[index]);
    if (keys.some((value) => isMissing(value))) continue;
    const encoded = JSON.stringify(keys);
    const group = groups.get(encoded) ?? { keys, rows: [] };
    group.rows.push(row);
    groups.set(encoded, group);
  }
  const sorted = [...groups.values()].sort((left, right) => JSON.stringify(left.keys).localeCompare(JSON.stringify(right.keys), undefined, { numeric: true }));

  const aggregate = (values: number[], method: string): number | null => {
    if (method === "count") return values.length;
    if (!values.length) return null;
    if (method === "sum") return values.reduce((total, value) => total + value, 0);
    if (method === "min") return Math.min(...values);
    if (method === "max") return Math.max(...values);
    if (method === "mean") return values.reduce((total, value) => total + value, 0) / values.length;
    if (method === "median") {
      const ordered = [...values].sort((a, b) => a - b);
      const middle = Math.floor(ordered.length / 2);
      return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    }
    if (values.length < 2) return null;
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1));
  };

  if (aggregateMode === "multi") {
    let spec: unknown = params.aggregations;
    if (typeof spec === "string") {
      const text = spec.trim();
      if (!text) throw new Error("Groupby multi aggregation requires an aggregations object");
      try { spec = JSON.parse(text); }
      catch { throw new Error("Groupby aggregations must be a JSON object"); }
    }
    if (!spec || typeof spec !== "object" || Array.isArray(spec) || !Object.keys(spec as Record<string, unknown>).length) {
      throw new Error("Groupby aggregations must be a non-empty object");
    }
    const items: Array<{ column: string; index: number; method: string; output: string }> = [];
    for (const [rawColumn, rawMethods] of Object.entries(spec as Record<string, unknown>)) {
      const column = resolveColumn(frame, rawColumn);
      const methods = Array.isArray(rawMethods) ? rawMethods : [rawMethods];
      if (!methods.length) throw new Error(`Groupby aggregation for ${column} is empty`);
      for (const rawMethod of methods) {
        const method = String(rawMethod);
        if (!allowed.has(method)) throw new Error(`Unsupported groupby method: ${method}`);
        const output = `${column}_${method}`;
        if (items.some((item) => item.output === output)) throw new Error(`Duplicate groupby aggregation: ${output}`);
        items.push({ column, index: frame.columnIndex(column), method, output });
      }
    }
    return new Table(
      [...groupBy, ...items.map((item) => item.output)],
      sorted.map((group) => [
        ...group.keys,
        ...items.map((item) => aggregate(group.rows.map((row) => toNumber(row[item.index])).filter((value): value is number => value !== null), item.method)),
      ]),
    );
  }

  const method = String(params.method ?? "mean");
  if (!allowed.has(method)) throw new Error(`Unsupported groupby method: ${method}`);
  if (method === "count") return new Table([...groupBy, "count"], sorted.map((group) => [...group.keys, group.rows.length]));
  const numericIndexes = frame.columns
    .map((column, index) => ({ column, index }))
    .filter(({ index }) => !groupIndexes.includes(index))
    .filter(({ index }) => {
      const present = frame.column(index).filter((value) => !isMissing(value));
      return present.length > 0 && present.every((value) => typeof value === "number" || typeof value === "boolean");
    })
    .map(({ index }) => index);
  return new Table(
    [...groupBy, ...numericIndexes.map((index) => frame.columns[index])],
    sorted.map((group) => [
      ...group.keys,
      ...numericIndexes.map((index) => aggregate(group.rows.map((row) => toNumber(row[index])).filter((value): value is number => value !== null), method)),
    ]),
  );
}

export function filterRange(frame: Table, params: Record<string, unknown>): Table {
  const columnIndex = Number(params.column ?? 0);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= frame.columns.length) {
    throw new Error(`Filter column index out of range: ${columnIndex}`);
  }
  const min = optionalFloat(params.min);
  const max = optionalFloat(params.max);
  return frame.filterRange(columnIndex, min, max);
}
