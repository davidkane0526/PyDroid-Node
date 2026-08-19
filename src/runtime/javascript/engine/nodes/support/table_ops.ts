import { Table, toNumber } from "../../table";
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
  const method = String(params.method ?? "mean");
  if (!["mean", "median", "sum", "min", "max", "std", "count"].includes(method)) {
    throw new Error(`Unsupported groupby method: ${method}`);
  }
  const groupIndexes = groupBy.map((column) => frame.columnIndex(column));
  const numericIndexes = frame.columns
    .map((column, index) => ({ column, index }))
    .filter(({ index }) => !groupIndexes.includes(index))
    .filter(({ index }) => frame.column(index).some((value) => toNumber(value) !== null))
    .map(({ index }) => index);
  const groups = new Map<string, { keys: unknown[]; rows: unknown[][] }>();
  for (const row of frame.rows()) {
    const keys = groupIndexes.map((index) => row[index]);
    const encoded = JSON.stringify(keys);
    const group = groups.get(encoded) ?? { keys, rows: [] };
    group.rows.push(row);
    groups.set(encoded, group);
  }
  const sorted = [...groups.values()].sort((left, right) => JSON.stringify(left.keys).localeCompare(JSON.stringify(right.keys), undefined, { numeric: true }));
  if (method === "count") {
    return new Table([...groupBy, "count"], sorted.map((group) => [...group.keys, group.rows.length]));
  }
  const aggregate = (values: number[]): number | null => {
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
    if (values.length < 2) return null; // pandas std uses ddof=1
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1));
  };
  return new Table(
    [...groupBy, ...numericIndexes.map((index) => frame.columns[index])],
    sorted.map((group) => [
      ...group.keys,
      ...numericIndexes.map((index) => aggregate(group.rows.map((row) => toNumber(row[index])).filter((value): value is number => value !== null))),
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
