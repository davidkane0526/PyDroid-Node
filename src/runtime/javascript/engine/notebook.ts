// Notebook：JS 代码单元执行与 .ipynb 导入分析。
// 原 Python 引擎执行 Python 代码；替换后代码单元改为执行 JS 代码，
// 命名空间提供 Table / pd / np / plt / math 等 JS 等价 API。
import { Table, tableFromValue } from "./table";
import { parseCsv } from "./csv";
import { linePlot, type PlotChart } from "./plots";

export type NotebookCellAnalysis = {
  index: number;
  recognized: boolean;
  reason?: string;
  nodeType?: string;
  label?: string;
  parameters?: Record<string, string | number | boolean | null>;
  inputVariable?: string | null;
  outputVariable?: string | null;
};

export type NotebookCellResult = {
  outputs: Record<string, unknown>;
  table: Table | null;
  plot: PlotChart | null;
  text: string;
};

// ---- JS 命名空间 API ----

function arange(start: number, stop?: number, step?: number): number[] {
  if (stop === undefined) {
    stop = start;
    start = 0;
  }
  const stride = step ?? 1;
  if (stride === 0) throw new Error("np.arange step cannot be zero");
  const result: number[] = [];
  if (stride > 0) {
    for (let value = start; value < stop; value += stride) result.push(value);
  } else {
    for (let value = start; value > stop; value += stride) result.push(value);
  }
  return result;
}

function linspace(start: number, stop: number, count = 50): number[] {
  if (count < 2) throw new Error("np.linspace requires at least 2 samples");
  const result: number[] = [];
  const step = (stop - start) / (count - 1);
  for (let i = 0; i < count; i += 1) result.push(start + step * i);
  return result;
}

class PlotCollector {
  charts: PlotChart[] = [];
  private current: Record<string, unknown> | null = null;

  plot(x: unknown, y?: unknown, options: Record<string, unknown> = {}): void {
    const xArray = Array.isArray(x) ? x : [x];
    const yArray = y === undefined ? xArray : Array.isArray(y) ? y : [y];
    const data = xArray.map((value, i) => [value, yArray[i]]);
    if (!this.current) {
      this.current = {
        animation: false,
        tooltip: { trigger: "axis" },
        grid: { left: 48, right: 24, top: 40, bottom: 40 },
        xAxis: { type: "value" },
        yAxis: { type: "value" },
        series: [],
      };
    }
    (this.current.series as unknown[]).push({
      name: options.label ?? "line",
      type: "line",
      data,
      lineStyle: { width: options.lineWidth ?? 1.5 },
      showSymbol: Boolean(options.marker),
    });
  }

  figure(): void {
    // 开始新图
    if (this.current) this.commit();
    this.current = null;
  }

  show(): void {
    this.commit();
  }

  commit(): void {
    if (this.current) {
      this.charts.push({ type: "line", option: this.current });
      this.current = null;
    }
  }
}

function makeNamespace(csvText: string, inputFiles: Array<{ name: string; text?: string; base64?: string }>) {
  const plt = new PlotCollector();
  const namespace: Record<string, unknown> = {
    Table,
    math: Math,
    csv_text: csvText,
    input_files: inputFiles,
    pd: {
      DataFrame: (data: unknown) => {
        if (data instanceof Table) return data;
        if (Array.isArray(data) && data.length && data.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
          return Table.fromRecords(data as Array<Record<string, unknown>>);
        }
        return tableFromValue(data, "pd.DataFrame");
      },
      read_csv: (text: string, options?: Record<string, unknown>) => parseCsv(String(text), options ?? {}),
      concat: (tables: Table[], options?: Record<string, unknown>) => {
        if (!tables.length) throw new Error("pd.concat requires at least one table");
        const ignoreIndex = options?.ignoreIndex ?? true;
        return tables.slice(1).reduce((acc, table) => acc.concat(table, 0, Boolean(ignoreIndex)), tables[0]);
      },
      Series: (data: unknown) => (Array.isArray(data) ? data : [data]),
      to_numeric: (values: unknown[]) => values.map((value: unknown) => {
        const number = Number(value);
        return Number.isNaN(number) ? null : number;
      }),
    },
    np: { arange, linspace, array: (data: unknown) => data, asarray: (data: unknown) => data, zeros: (n: number) => Array.from({ length: n }, () => 0), ones: (n: number) => Array.from({ length: n }, () => 1), sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, mean: (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN), ceil: Math.ceil, floor: Math.floor },
    plt: {
      plot: (x: unknown, y?: unknown, options?: Record<string, unknown>) => plt.plot(x, y, options ?? {}),
      figure: () => plt.figure(),
      show: () => plt.show(),
      title: () => undefined,
      xlabel: () => undefined,
      ylabel: () => undefined,
      legend: () => undefined,
      grid: () => undefined,
    },
  };
  return { namespace, plt };
}

