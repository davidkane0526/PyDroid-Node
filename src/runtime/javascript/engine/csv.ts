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

const DEFAULT_NA_VALUES = ["", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan", "1.#IND", "1.#QNAN", "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null"];

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
      cells.push({ text: current, quoted });
      current = "";
      quoted = false;
      continue;
    }
    if ((character === " " || character === "\t") && skipInitialSpace && current === "") {
      continue;
    }
    current += character;
  }
  cells.push({ text: current, quoted });
  // 未闭合引号
  if (inQuotes) {
    if (onBadLines === "error") throw new Error(`CSV quoting error: unterminated quote in line: ${line.slice(0, 80)}`);
    if (onBadLines === "skip") return null;
  }
  return cells;
}

function naSet(options: CsvReadOptions): Set<string> {
  return new Set(options.keepDefaultNa === false ? (options.naValues ?? []) : [...DEFAULT_NA_VALUES, ...(options.naValues ?? [])]);
}

function isNaToken(raw: string, options: CsvReadOptions): boolean {
  return options.naFilter === false ? false : naSet(options).has(raw);
}

function numericToken(raw: string, options: CsvReadOptions): number | null {
  let candidate = raw;
  if (options.thousands && candidate.includes(options.thousands)) candidate = candidate.split(options.thousands).join("");
  const point = options.decimal ?? ".";
  if (point !== ".") candidate = candidate.split(point).join(".");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(candidate)) return null;
  const value = Number(candidate);
  return Number.isNaN(value) ? null : value;
}

function inferColumn(tokens: string[], options: CsvReadOptions): CellValue[] {
  const present = tokens.filter((raw) => !isNaToken(raw, options));
  const trueValues = options.trueValues?.length ? new Set(options.trueValues) : null;
  const falseValues = options.falseValues?.length ? new Set(options.falseValues) : null;
  const customBoolean = Boolean(trueValues || falseValues);
  const isBoolean = present.length > 0 && present.every((raw) => {
    if (customBoolean) return Boolean(trueValues?.has(raw) || falseValues?.has(raw));
    const lower = raw.toLowerCase();
    return lower === "true" || lower === "false";
  });
  if (isBoolean) {
    return tokens.map((raw) => {
      if (isNaToken(raw, options)) return null;
      if (customBoolean) return trueValues?.has(raw) ? true : false;
      return raw.toLowerCase() === "true";
    });
  }
  const isNumeric = present.length > 0 && present.every((raw) => numericToken(raw, options) !== null);
  if (isNumeric) return tokens.map((raw) => isNaToken(raw, options) ? null : numericToken(raw, options));
  return tokens.map((raw) => isNaToken(raw, options) ? null : raw);
}

function makeUniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    let name = raw;
    if (!used.has(name)) { used.add(name); return name; }
    let suffix = 1;
    while (used.has(`${raw}.${suffix}`)) suffix += 1;
    name = `${raw}.${suffix}`;
    used.add(name);
    return name;
  });
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

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let lines = normalized.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const skipRows = options.skipRows ?? 0;
  const skipSet = new Set(Array.isArray(skipRows) ? skipRows : []);
  const skipCount = Array.isArray(skipRows) ? 0 : Math.max(0, Math.trunc(skipRows));
  const keptLines: string[] = [];
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    if (skipSet.has(lineNumber) || lineNumber < skipCount) continue;
    if (comment !== null && line.startsWith(comment)) continue;
    if (skipBlankLines && line.trim() === "") continue;
    keptLines.push(line);
  }
  const skipFooter = Math.max(0, Math.trunc(options.skipFooter ?? 0));
  if (skipFooter > 0) keptLines.splice(Math.max(0, keptLines.length - skipFooter), skipFooter);
  if (!keptLines.length) throw new Error("No data to parse: CSV is empty");

  const parsed = keptLines
    .map((line) => parseCsvLine(line, separator, quoteChar, doubleQuote, escapeChar, skipInitialSpace, onBadLines))
    .filter((line): line is CsvToken[] => line !== null);
  if (!parsed.length) throw new Error("No data rows could be parsed from CSV");

  const explicitNames = options.names?.map(String) ?? [];
  if (new Set(explicitNames).size !== explicitNames.length) throw new Error("Duplicate names are not allowed");
  const requestedHeader = options.header ?? "none";
  const headerIndex: number | null = requestedHeader === "infer"
    ? (explicitNames.length ? null : 0)
    : requestedHeader === "none" ? null : Number(requestedHeader);
  if (headerIndex !== null && (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= parsed.length)) {
    throw new Error(`Header row out of range: ${headerIndex}`);
  }

  let names = explicitNames;
  let body = parsed;
  if (headerIndex !== null) {
    if (!names.length) names = makeUniqueNames(parsed[headerIndex].map((token) => token.text));
    body = parsed.slice(headerIndex + 1);
  }
  if (!names.length) {
    const width = Math.max(...parsed.map((row) => row.length));
    names = Array.from({ length: width }, (_, index) => String(index));
  }
  const width = names.length;
  if (options.nRows !== undefined && options.nRows >= 0) body = body.slice(0, Math.trunc(options.nRows));

  let columnIndexes = names.map((_, index) => index);
  if (options.useColumns?.length) {
    const requestedNames = new Set(options.useColumns.filter((item): item is string => typeof item === "string").map(String));
    const requestedIndexes = new Set(options.useColumns.filter((item): item is number => typeof item === "number").map((item) => Math.trunc(item)));
    for (const item of requestedNames) if (!names.includes(item)) throw new Error(`Unknown column: ${item}`);
    for (const item of requestedIndexes) if (item < 0 || item >= width) throw new Error(`Column indexes out of range: ${item}`);
    columnIndexes = names.map((name, index) => requestedNames.has(name) || requestedIndexes.has(index) ? index : -1).filter((index) => index >= 0);
  }

  const paddedRows = body.map((row) => Array.from({ length: width }, (_, column) => row[column]?.text ?? ""));
  const inferredColumns = Array.from({ length: width }, (_, column) => inferColumn(paddedRows.map((row) => row[column]), options));
  const rows: CellValue[][] = paddedRows.map((_, row) => columnIndexes.map((column) => inferredColumns[column][row]));
  const columnNames = columnIndexes.map((column) => names[column]);

  let table = new Table(columnNames, rows);
  const indexColumn = options.indexColumn;
  if (indexColumn !== null && indexColumn !== undefined && indexColumn !== "") {
    const indexIndex = typeof indexColumn === "number" ? Math.trunc(indexColumn) : columnNames.indexOf(String(indexColumn));
    if (indexIndex < 0 || indexIndex >= columnNames.length) throw new Error(`Unknown index column: ${indexColumn}`);
    const indexValues = table.column(indexIndex);
    const remainingColumns = columnNames.filter((_, index) => index !== indexIndex);
    const remainingRows = table.rows().map((row) => row.filter((_, index) => index !== indexIndex));
    table = new Table(["index", ...remainingColumns], remainingRows.map((row, index) => [indexValues[index] ?? index, ...row]));
  }
  return table;
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
