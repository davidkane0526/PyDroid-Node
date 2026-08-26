import { PortableRandom } from "../random";
import { Table } from "../table";
import { parseCsv } from "../csv";
import { asBool, parameterList, requireTable } from "./support/common";
import { decodeJsonCompatible, readCsv, readCsvBatch, selectedFile } from "./support/io";
import { readCsvCollection } from "./support/io_collection";
import type { ExecutionContext, NodeOutput } from "./support/types";

export function executeIoGenerateNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput | null {
  const tableResult: Table | null = null;
  const plotResult = null;
  const exportResult: string | null = null;
  const table = (): Table => requireTable(upstream, "Table input");

  switch (nodeType) {
    case "value.number": {
      return { outputs: { output: Number(params.value ?? 0) }, tableResult, plotResult, exportResult };
    }
    case "value.text": {
      return { outputs: { output: String(params.value ?? "") }, tableResult, plotResult, exportResult };
    }
    case "value.boolean": {
      return { outputs: { output: Boolean(params.value) }, tableResult, plotResult, exportResult };
    }
    case "value.color": {
      return { outputs: { output: String(params.value ?? "#3b82f6") }, tableResult, plotResult, exportResult };
    }
    case "value.datetime": {
      return { outputs: { output: String(params.value ?? "") }, tableResult, plotResult, exportResult };
    }
    case "io.read_text": {
      const file = selectedFile(context, params);
      return { outputs: { output: String(file.text ?? "") }, tableResult, plotResult, exportResult };
    }
    case "io.read_json": {
      const file = selectedFile(context, params);
      return { outputs: { output: decodeJsonCompatible(String(file.text ?? ""), "JSON 文件") }, tableResult, plotResult, exportResult };
    }
    case "io.read_table": {
      const file = selectedFile(context, params);
      const text = String(file.text ?? "");
      const name = String(file.name ?? "").toLowerCase();
      let value: Table;
      if (name.endsWith(".json")) {
        const decoded = decodeJsonCompatible(text, "JSON 表格");
        value = Array.isArray(decoded) ? Table.fromRecords(decoded as Array<Record<string, unknown>>) : new Table(["value"], [[decoded]]);
      } else {
        const separator = String(params.separator ?? "auto");
        const auto = separator === "auto" ? (name.endsWith(".tsv") || name.endsWith(".dat")) && text.split("\n")[0]?.includes("\t") ? "\t" : undefined : separator;
        value = parseCsv(text, { separator: auto, header: asBool(params.header ?? true) ? 0 : "none" });
      }
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "io.read_image": {
      const file = selectedFile(context, params);
      const encoded = String(file.base64 ?? "");
      if (!encoded) throw new Error("图片读取需要原始二进制内容；请重新选择图片文件");
      return { outputs: { output: `data:image/png;base64,${encoded}` }, tableResult, plotResult: { type: "line", option: { graphic: [{ type: "image", style: { image: `data:image/png;base64,${encoded}` }, left: 0, top: 0 }] } }, exportResult };
    }
    case "io.read_csv": {
      const value = readCsv(context.csvText, params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "io.read_csv_batch": {
      const value = readCsvBatch(context, params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "io.read_csv_collection": {
      const value = readCsvCollection(context, params);
      return { outputs: { output: value.tables, metadata: value.metadata, warnings: value.warnings }, tableResult: value.metadata, plotResult, exportResult };
    }
    case "generate.empty_list": {
      return { outputs: { output: [] }, tableResult, plotResult, exportResult };
    }
    case "generate.empty_table": {
      const columns = parameterList(params.columns).map(String).map((item) => item.trim()).filter(Boolean);
      const value = new Table(columns, []);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "generate.random_table": {
      const count = Math.trunc(Number(params.count ?? 100));
      if (!Number.isFinite(count) || count < 1 || count > 1_000_000) throw new Error("Random table count must be between 1 and 1,000,000");
      const distribution = String(params.distribution ?? "uniform");
      const seed = Math.trunc(Number(params.seed ?? 0));
      const random = new PortableRandom(seed);
      const minimum = Number(params.min ?? 0);
      const maximum = Number(params.max ?? 1);
      const mean = Number(params.mean ?? 0);
      const std = Number(params.std ?? 1);
      if (![minimum, maximum, mean, std].every(Number.isFinite)) throw new Error("Random table parameters must be finite numbers");
      if (distribution !== "normal" && maximum < minimum) throw new Error("Random max must be greater than or equal to min");
      if (distribution === "normal" && std < 0) throw new Error("Random normal std must be non-negative");
      const values: number[] = [];
      for (let index = 0; index < count; index += 1) {
        if (distribution === "normal") {
          values.push(random.normal(mean, std));
        } else if (distribution === "integer") {
          const low = Math.ceil(minimum);
          const high = Math.floor(maximum);
          if (high < low) throw new Error("Random integer range contains no integer values");
          values.push(random.integer(low, high));
        } else {
          values.push(minimum + random.next() * (maximum - minimum));
        }
      }
      const indexColumn = String(params.indexColumn ?? "index").trim() || "index";
      const valueColumn = String(params.valueColumn ?? "value").trim() || "value";
      if (indexColumn === valueColumn) throw new Error("Random table indexColumn and valueColumn must be different");
      const value = new Table([indexColumn, valueColumn], values.map((item, index) => [index, item]));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    default:
      return null;
  }
}