// 创建 JS 代码单元的共享命名空间（pd/np/plt/math/csv_text/input_files）
export function createNotebookNamespace(csvText: string, inputFiles: Array<{ name: string; text?: string; base64?: string }>): Record<string, unknown> {
  const { namespace } = makeNamespace(csvText, inputFiles);
  return namespace;
}

export function executeJsCell(source: string, namespace: Record<string, unknown>): NotebookCellResult {
  const code = String(source ?? "");
  if (!code.trim()) return { outputs: { next: null, output: null }, table: null, plot: null, text: "" };
  const lines = code.split("\n");
  // 分离末尾表达式（类似 Python 引擎的 last expression）
  let body = code;
  let trailingExpression: string | null = null;
  const trimmed = code.trimEnd();
  const lastLine = trimmed.split("\n").pop()?.trim() ?? "";
  if (lastLine && !/^(const|let|var|function|class|if|for|while|return|\/\/|#|\/)/.test(lastLine) && !/;\s*$/.test(lastLine) && !/^[{}[\]]*$/.test(lastLine)) {
    const match = trimmed.match(/([\s\S]*\n)?([^\n]+)$/);
    if (match && match[2] && !/^[A-Za-z_$][\w$]*\s*=/.test(match[2])) {
      trailingExpression = match[2].trim();
      body = (match[1] ?? "").replace(/\n$/, "");
      lines.splice(lines.length - 1, 1);
    }
  }

  const logLines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  console.log = (...args: unknown[]) => { logLines.push(args.map((item) => stringifyValue(item)).join(" ")); };
  console.error = (...args: unknown[]) => { logLines.push(`[error] ${args.map((item) => stringifyValue(item)).join(" ")}`); };
  console.warn = (...args: unknown[]) => { logLines.push(`[warn] ${args.map((item) => stringifyValue(item)).join(" ")}`); };
  console.info = (...args: unknown[]) => { logLines.push(`[info] ${args.map((item) => stringifyValue(item)).join(" ")}`); };

  const capturePlot = namespace.__plt as PlotCollector | undefined;
  let value: unknown = null;
  let error: Error | null = null;
  try {
    const parameterNames = Object.keys(namespace);
    const parameterValues = Object.values(namespace);
    const prefix = body.trim() ? `${body}\n` : "";
    const script = prefix + (trailingExpression ? `return (${trailingExpression});` : "return null;");
    // eslint-disable-next-line no-new-func
    const fn = new Function(...parameterNames, script) as (...args: unknown[]) => unknown;
    value = fn(...parameterValues);
  } catch (exception) {
    error = exception instanceof Error ? exception : new Error(String(exception));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
  }

  if (error) throw error;

  // 图表：plt 收集的配置
  capturePlot?.commit();
  const charts = capturePlot?.charts ?? [];
  const plot = charts.length ? charts[charts.length - 1] : null;

  let table: Table | null = null;
  if (value instanceof Table) {
    table = value;
  } else if (Array.isArray(value) && value.length && value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    table = Table.fromRecords(value as Array<Record<string, unknown>>);
  }
  const text = [logLines.join("\n"), value !== null && value !== undefined && !(value instanceof Table) ? stringifyValue(value) : ""].filter(Boolean).join("\n").trim();
  const output = table ?? value ?? (text || null);
  return { outputs: { next: output, output }, table, plot, text };
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (value instanceof Table) return value.toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length <= 12 && value.every((item) => typeof item !== "object")) return `[${value.join(", ")}]`;
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ---- notebook 导入分析（.ipynb → 节点）----

export function analyzeNotebookJson(notebookJson: string): { cells: NotebookCellAnalysis[] } {
  const notebook = JSON.parse(notebookJson) as { cells?: Array<{ cell_type?: string; source?: string | string[] }> };
  const cells = notebook.cells ?? [];
  return {
    cells: cells.map((cell, index) => {
      const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? "");
      if (cell.cell_type === "code") {
        return {
          index,
          recognized: true,
          semantic: true,
          kind: "compound",
          nodeType: "notebook.code_cell",
          label: "JS 代码单元格",
          parameters: { source },
          defines: [],
          uses: [],
        };
      }
      return { index, recognized: false, reason: "markdown", defines: [], uses: [] };
    }),
  };
}

