// 值 → 可读文本：对齐原引擎 _printable。
import { Table } from "./table";

export function printable(
  value: unknown,
  limit = 8000,
  maxRows = 20,
  mode: "pretty" | "repr" | "text" | "json" = "pretty",
  includeType = true,
): string {
  let text: string;
  if (mode === "repr") {
    text = safeString(value);
  } else if (mode === "text") {
    text = String(value);
  } else if (mode === "json") {
    text = JSON.stringify(jsonNormalize(value), null, 2);
  } else if (value instanceof Table) {
    text = includeType
      ? `Table · ${value.rowCount} 行 × ${value.columnCount} 列\n${value.head(maxRows).toCSV()}`
      : value.head(maxRows).toCSV();
  } else if (Array.isArray(value)) {
    text = JSON.stringify(value, null, 2);
    if (includeType) text = `Array · ${value.length} 项\n${text}`;
  } else if (value && typeof value === "object") {
    try {
      text = JSON.stringify(jsonNormalize(value), null, 2);
      if (includeType) text = `${(value as object).constructor?.name ?? "Object"} · ${Object.keys(value as object).length} 项\n${text}`;
    } catch {
      text = safeString(value);
    }
  } else {
    text = typeof value === "string" ? value : safeString(value);
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… 已截断，原始长度 ${text.length} 字符`;
}

function jsonNormalize(value: unknown): unknown {
  if (value instanceof Table) return value.records();
  if (Array.isArray(value)) return value.map(jsonNormalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonNormalize(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function safeString(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function singleValue(value: unknown): unknown {
  if (value instanceof Table) {
    if (value.rowCount !== 1 || value.columnCount !== 1) throw new Error("转换为单值要求表格恰好为 1 行 × 1 列");
    return value.rows()[0][0];
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("转换为单值要求列表恰好包含 1 项");
    return value[0];
  }
  return value;
}
