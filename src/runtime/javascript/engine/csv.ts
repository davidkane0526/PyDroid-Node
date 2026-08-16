// CSV 解析与序列化：对齐原引擎 _read_csv 的 pandas 参数子集。
import { Table, type CellValue } from "./table";

export type CsvReadOptions = {
  separator?: string;
  header?: "none" | "infer" | 0 | 1;
  names?: string[];
  indexColumn?: string | number | null;
  useColumns?: Array<string | number>;
  skipRows?: number | number[];
  skipFooter?: number;
  nRows?: number;
  encoding?: string;
  dtype?: Record<string, string> | string | null;
  skipInitialSpace?: boolean;
  naValues?: string[];
  keepDefaultNa?: boolean;
  naFilter?: boolean;
  trueValues?: string[];
  falseValues?: string[];
  skipBlankLines?: boolean;
  parseDates?: Array<string | number>;
  dateFormat?: string;
  dayFirst?: boolean;
  thousands?: string;
  decimal?: string;
  quoteChar?: string;
  doubleQuote?: boolean;
  escapeChar?: string;
  comment?: string;
  lineTerminator?: string;
  onBadLines?: "error" | "warn" | "skip";
  lowMemory?: boolean;
};

const DEFAULT_NA_VALUES = ["", "NA", "N/A", "NaN", "nan", "null", "NULL", "None", "<NA>", "#N/A", "N/A"];

type CsvToken = {
  text: string;
  quoted: boolean;
};

