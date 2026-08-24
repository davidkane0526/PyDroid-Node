import { Table } from "../../table";
export function asBool(raw: unknown): boolean {
  if (typeof raw === "string") return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  return Boolean(raw);
}

export function optionalFloat(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric parameter: ${raw}`);
  return number;
}

export function scalarValue(raw: unknown): unknown {
  const text = String(raw);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parameterList(raw: unknown, numericWhenPossible = false): unknown[] {
  if (raw === null || raw === undefined || String(raw).trim() === "") return [];
  let items: unknown[];
  if (Array.isArray(raw)) {
    items = raw;
  } else {
    const text = String(raw).trim();
    if (text.startsWith("[")) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array or comma-separated values");
      items = parsed;
    } else {
      items = text.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  if (numericWhenPossible && items.length && items.every((item) => /^-?\d+$/.test(String(item).trim()))) {
    return items.map((item) => Number(item));
  }
  return items.map((item) => String(item));
}

function columnReferenceItems(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "number") return [raw];
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Column references must be a JSON array or comma-separated values");
    return parsed;
  }
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function columnIndex(raw: unknown): number {
  if (typeof raw === "boolean") throw new Error(`Invalid column index: ${raw}`);
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(value)) throw new Error(`Invalid column index: ${String(raw).trim()}`);
  return value;
}

export function parseColumns(raw: unknown, columnCount: number): number[] {
  const items = columnReferenceItems(raw);
  if (!items.length) return Array.from({ length: columnCount }, (_, i) => i);
  const columns = items.map(columnIndex);
  const invalid = columns.filter((column) => column < 0 || column >= columnCount);
  if (invalid.length) throw new Error(`Column indexes out of range: ${invalid.join(",")}`);
  return columns;
}

export function resolveColumn(table: Table, raw: unknown): string {
  const value = String(raw).trim();
  if (!value) throw new Error("Column name is required");
  if (table.columns.includes(value)) return value;
  let index: number;
  try { index = columnIndex(raw); }
  catch { throw new Error(`Unknown column: ${value}`); }
  if (index < 0 || index >= table.columns.length) throw new Error(`Column index out of range: ${index}`);
  return table.columns[index];
}

export function resolveColumns(table: Table, raw: unknown): string[] {
  return columnReferenceItems(raw).map((item) => resolveColumn(table, item));
}

export function renameColumns(table: Table, raw: unknown): Table {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Column names are required");
  if (text.startsWith("{")) {
    const mapping = JSON.parse(text) as Record<string, unknown>;
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Column mapping must be a JSON object");
    const resolved = Object.fromEntries(Object.entries(mapping).map(([key, value]) => [resolveColumn(table, key), String(value)]));
    const columns = table.columns.map((column) => resolved[column] ?? column);
    return new Table(columns, table.rows());
  }
  const names = text.split(",").map((item) => item.trim());
  if (names.length !== table.columns.length || names.some((name) => !name)) {
    throw new Error(`Expected ${table.columns.length} non-empty column names, received ${names.length}`);
  }
  return table.renameColumns(names);
}

export function requireTable(value: unknown, operation: string): Table {
  if (!(value instanceof Table)) throw new Error(`${operation} requires a table input`);
  return value;
}
