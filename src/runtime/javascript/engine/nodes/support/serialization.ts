import { Table } from "../../table";
export function jsonSafe(value: unknown): unknown {
  if (value instanceof Table) return value.records();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}