/** 按 pandas 规则解析一行 CSV，返回单元格文本（保留空串）与是否整个为空行。 */
function parseCsvLine(line: string, separator: string, quoteChar: string, doubleQuote: boolean, escapeChar: string | null, skipInitialSpace: boolean, onBadLines: "error" | "warn" | "skip"): CsvToken[] | null {
  const cells: CsvToken[] = [];
  let current = "";
  let quoted = false;
  let inQuotes = false;
  let afterQuote = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (inQuotes) {
      if (character === quoteChar) {
        if (doubleQuote && line[i + 1] === quoteChar) {
          current += quoteChar;
          i += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (escapeChar !== null && character === escapeChar) {
        escaped = true;
      } else {
        current += character;
      }
      continue;
    }
    if (afterQuote) {
      if (character === separator) {
        cells.push({ text: current, quoted });
        current = "";
        quoted = false;
        afterQuote = false;
        continue;
      }
      if (character === quoteChar && current === "") {
        inQuotes = true;
        continue;
      }
      if (character === " " || character === "\t") {
        // 引号后的空白：保留（pandas 在 quoted 单元格后允许）
        continue;
      }
      // 引号后出现其它字符：非标准但容忍
      current += character;
      afterQuote = false;
      continue;
    }
    if (character === quoteChar && current === "" && !quoted) {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (character === separator) {
      cells.push({ text: current.trim(), quoted });
      current = "";
      quoted = false;
      continue;
    }
    if ((character === " " || character === "\t") && skipInitialSpace && current === "") {
      continue;
    }
    current += character;
  }
  cells.push({ text: current.trim(), quoted });
  // 未闭合引号
  if (inQuotes) {
    if (onBadLines === "error") throw new Error(`CSV quoting error: unterminated quote in line: ${line.slice(0, 80)}`);
    if (onBadLines === "skip") return null;
  }
  return cells;
}

function coerceCell(text: string, options: CsvReadOptions): CellValue {
  const { naValues, keepDefaultNa, naFilter, trueValues, falseValues, thousands, decimal } = options;
  const raw = text;
  const naSet = new Set(keepDefaultNa === false ? (naValues ?? []) : [...DEFAULT_NA_VALUES, ...(naValues ?? [])]);
  if (naFilter === false) {
    // 不检测缺失值：保持原始文本
  } else if (naSet.has(raw)) {
    return null;
  }
  if (trueValues && trueValues.includes(raw)) return true;
  if (falseValues && falseValues.includes(raw)) return false;
  let candidate = raw;
  if (thousands && candidate.includes(thousands)) candidate = candidate.split(thousands).join("");
  const point = (decimal !== "." ? decimal : ".") || ".";
  if (point !== ".") candidate = candidate.split(point).join(".");
  if (candidate === "") return raw;
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(candidate)) {
    const number = Number(candidate);
    if (!Number.isNaN(number)) return number;
  }
  return raw;
}

export function parseCsv(text: string, options: CsvReadOptions = {}): Table {
  const separator = (options.separator ?? ",") === "\\t" ? "\t" : options.separator ?? ",";
  if (!separator) throw new Error("CSV separator cannot be empty");
  const quoteChar = options.quoteChar ?? '"';
  const doubleQuote = options.doubleQuote !== false;
  const escapeChar = options.escapeChar || null;
  const skipInitialSpace = Boolean(options.skipInitialSpace);
  const skipBlankLines = options.skipBlankLines !== false;
  const onBadLines = options.onBadLines ?? "error";
  const comment = options.comment || null;
  const dayFirst = Boolean(options.dayFirst);
  void dayFirst;

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let lines = normalized.split("\n");
  // 去掉末尾空行
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const skipRows = options.skipRows ?? 0;
  const skipSet = new Set(Array.isArray(skipRows) ? skipRows : []);
  const skipCount = Array.isArray(skipRows) ? 0 : skipRows;
  const skipFooter = options.skipFooter ?? 0;

  const keptLines: string[] = [];
  let lineNumber = 0;
  for (const line of lines) {
    if (skipSet.has(lineNumber) || lineNumber < skipCount) {
      lineNumber += 1;
      continue;
    }
    if (comment !== null && line.startsWith(comment)) {
      lineNumber += 1;
      continue;
    }
    if (skipBlankLines && line.trim() === "") {
      lineNumber += 1;
      continue;
    }
    keptLines.push(line);
    lineNumber += 1;
  }
  if (skipFooter > 0) keptLines.splice(keptLines.length - skipFooter, skipFooter);
  if (!keptLines.length) throw new Error("No data to parse: CSV is empty");
  if (options.nRows !== undefined && options.nRows > 0) keptLines.splice(options.nRows);

  const parsed = keptLines.map((line) => parseCsvLine(line, separator, quoteChar, doubleQuote, escapeChar, skipInitialSpace, onBadLines));
  const valid = parsed.filter((line): line is CsvToken[] => line !== null);
  if (!valid.length) throw new Error("No data rows could be parsed from CSV");

  let header: "none" | "infer" | 0 | 1 = options.header ?? "none";
  if (header === "infer") header = 0;
  let body = valid;
  let names: string[] = options.names ?? [];
  if (header !== "none") {
    const headerRow = valid[header];
    names = headerRow.map((token) => token.text);
    body = valid.slice(header + 1);
  }
  if (!names.length) {
    const width = Math.max(...valid.map((row) => row.length));
    names = Array.from({ length: width }, (_, i) => String(i));
  }
  const width = names.length;

  let columnIndexes = names.map((_, i) => i);
  if (options.useColumns && options.useColumns.length) {
    columnIndexes = options.useColumns.map((item) => {
      if (typeof item === "number") {
        if (item < 0 || item >= width) throw new Error(`Column indexes out of range: ${item}`);
        return item;
      }
      const index = names.indexOf(String(item));
      if (index < 0) throw new Error(`Unknown column: ${item}`);
      return index;
    });
  }

  const rows: CellValue[][] = body.map((row) => {
    const padded = Array.from({ length: width }, (_, c) => row[c]?.text ?? "");
    return columnIndexes.map((c) => coerceCell(padded[c], options));
  });

  // 列类型（dtype）：字符串列保持字符串；数值列保留推断
  const columnNames = columnIndexes.map((c) => names[c]);

  // 日期列：isoformat 输出
  const parseDateSet = new Set((options.parseDates ?? []).map((item) => String(item)));
  const dateIndexes = new Set<number>();
  columnIndexes.forEach((c, index) => {
    if (parseDateSet.has(String(c)) || parseDateSet.has(names[c])) dateIndexes.add(index);
  });
  for (const row of rows) {
    for (const index of dateIndexes) {
      const value = row[index];
      if (typeof value === "number" && Number.isFinite(value)) {
        row[index] = new Date(value * (value > 1e11 ? 1 : 1000)).toISOString();
      }
    }
  }

  let table = new Table(columnNames, rows);

  // 索引列
  const indexColumn = options.indexColumn;
  if (indexColumn !== null && indexColumn !== undefined && indexColumn !== "") {
    const indexIndex = typeof indexColumn === "number" ? indexColumn : columnNames.indexOf(String(indexColumn));
    if (indexIndex < 0) throw new Error(`Unknown index column: ${indexColumn}`);
    const indexValues = table.column(indexIndex);
    const remainingColumns = columnNames.filter((_, i) => i !== indexIndex);
    const remainingRows = table.rows().map((row) => row.filter((_, i) => i !== indexIndex));
    table = new Table(["index", ...remainingColumns], remainingRows.map((row, r) => [indexValues[r] ?? r, ...row]));
  }

  // 列名规范化（与 pandas 相同：去空白）
  return new Table(table.columns.map((column) => String(column).trim()), table.rows());
}

export function toCsv(table: Table, index = false, lineTerminator = "\n"): string {
  const rows = table.rows();
  const header = index ? ["", ...table.columns] : [...table.columns];
  const lines = [
    header.map((cell) => escapeCsvCell(String(cell))).join(","),
    ...rows.map((row) => {
      const cells = index ? [String("")] : [];
      cells.push(...row.map((cell) => escapeCsvCell(cell === null ? "" : String(cell))));
      return cells.join(",");
    }),
  ];
  return lines.join(lineTerminator);
}

function escapeCsvCell(text: string): string {
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
