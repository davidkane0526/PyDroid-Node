import { Table, tableFromValue } from "../table";

export function semanticValue(value: unknown): unknown {
  if (value instanceof Table) return value.records();
  if (Array.isArray(value)) return value.map(semanticValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, semanticValue(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  return String(value);
}

export function previewOf(table: Table | null, latestValue: unknown): { columns: string[]; rows: Array<Array<string | number | boolean | null>>; totalRows: number; totalColumns: number } {
  if (table) return table.preview(500);
  return new Table(["result"], [[typeof latestValue === "string" ? latestValue : String(latestValue ?? "")]]).preview(500);
}

export function environmentInfoJson(): string {
  return JSON.stringify({
    runtimeVersion: "1.0.0 (WebAssembly-free)",
    packages: [
      { name: "jsEngine", version: "1.0.0" },
      { name: "table", version: "1.0.0" },
      { name: "echarts", version: "6.1.0" },
    ],
  });
}


function stableOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return JSON.stringify(semanticValue(value));
  if (Array.isArray(value)) return `List · ${value.length}`;
  return "Object";
}

export function outputPreviews(outputs: Record<string, unknown>, plotResult: unknown = null, nodeType = ""): Record<string, unknown> | undefined {
  const entries = Object.entries(outputs).filter(([key]) => !key.startsWith("__") && !(nodeType.startsWith("notebook.") && key === "output"));
  if (entries.length <= 1) return undefined;
  return Object.fromEntries(entries.map(([port, value]) => {
    if (value instanceof Table) return [port, { kind: "table", preview: value.preview(200) }];
    if (plotResult !== null && value === plotResult) return [port, { kind: "plot", chart: plotResult }];
    const scalar = value === null || ["string", "number", "boolean"].includes(typeof value);
    return [port, { kind: "value", text: stableOutputText(value), ...(scalar ? { value: semanticValue(value) } : {}) }];
  }));
}

export function errorResponse(
  message: string,
  nodeId = "__workflow__",
  nodeType = "workflow",
  nodeResults: Record<string, unknown> = {},
  nodeTimingsMs: Record<string, number> = {},
  executionOrder: string[] = [],
  preview: unknown = null,
  debugTraceback?: string,
): Record<string, unknown> {
  return {
    status: "error",
    nodeId,
    nodeType,
    message,
    nodeResults,
    nodeTimingsMs,
    executionOrder,
    preview,
    debugTraceback: debugTraceback ?? null,
  };
}

export function roundMs(milliseconds: number): number {
  return Math.round(milliseconds * 1000) / 1000;
}

export function printableText(value: unknown, limit = 4000): string {
  if (value instanceof Table) return value.toString();
  if (typeof value === "string") return value.length > limit ? value.slice(0, limit) : value;
  try {
    const text = JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) : text;
  } catch {
    return String(value);
  }
}

export function tableFromAny(value: unknown): Table {
  return tableFromValue(value, "Table");
}
