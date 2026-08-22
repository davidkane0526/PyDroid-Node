import { parseCsv } from "../csv";
import { executeCustomFunction, executeJsCell } from "../notebook";
import { printable, singleValue } from "../printable";
import { Table, tableFromValue } from "../table";
import { asBool, requireTable } from "./support/common";
import { jsonSafe } from "./support/serialization";
import type { ExecutionContext, NodeOutput } from "./support/types";

export function executeConversionUiNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput | null {
  const tableResult: Table | null = null;
  const plotResult = null;
  const exportResult: string | null = null;
  const table = (): Table => requireTable(upstream, "Table input");

  switch (nodeType) {
    case "io.export_csv": {
      const content = `${table().toCSV(false, "\n")}\n`;
      return { outputs: { output: content }, tableResult, plotResult, exportResult: content };
    }
    case "convert.to_text": {
      const value = asBool(params.pretty ?? true) ? printable(upstream) : String(upstream);
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "convert.to_number": {
      const raw = singleValue(upstream);
      const value = asBool(params.integer ?? false) ? Math.trunc(Number(raw)) : Number(raw);
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "convert.to_boolean": {
      const raw = singleValue(upstream);
      let value: boolean;
      if (typeof raw === "string") {
        const token = raw.trim().toLowerCase();
        if (["true", "1", "yes", "y", "是", "真"].includes(token)) value = true;
        else if (["false", "0", "no", "n", "否", "假", "", "none", "null"].includes(token)) value = false;
        else throw new Error(`无法将文本 ${raw} 转换为布尔值`);
      } else {
        value = Boolean(raw);
      }
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "convert.to_table": {
      let value: Table;
      if (upstream instanceof Table) value = upstream.copy();
      else if (asBool(params.csvText ?? false) && typeof upstream === "string") value = parseCsv(upstream);
      else if (upstream && typeof upstream === "object" && !Array.isArray(upstream)) {
        try {
          value = Table.fromObject(upstream as Record<string, unknown>);
        } catch {
          value = new Table(["value"], [[JSON.stringify(upstream)]]);
        }
      }
      else if (Array.isArray(upstream)) value = tableFromValue(upstream, "Table");
      else value = new Table(["value"], [[upstream ?? null]]);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "convert.table_to_records": {
      const value = table().records();
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "convert.table_to_csv": {
      const value = `${table().toCSV(asBool(params.includeIndex ?? false), "\n")}\n`;
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "convert.json_parse": {
      return { outputs: { output: JSON.parse(String(upstream)) }, tableResult, plotResult, exportResult };
    }
    case "convert.json_stringify": {
      const indent = Math.max(0, Math.min(8, Number(params.indent ?? 2)));
      const safe = jsonSafe(upstream);
      // Python json.dumps(..., indent=0) is newline-formatted with zero leading
      // indentation; JSON.stringify(..., null, 0) is compact. Preserve Python
      // semantics so the node is runtime-neutral.
      const value = indent === 0
        ? JSON.stringify(safe, null, 1).split("\n").map((line) => line.trimStart()).join("\n")
        : JSON.stringify(safe, null, indent);
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "python.len": {
      if (upstream instanceof Table) return { outputs: { output: upstream.rowCount }, tableResult, plotResult, exportResult };
      if (Array.isArray(upstream) || typeof upstream === "string") return { outputs: { output: upstream.length }, tableResult, plotResult, exportResult };
      if (upstream && typeof upstream === "object") return { outputs: { output: Object.keys(upstream).length }, tableResult, plotResult, exportResult };
      throw new Error("python.len requires a sized input");
    }
    case "python.round": {
      if (typeof upstream !== "number") throw new Error("Python round requires a numeric input");
      const digits = Number(params.digits ?? 0);
      const factor = 10 ** digits;
      return { outputs: { output: Math.round(upstream * factor) / factor }, tableResult, plotResult, exportResult };
    }
    case "python.print": {
      const prefix = String(params.prefix ?? "").trim();
      const rendered = printable(upstream, Number(params.maxChars ?? 8000), Number(params.maxRows ?? 20), String(params.format ?? "pretty") as "pretty" | "repr" | "text" | "json", asBool(params.includeType ?? true));
      const text = (prefix ? `${prefix}：` : "") + rendered + String(params.end ?? "");
      return { outputs: { output: upstream, __print__: text }, tableResult, plotResult, exportResult };
    }
    case "ui.alert": {
      const content = upstream && typeof upstream === "object" && !Array.isArray(upstream) ? (upstream as Record<string, unknown>).content : upstream;
      const rendered = `${String(params.title ?? "提示").trim()}：${String(params.message ?? "").trim()}` + (content !== null && content !== undefined ? `\n${printable(content, 4000, 20)}` : "");
      const response = params.response;
      const reported = `${rendered}\n选择：${String(response)}`;
      return { outputs: { output: response, __print__: reported.slice(0, 1000) }, tableResult, plotResult, exportResult };
    }
    case "ui.input_dialog": {
      const rawValue = params.value ?? "";
      const inputKind = String(params.inputKind ?? "text");
      let value: unknown;
      let tableResultValue: Table | null = null;
      if (inputKind === "number") {
        const number = Number(rawValue);
        if (Number.isNaN(number)) throw new Error("弹窗输入节点需要有效数值");
        value = Number.isInteger(number) ? number : number;
      } else if (inputKind === "boolean") {
        value = asBool(rawValue);
      } else if (inputKind === "json") {
        try {
          value = JSON.parse(String(rawValue));
        } catch (error) {
          throw new Error(`弹窗输入的 JSON 无效：${(error as Error).message}`);
        }
      } else if (inputKind === "table") {
        const text = String(rawValue).trim();
        try {
          value = Table.fromRecords(JSON.parse(text) as Array<Record<string, unknown>>);
        } catch {
          value = parseCsv(text, { header: 0 });
        }
        tableResultValue = value as Table;
      } else {
        value = String(rawValue);
      }
      return { outputs: { output: value }, tableResult: tableResultValue, plotResult, exportResult };
    }
    case "custom.python_function": {
      const outputs = executeCustomFunction(String(params.code ?? ""), (upstream as Record<string, unknown>) ?? {}, params);
      const tableValue = Object.values(outputs).find((item) => item instanceof Table);
      return { outputs, tableResult: tableValue instanceof Table ? tableValue : null, plotResult, exportResult };
    }
    case "notebook.code_cell": {
      const source = String(params.source ?? "");
      const result = executeJsCell(source, context.notebookNamespace);
      return { outputs: result.outputs, tableResult: result.table, plotResult: result.plot, exportResult };
    }
    case "notebook.markdown_cell": {
      const text = String(params.source ?? "");
      return { outputs: { next: text, output: text }, tableResult, plotResult, exportResult };
    }
    default:
      return null;
  }
}