// ---- custom 函数（原 custom.python_function 改为执行 JS 函数）----

export type CustomFunctionSpec = {
  name: string;
  parameters: Array<{ name: string; kind: string; optional?: boolean; defaultValue?: string | null }>;
  returnKind: string;
  returnPorts?: Array<{ port: string; kind: string }>;
};

const KIND_ALIASES: Record<string, string> = {
  table: "table", dataframe: "table", "pd.dataframe": "table", number: "number", int: "number",
  float: "number", str: "text", string: "text", text: "text", bool: "boolean", boolean: "boolean",
  plot: "plot", csv: "csv", any: "any", list: "list", object: "any",
};

function parseKind(text: string): string {
  const normalized = text.trim().replace(/\s+/g, "").toLowerCase();
  const alias = KIND_ALIASES[normalized];
  if (alias) return alias;
  if (normalized.startsWith("list<") || normalized.startsWith("array<")) {
    const inner = normalized.match(/^list<(.+)>$/)?.[1] ?? normalized.match(/^array<(.+)>$/)?.[1] ?? "";
    return `list:${parseKind(inner)}`;
  }
  if (normalized.startsWith("tuple<")) {
    const inner = normalized.slice(6, -1);
    return `tuple:${inner}`;
  }
  return "";
}

export function parseCustomFunction(code: string): CustomFunctionSpec {
  const source = String(code ?? "");
  // 支持 function name(a: table, b: number): table { ... } 与箭头函数（返回类型可含 < > 泛型）
  const functionMatch = source.match(/(?:function\s+)?([A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?)?\(([^)]*)\)\s*(?::\s*([^{}]+?))?\s*(?:=>|\{)/);
  const arrowMatch = source.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*(?::\s*([^{}]+?))?\s*(?:=>|\{)/);
  const match = functionMatch ?? arrowMatch;
  if (!match) throw new Error("Custom node code must contain exactly one synchronous function");
  const name = match[1];
  const parameterText = match[2] ?? "";
  const returnText = (match[3] ?? "").trim();
  const parameters = parameterText.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    // 分离默认值（`name: kind = default`）后解析注解
    let declaration = item;
    let defaultValue: string | null = null;
    const defaultIndex = item.indexOf("=");
    if (defaultIndex >= 0) {
      declaration = item.slice(0, defaultIndex).trim();
      const rawDefault = item.slice(defaultIndex + 1).trim();
      defaultValue = rawDefault === "" ? null : rawDefault;
    }
    const parts = declaration.split(":");
    const paramName = parts[0]?.trim() ?? "";
    const annotation = parts.slice(1).join(":").trim();
    const optional = paramName.endsWith("?") || defaultValue !== null;
    const kind = parseKind(annotation);
    if (!kind) throw new Error(`Parameter ${paramName} has no supported type annotation`);
    return { name: paramName.replace(/\?$/, ""), kind, optional, defaultValue };
  });
  const returnKind = parseKind(returnText);
  if (!returnKind) throw new Error("Custom function return value has no supported type annotation");
  if (returnKind.startsWith("tuple:")) {
    const inner = returnKind.slice(6);
    const outputs = inner.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [port, kindText] = part.split(":").map((item) => item.trim());
      const kind = parseKind(kindText);
      if (!kind || !port) throw new Error("Tuple output ports need `name: kind` annotations");
      return { port, kind };
    });
    return { name, parameters, returnKind: "tuple", returnPorts: outputs };
  }
  return { name, parameters, returnKind };
}

export function validateCustomOutput(value: unknown, kind: string, port: string): void {
  if (kind === "table" && !(value instanceof Table)) throw new Error(`Output ${port} declared table but did not return a Table`);
  if (kind === "number" && (typeof value !== "number" || Number.isNaN(value))) throw new Error(`Output ${port} declared number but returned ${typeof value}`);
  if ((kind === "text" || kind === "csv") && typeof value !== "string") throw new Error(`Output ${port} declared ${kind} but returned ${typeof value}`);
  if (kind === "boolean" && typeof value !== "boolean") throw new Error(`Output ${port} declared boolean but returned ${typeof value}`);
}

