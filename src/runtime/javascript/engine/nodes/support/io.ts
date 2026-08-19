import { Table } from "../../table";
import { parseCsv } from "../../csv";
import { asBool, parameterList } from "./common";
import type { ExecutionContext } from "./types";
export function selectedFile(context: ExecutionContext, params: Record<string, unknown>): { name: string; text?: string; base64?: string } {
  if (!context.inputFiles.length) throw new Error("该读取节点需要先选择或拖入文件");
  const index = Number(params.fileIndex ?? 0);
  if (!Number.isInteger(index) || index < 0 || index >= context.inputFiles.length) {
    throw new Error(`文件序号 ${index} 超出范围；当前共 ${context.inputFiles.length} 个文件`);
  }
  return context.inputFiles[index];
}

export function decodeJsonCompatible(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // 兼容 Python 字面量（单引号 / True / None）
    const converted = text
      .replace(/([{,]\s*)'([^']*)'(\s*[:,\]}])/g, "$1\"$2\"$3")
      .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, "$1\"$2\":")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    try {
      return JSON.parse(converted);
    } catch {
      throw new Error(`${label} 格式错误：${text.slice(0, 90)}`);
    }
  }
}

export function readCsv(csvText: string, params: Record<string, unknown>): Table {
  const separator = String(params.separator ?? ",");
  const headerRaw = String(params.header ?? "none").trim().toLowerCase();
  const header = headerRaw === "" || headerRaw === "none" ? "none" : headerRaw === "infer" ? 0 : Number(headerRaw);
  const skipRows = params.skipRows;
  let skip: number | number[] | undefined;
  if (skipRows !== null && skipRows !== undefined && String(skipRows).trim() !== "" && String(skipRows).trim() !== "0") {
    const text = String(skipRows).trim();
    if (text.includes(",") || text.startsWith("[")) {
      skip = parameterList(text, true).map(Number);
    } else {
      skip = Number(text);
    }
  }
  return parseCsv(csvText, {
    separator,
    header: header as "none" | 0,
    names: parameterList(params.names).map(String),
    useColumns: parameterList(params.useColumns, true).map((item) => (typeof item === "number" ? item : String(item))),
    skipRows: skip,
    skipFooter: Number(params.skipFooter ?? 0),
    nRows: Number(params.nRows ?? 0) || undefined,
    skipInitialSpace: asBool(params.skipInitialSpace ?? false),
    naValues: parameterList(params.naValues).map(String),
    keepDefaultNa: asBool(params.keepDefaultNa ?? true),
    naFilter: asBool(params.naFilter ?? true),
    trueValues: parameterList(params.trueValues).map(String),
    falseValues: parameterList(params.falseValues).map(String),
    skipBlankLines: asBool(params.skipBlankLines ?? true),
    parseDates: parameterList(params.parseDates, true).map((item) => (typeof item === "number" ? item : String(item))),
    thousands: String(params.thousands ?? "") || undefined,
    decimal: String(params.decimal ?? "."),
    quoteChar: String(params.quoteChar ?? '"'),
    doubleQuote: asBool(params.doubleQuote ?? true),
    escapeChar: String(params.escapeChar ?? "") || undefined,
    comment: String(params.comment ?? "") || undefined,
    onBadLines: (String(params.onBadLines ?? "error") as "error" | "warn" | "skip"),
  });
}

export function readCsvBatch(context: ExecutionContext, params: Record<string, unknown>): Table {
  if (!context.inputFiles.length) throw new Error("Batch CSV input requires at least one selected file");
  const sourceColumn = String(params.sourceColumn ?? "source_file").trim() || "source_file";
  const metadataColumn = String(params.metadataColumn ?? "Vg_V").trim();
  const filenamePattern = String(params.filenamePattern ?? "vg\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*v").trim();
  const onError = String(params.onError ?? "error");
  const frames: Table[] = [];
  const errors: string[] = [];
  for (const item of context.inputFiles) {
    const name = String(item.name ?? "unnamed.csv");
    const text = item.text;
    if (typeof text !== "string") {
      errors.push(`${name}: missing text content`);
      continue;
    }
    try {
      const frame = readCsv(text, params);
      let table = frame.setColumn(sourceColumn, Array(frame.rowCount).fill(name));
      if (metadataColumn && filenamePattern) {
        const match = name.match(new RegExp(filenamePattern, "i"));
        if (!match) throw new Error(`filename does not match pattern ${filenamePattern!}`);
        const capturedText = match[1] ?? match[0];
        const captured = /^-?\d+(\.\d+)?$/.test(capturedText) ? Number(capturedText) : capturedText;
        table = table.setColumn(metadataColumn, Array(table.rowCount).fill(captured));
      }
      frames.push(table);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length && onError === "error") throw new Error(`Batch CSV errors: ${errors.join("; ")}`);
  if (!frames.length) throw new Error("No CSV file could be read");
  let merged = frames[0];
  for (const frame of frames.slice(1)) merged = merged.concat(frame, 0, true);
  return merged;
}
