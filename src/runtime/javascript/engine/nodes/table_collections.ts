import { Table } from "../table";
import { requireTable } from "./support/common";
import type { ExecutionContext, NodeOutput } from "./support/types";

export function executeTableCollectionsNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, _context: ExecutionContext): NodeOutput | null {
  const plotResult = null;
  const exportResult: string | null = null;
  switch (nodeType) {
    case "table.concat_many": {
      if (!upstream || typeof upstream !== "object" || upstream instanceof Table || Array.isArray(upstream)) throw new Error("Concat many requires named inputs");
      const inputs = upstream as Record<string, unknown>;
      let tables: Table[];
      if (Array.isArray(inputs.tables) && inputs.tables.length) {
        tables = inputs.tables.map((item, index) => requireTable(item, `Concat many table ${index + 1}`));
      } else {
        const named = Object.entries(inputs)
          .map(([port, value]) => ({ match: /^table(\d+)$/.exec(port), value }))
          .filter((item): item is { match: RegExpExecArray; value: unknown } => Boolean(item.match))
          .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
        if (named.length < 2) throw new Error("Concat many requires a non-empty table list or at least two table Socket inputs");
        tables = named.map((item) => requireTable(item.value, `Concat many table ${item.match[1]}`));
      }
      const alignment = String(params.alignment ?? "index");
      if (alignment !== "position") throw new Error("JavaScript concat_many supports alignment=position only; use Python for pandas index alignment");
      const prefixMode = String(params.prefixMode ?? "metadata");
      const sourceColumn = String(params.sourceColumn ?? "source_file").trim() || "source_file";
      const prefixColumn = String(params.prefixColumn ?? "Vg_V").trim() || "Vg_V";
      const template = String(params.prefixTemplate ?? "{value}");
      const separator = String(params.prefixSeparator ?? "_");
      let metadataRecords: Array<Record<string, unknown>> = [];
      if (prefixMode !== "none") {
        const metadata = requireTable(inputs.metadata, "Concat many metadata");
        if (metadata.rowCount !== tables.length) throw new Error(`Concat many metadata rows (${metadata.rowCount}) must match table count (${tables.length})`);
        metadataRecords = metadata.records();
      }
      const metadataText = (value: unknown): string => {
        if (typeof value !== "number") return String(value);
        if (!Number.isFinite(value)) throw new Error("Concat many metadata prefix must be finite");
        if (Object.is(value, -0) || value === 0) return "0";
        if (Number.isInteger(value)) return value.toFixed(0);
        const magnitude = Math.abs(value);
        if (magnitude >= 1e15 || magnitude < 1e-6) {
          const [rawMantissa, rawExponent] = value.toExponential(14).split("e");
          const mantissa = rawMantissa.replace(/\.?0+$/, "");
          const exponent = Number(rawExponent);
          return `${mantissa}e${exponent >= 0 ? "+" : ""}${exponent}`;
        }
        return value.toFixed(14).replace(/\.?0+$/, "");
      };
      const renderedPrefix = (record: Record<string, unknown>, field: string): string => {
        const value = record[field];
        if (value === null || value === undefined || String(value).trim() === "") throw new Error(`Concat many metadata field ${field} is missing`);
        return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => {
          const replacement = key === "value" ? value : record[key];
          if (replacement === null || replacement === undefined) throw new Error(`Concat many prefix template references missing metadata field ${key}`);
          return metadataText(replacement);
        });
      };
      const prepared = tables.map((frame, index) => {
        let prefix = "";
        if (prefixMode === "metadata") prefix = renderedPrefix(metadataRecords[index], prefixColumn);
        else if (prefixMode === "source_file") prefix = renderedPrefix(metadataRecords[index], sourceColumn);
        else if (prefixMode !== "none") throw new Error(`Unsupported concat_many prefixMode: ${prefixMode}`);
        const columns = frame.columns.map((column) => prefixMode === "none" ? column : `${prefix}${separator}${column}`);
        return { columns, rows: frame.rows() };
      });
      const outputColumns = prepared.flatMap((frame) => frame.columns);
      if (new Set(outputColumns).size !== outputColumns.length) throw new Error("Concat many would create duplicate column names; enable a distinguishing prefix");
      const height = Math.max(...prepared.map((frame) => frame.rows.length));
      const outputRows = Array.from({ length: height }, (_, rowIndex) => prepared.flatMap((frame) => frame.rows[rowIndex] ?? frame.columns.map(() => null)));
      const value = new Table(outputColumns, outputRows);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    default:
      return null;
  }
}
