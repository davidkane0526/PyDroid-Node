import { Table } from "../../table";
import type { ExecutionContext } from "./types";
import { readCsv } from "./io";

export type CsvCollectionResult = { tables: Table[]; metadata: Table; warnings: string[] };

function compareMetadataValues(left: unknown, right: unknown): number {
  const leftNumber = typeof left === "number" ? left : Number.NaN;
  const rightNumber = typeof right === "number" ? right : Number.NaN;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
  if (right === null || right === undefined) return -1;
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}

export function readCsvCollection(context: ExecutionContext, params: Record<string, unknown>): CsvCollectionResult {
  if (!context.inputFiles.length) throw new Error("Batch CSV collection input requires at least one selected file");
  const sourceColumn = String(params.sourceColumn ?? "source_file").trim() || "source_file";
  const metadataColumn = String(params.metadataColumn ?? "Vg_V").trim();
  const filenamePattern = String(params.filenamePattern ?? "gate-([-+]?\\d+(?:\\.\\d+)?)v").trim();
  const metadataType = String(params.metadataType ?? "number");
  const metadataError = String(params.metadataError ?? "error");
  const duplicateMetadata = String(params.duplicateMetadata ?? "error");
  const orderBy = String(params.orderBy ?? (filenamePattern && metadataColumn ? "metadata_asc" : "source_file"));
  const onError = String(params.onError ?? "error");
  if (!new Set(["number", "text"]).has(metadataType)) throw new Error(`Unsupported CSV collection metadataType: ${metadataType}`);
  if (!new Set(["error", "warn"]).has(metadataError)) throw new Error(`Unsupported CSV collection metadataError: ${metadataError}`);
  if (!new Set(["error", "warn"]).has(duplicateMetadata)) throw new Error(`Unsupported CSV collection duplicateMetadata: ${duplicateMetadata}`);
  if (!new Set(["error", "skip"]).has(onError)) throw new Error(`Unsupported CSV collection onError: ${onError}`);
  if (filenamePattern && metadataColumn && metadataColumn === sourceColumn) throw new Error("CSV collection metadataColumn must differ from sourceColumn");
  const warnings: string[] = [];
  const failures: string[] = [];
  const entries: Array<{ inputIndex: number; sourceFile: string; metadataValue: unknown; table: Table }> = [];
  let pattern: RegExp | null = null;
  if (filenamePattern && metadataColumn) {
    try { pattern = new RegExp(filenamePattern, "i"); }
    catch (error) { throw new Error(`Invalid filename metadata regex: ${error instanceof Error ? error.message : String(error)}`); }
  }

  context.inputFiles.forEach((item, inputIndex) => {
    const sourceFile = String(item.name ?? `file_${inputIndex + 1}.csv`);
    const text = item.text;
    if (typeof text !== "string") {
      const message = `${sourceFile}: missing text content`;
      if (onError === "skip") warnings.push(message); else failures.push(message);
      return;
    }
    try {
      const table = readCsv(text, params);
      let metadataValue: unknown = null;
      if (pattern && metadataColumn) {
        const match = sourceFile.match(pattern);
        if (!match) {
          const message = `${sourceFile}: filename does not match pattern ${filenamePattern}`;
          if (metadataError === "warn") warnings.push(message); else throw new Error(message);
        } else {
          const captured = match[1] ?? match[0];
          if (metadataType === "number") {
            const parsed = Number(captured);
            if (!Number.isFinite(parsed)) {
              const message = `${sourceFile}: metadata ${JSON.stringify(captured)} is not a finite number`;
              if (metadataError === "warn") warnings.push(message); else throw new Error(message);
            } else metadataValue = parsed;
          } else metadataValue = captured;
        }
      }
      entries.push({ inputIndex, sourceFile, metadataValue, table });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (onError === "skip" && !message.startsWith(`${sourceFile}: filename`) && !message.startsWith(`${sourceFile}: metadata`)) warnings.push(`${sourceFile}: ${message}`);
      else failures.push(message.startsWith(`${sourceFile}:`) ? message : `${sourceFile}: ${message}`);
    }
  });

  if (failures.length) throw new Error(`Batch CSV collection errors: ${failures.join("; ")}`);
  if (!entries.length) throw new Error("No CSV file could be read into the collection");

  if (pattern && metadataColumn) {
    const grouped = new Map<string, string[]>();
    for (const entry of entries) {
      if (entry.metadataValue === null || entry.metadataValue === undefined) continue;
      const key = `${typeof entry.metadataValue}:${String(entry.metadataValue)}`;
      const files = grouped.get(key) ?? [];
      files.push(entry.sourceFile);
      grouped.set(key, files);
    }
    for (const [key, files] of grouped) {
      if (files.length < 2) continue;
      const value = key.slice(key.indexOf(":") + 1);
      const message = `Duplicate ${metadataColumn}=${value}: ${files.join(", ")}`;
      if (duplicateMetadata === "warn") warnings.push(message); else failures.push(message);
    }
    if (failures.length) throw new Error(`Batch CSV collection metadata errors: ${failures.join("; ")}`);
  }

  entries.sort((left, right) => {
    if (orderBy === "input") return left.inputIndex - right.inputIndex;
    if (orderBy === "source_file") return left.sourceFile.localeCompare(right.sourceFile, undefined, { numeric: true }) || left.inputIndex - right.inputIndex;
    if (orderBy === "metadata_asc" || orderBy === "metadata_desc") {
      if (!pattern || !metadataColumn) throw new Error(`orderBy=${orderBy} requires filename metadata extraction`);
      const leftMissing = left.metadataValue === null || left.metadataValue === undefined;
      const rightMissing = right.metadataValue === null || right.metadataValue === undefined;
      if (leftMissing || rightMissing) return leftMissing === rightMissing ? left.sourceFile.localeCompare(right.sourceFile, undefined, { numeric: true }) : leftMissing ? 1 : -1;
      const compared = compareMetadataValues(left.metadataValue, right.metadataValue);
      return (orderBy === "metadata_desc" ? -compared : compared) || left.sourceFile.localeCompare(right.sourceFile, undefined, { numeric: true });
    }
    throw new Error(`Unsupported CSV collection orderBy: ${orderBy}`);
  });

  const metadataColumns = metadataColumn && pattern ? [sourceColumn, metadataColumn] : [sourceColumn];
  const metadataRows = entries.map((entry) => metadataColumn && pattern ? [entry.sourceFile, entry.metadataValue] : [entry.sourceFile]);
  return { tables: entries.map((entry) => entry.table), metadata: new Table(metadataColumns, metadataRows), warnings };
}