function stripTypeAnnotations(code: string): string {
  // 移除 TS 风格类型注解（参数与返回值），使函数体成为合法 JS。
  // 先保护 list/tuple 泛型（其中可能含 `name: kind`），再剥离简单注解，最后还原泛型。
  const placeholders: string[] = [];
  const protectedCode = code.replace(/(?:list|tuple)\s*(?:<[^<>]*>|\[[^\[\]]*\])/g, (match) => {
    placeholders.push(match);
    return `__ANNOTATION_${placeholders.length - 1}__`;
  });
  const simpleKind = "table|number|text|string|boolean|any|csv|plot";
  const stripped = protectedCode
    .replace(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*:\\s*(${simpleKind})\\b`, "g"), "$1")
    .replace(/\b([A-Za-z_$][\w$]*)\s*:\s*__ANNOTATION_(\d+)__/g, "$1")
    .replace(new RegExp(`\\)\\s*:\\s*(${simpleKind})\\s*(\\{|=>)`), ") $2")
    .replace(/\)\s*:\s*__ANNOTATION_(\d+)__\s*(\{|=>)/, ") $2");
  return stripped.replace(/__ANNOTATION_(\d+)__/g, (_match, index: string) => placeholders[Number(index)]);
}

function convertCustomParameterValue(kind: string, raw: unknown): unknown {
  if (kind === "number") {
    const number = Number(raw);
    if (Number.isNaN(number)) throw new Error(`Invalid number parameter: ${String(raw)}`);
    return number;
  }
  if (kind === "boolean") return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
  if (kind.startsWith("list:")) {
    const itemKind = kind.slice(5);
    let items: unknown[];
    if (Array.isArray(raw)) {
      items = raw;
    } else {
      const text = String(raw).trim();
      if (text.startsWith("[")) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error("List parameter must be a JSON array");
        items = parsed;
      } else {
        items = text.split(",").map((item) => item.trim()).filter(Boolean);
      }
    }
    return items.map((item) => {
      if (itemKind === "number") return Number(item);
      if (itemKind === "boolean") return ["1", "true", "yes", "on"].includes(String(item).trim().toLowerCase());
      return String(item);
    });
  }
  return String(raw);
}

export function executeCustomFunction(code: string, upstream: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown> {
  const spec = parseCustomFunction(code);
  const executableCode = stripTypeAnnotations(code);
  const fn = new Function("Table", "pd", "math", `${executableCode}\nreturn ${spec.name};`) as (Table: unknown, pd: unknown, math: unknown) => (...args: unknown[]) => unknown;
  const callable = fn(Table, { DataFrame: (data: unknown) => tableFromValue(data, "pd.DataFrame") }, Math);
  const argumentsList: unknown[] = [];
  for (const parameter of spec.parameters) {
    if (["table", "plot", "csv", "any"].includes(parameter.kind)) {
      if (parameter.name in upstream) {
        argumentsList.push(upstream[parameter.name]);
      } else if (parameter.optional) {
        argumentsList.push(null);
      } else {
        throw new Error(`Required input ${parameter.name} is not connected`);
      }
      continue;
    }
    if (!(parameter.name in params) || params[parameter.name] === null || params[parameter.name] === "") {
      if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) {
        argumentsList.push(convertCustomParameterValue(parameter.kind, parameter.defaultValue));
        continue;
      }
      if (parameter.optional) {
        argumentsList.push(null);
      } else {
        throw new Error(`Required parameter ${parameter.name} has no value`);
      }
      continue;
    }
    const raw = params[parameter.name];
    argumentsList.push(convertCustomParameterValue(parameter.kind, raw));
  }
  const value = callable(...argumentsList);
  if (spec.returnKind === "tuple" && spec.returnPorts) {
    if (!Array.isArray(value) || value.length !== spec.returnPorts.length) {
      throw new Error(`Custom function must return a tuple with ${spec.returnPorts.length} values`);
    }
    const outputs: Record<string, unknown> = {};
    spec.returnPorts.forEach((descriptor, index) => {
      validateCustomOutput(value[index], descriptor.kind, descriptor.port);
      outputs[descriptor.port] = value[index];
    });
    return outputs;
  }
  validateCustomOutput(value, spec.returnKind, "output");
  return { output: value };
}
