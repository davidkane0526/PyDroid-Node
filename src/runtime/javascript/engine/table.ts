import { portableSampleIndexes } from "./random";
// JS 版表格核心：列优先存储的 DataFrame 等价物。
// 语义对齐原 Python 引擎中 pandas 的常用操作（engine.py）。

export type CellValue = string | number | boolean | null;

const MISSING = null;

export function isMissing(value: unknown): value is null | undefined {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).trim();
  if (text === "" || text.toLowerCase() === "nan" || text.toLowerCase() === "na" || text.toLowerCase() === "null" || text.toLowerCase() === "none") return null;
  const parsed = Number(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareValues(a: unknown, b: unknown): number {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an - bn;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
}

function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pythonSliceIndexes(length: number, start: number | null, stop: number | null, step: number): number[] {
  if (!Number.isInteger(step) || step === 0) throw new Error("Slice step cannot be zero");
  const lower = step < 0 ? -1 : 0;
  const upper = step < 0 ? length - 1 : length;
  const normalize = (value: number | null, isStart: boolean): number => {
    if (value === null) return isStart ? (step < 0 ? upper : lower) : (step < 0 ? lower : upper);
    let index = Math.trunc(value);
    if (index < 0) index += length;
    if (index < lower) return lower;
    if (index > upper) return upper;
    return index;
  };
  const first = normalize(start, true);
  const last = normalize(stop, false);
  const result: number[] = [];
  if (step > 0) for (let index = first; index < last; index += step) result.push(index);
  else for (let index = first; index > last; index += step) result.push(index);
  return result;
}

function roundHalfEven(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  let rounded: number;
  if (Math.abs(fraction - 0.5) <= epsilon) rounded = floor % 2 === 0 ? floor : floor + 1;
  else rounded = Math.round(scaled);
  return rounded / factor;
}

function arithmeticDifference(a: CellValue, b: CellValue): CellValue {
  if (isMissing(a) || isMissing(b)) return MISSING;
  if (typeof a === "boolean" && typeof b === "boolean") return a !== b;
  if (typeof a === "number" && typeof b === "number") return a - b;
  throw new Error(`Difference is not defined for ${typeof a} and ${typeof b}`);
}

export class Table {
  readonly columns: string[];
  // data[columnIndex][rowIndex]
  private readonly data: CellValue[][];

  constructor(columns: string[], rows: unknown[][]) {
    if (!columns.length) throw new Error("Table requires at least one column");
    const unique = new Set(columns);
    if (unique.size !== columns.length) throw new Error("Table column names must be unique");
    const width = columns.length;
    this.columns = [...columns];
    this.data = columns.map(() => []);
    for (const row of rows) {
      const normalized = Array.isArray(row) ? row : [];
      for (let c = 0; c < width; c += 1) {
        const value = normalized[c];
        this.data[c].push(value === undefined ? MISSING : normalizeCell(value));
      }
    }
  }

  get rowCount(): number {
    return this.data[0]?.length ?? 0;
  }

  get columnCount(): number {
    return this.columns.length;
  }

  static fromRecords(records: Array<Record<string, unknown>>): Table {
    const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
    return new Table(columns, records.map((record) => columns.map((column) => record[column] ?? MISSING)));
  }

  static fromObject(object: Record<string, unknown>): Table {
    // {a: [1,2], b: [3,4]} 或 {a: 1, b: 2}
    const entries = Object.entries(object);
    const widths = entries.map(([, value]) => (Array.isArray(value) ? value.length : 1));
    const width = Math.max(1, ...widths);
    return new Table(
      entries.map(([name]) => name),
      Array.from({ length: width }, (_, row) => entries.map(([, value]) => (Array.isArray(value) ? value[row] : value))),
    );
  }

  columnIndex(name: string | number): number {
    if (typeof name === "number") {
      const index = Math.trunc(name);
      if (index < 0 || index >= this.columns.length) throw new Error(`Column index out of range: ${index}`);
      return index;
    }
    const index = this.columns.indexOf(String(name));
    if (index < 0) throw new Error(`Unknown column: ${name}`);
    return index;
  }

  column(name: string | number): CellValue[] {
    return [...this.data[this.columnIndex(name)]];
  }

  row(index: number): CellValue[] {
    if (index < 0 || index >= this.rowCount) throw new Error(`Row index out of range: ${index}`);
    return this.data.map((column) => column[index]);
  }

  rows(): CellValue[][] {
    return Array.from({ length: this.rowCount }, (_, r) => this.row(r));
  }

  records(): Array<Record<string, CellValue>> {
    return this.rows().map((row) => Object.fromEntries(this.columns.map((column, c) => [column, row[c]])));
  }

  setColumn(name: string, values: unknown[]): Table {
    if (values.length !== this.rowCount) throw new Error(`Column ${name} must have ${this.rowCount} values`);
    const table = this.copy();
    if (table.columns.includes(name)) {
      table.data[table.columnIndex(name)] = values.map(normalizeCell);
    } else {
      table.columns.push(name);
      table.data.push(values.map(normalizeCell));
    }
    return table;
  }

  copy(): Table {
    return new Table(this.columns, this.rows());
  }

  head(n = 5): Table {
    const count = Math.trunc(n);
    return count >= 0 ? this.takeRows(pythonSliceIndexes(this.rowCount, 0, count, 1)) : this.takeRows(pythonSliceIndexes(this.rowCount, 0, count, 1));
  }

  tail(n = 5): Table {
    const count = Math.trunc(n);
    if (count === 0) return this.takeRows([]);
    if (count > 0) return this.takeRows(pythonSliceIndexes(this.rowCount, -count, null, 1));
    return this.takeRows(pythonSliceIndexes(this.rowCount, -count, null, 1));
  }

  sliceRows(start: number | null, stop: number | null, step = 1): Table {
    return this.takeRows(pythonSliceIndexes(this.rowCount, start, stop, step));
  }

  takeRows(indexes: number[]): Table {
    return new Table(this.columns, indexes.map((index) => this.row(index)));
  }

  selectColumns(indexes: number[]): Table {
    for (const index of indexes) {
      if (index < 0 || index >= this.columns.length) throw new Error(`Column indexes out of range: ${index}`);
    }
    const selected = indexes.map((index) => this.columns[index]);
    return new Table(selected, this.rows().map((row) => indexes.map((index) => row[index])));
  }

  renameColumns(names: string[]): Table {
    if (names.length !== this.columns.length || names.some((name) => !name)) {
      throw new Error(`Expected ${this.columns.length} non-empty column names, received ${names.length}`);
    }
    const table = new Table(names, this.rows());
    return table;
  }

  resetIndex(drop = true): Table {
    if (drop) return this.copy();
    const indexColumn = `index${this.columns.some((column) => column === "index") ? "_" : ""}`;
    return new Table([indexColumn, ...this.columns], this.rows().map((row, r) => [r, ...row]));
  }

  transpose(): Table {
    return new Table(
      Array.from({ length: this.rowCount }, (_, r) => String(r)),
      Array.from({ length: this.columns.length }, (_, c) => this.data[c]),
    );
  }

  abs(): Table {
    return new Table(
      this.columns,
      this.rows().map((row) => row.map((value) => {
        if (isMissing(value)) return MISSING;
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return Math.abs(value);
        throw new Error("Absolute value is only defined for numeric/boolean table values");
      })),
    );
  }

  diff(periods = 1, axis = 0): Table {
    const offset = Math.trunc(periods);
    if (axis === 0) {
      return new Table(
        this.columns,
        this.rows().map((row, r) => row.map((value, c) => {
          const prior = r - offset;
          return prior < 0 || prior >= this.rowCount ? MISSING : arithmeticDifference(value, this.data[c][prior]);
        })),
      );
    }
    if (axis !== 1) throw new Error("Difference axis must be 0 or 1");
    return new Table(
      this.columns,
      this.rows().map((row) => row.map((value, c) => {
        const prior = c - offset;
        return prior < 0 || prior >= row.length ? MISSING : arithmeticDifference(value, row[prior]);
      })),
    );
  }

  sortIndex(ascending = true, axis = 0): Table {
    if (axis === 1) {
      const order = this.columns.map((_, index) => index).sort((left, right) => {
        const diff = compareValues(this.columns[left], this.columns[right]);
        return ascending ? diff : -diff;
      });
      return new Table(order.map((index) => this.columns[index]), this.rows().map((row) => order.map((index) => row[index])));
    }
    if (axis !== 0) throw new Error("Sort index axis must be 0 or 1");
    return this.copy(); // JS Table has a RangeIndex only, already sorted.
  }

  sortValues(by: Array<string | number>, ascending = true, naPosition: "first" | "last" = "last"): Table {
    if (!by.length) throw new Error("Sort values requires at least one column");
    const columnIndexes = by.map((name) => this.columnIndex(name));
    const rows = this.rows().map((row, r) => ({ row, r }));
    rows.sort((left, right) => {
      for (const c of columnIndexes) {
        const a = left.row[c];
        const b = right.row[c];
        const aMissing = isMissing(a);
        const bMissing = isMissing(b);
        if (aMissing || bMissing) {
          if (aMissing && bMissing) continue;
          const missingFirst = naPosition === "first";
          return aMissing === missingFirst ? -1 : 1;
        }
        const diff = compareValues(a, b);
        if (diff !== 0) return ascending ? diff : -diff;
      }
      return 0;
    });
    return this.takeRows(rows.map((item) => item.r));
  }

  dropna(how: "any" | "all" = "any", subset: Array<string | number> = []): Table {
    const indexes = subset.length ? subset.map((name) => this.columnIndex(name)) : this.columns.map((_, c) => c);
    const keep = this.rows().map((row) => {
      const missing = indexes.filter((c) => isMissing(row[c])).length;
      return how === "any" ? missing === 0 : missing < indexes.length;
    });
    return this.takeRows(keep.map((value, r) => (value ? r : -1)).filter((r) => r >= 0));
  }

  fillna(method: "forward" | "backward" | "value", value: unknown = 0): Table {
    if (method === "forward") {
      return new Table(this.columns, this.rows().map((row, r) => row.map((cell, c) => {
        if (!isMissing(cell)) return cell;
        for (let i = r - 1; i >= 0; i -= 1) {
          const previous = this.data[c][i];
          if (!isMissing(previous)) return previous;
        }
        return MISSING;
      })));
    }
    if (method === "backward") {
      return new Table(this.columns, this.rows().map((row, r) => row.map((cell, c) => {
        if (!isMissing(cell)) return cell;
        for (let i = r + 1; i < this.rowCount; i += 1) {
          const next = this.data[c][i];
          if (!isMissing(next)) return next;
        }
        return MISSING;
      })));
    }
    return new Table(this.columns, this.rows().map((row) => row.map((cell) => (isMissing(cell) ? normalizeCell(value) : cell))));
  }

  dropDuplicates(subset: Array<string | number> = [], keep: "first" | "last" | false = "first"): Table {
    const columnIndexes = subset.length ? subset.map((name) => this.columnIndex(name)) : this.columns.map((_, c) => c);
    const seen = new Map<string, number[]>();
    this.rows().forEach((row, r) => {
      const key = JSON.stringify(columnIndexes.map((c) => (isMissing(row[c]) ? "__MISSING__" : row[c])));
      const list = seen.get(key) ?? [];
      list.push(r);
      seen.set(key, list);
    });
    const kept: number[] = [];
    for (const list of seen.values()) {
      if (keep === "first") kept.push(list[0]);
      else if (keep === "last") kept.push(list[list.length - 1]);
      else kept.push(...list);
    }
    kept.sort((a, b) => a - b);
    return this.takeRows(kept);
  }

  sample(n = 5, replace = false, randomState = 0): Table {
    return this.takeRows(portableSampleIndexes(this.rowCount, n, replace, randomState));
  }

  round(decimals = 2): Table {
    return new Table(this.columns, this.rows().map((row) => row.map((value) => {
      if (isMissing(value)) return MISSING;
      if (typeof value === "boolean") return value;
      if (typeof value !== "number") return value;
      return roundHalfEven(value, Math.trunc(decimals));
    })));
  }

  numericColumns(): number[] {
    return this.columns.map((_, c) => c).filter((c) => this.data[c].some((value) => !isMissing(value)) && this.data[c].every((value) => isMissing(value) || typeof toNumber(value) === "number" && toNumber(value) !== null));
  }

  describe(percentiles: number[] = [], include: string[] | "all" | null = null, exclude: string[] | null = null): Table {
    let columns = this.columns.map((_, c) => c);
    if (exclude && exclude.length) {
      const excludeSet = new Set(exclude.map((name) => this.columns[this.columnIndex(name)]));
      columns = columns.filter((c) => !excludeSet.has(this.columns[c]));
    }
    if (include && include !== "all") {
      const includeSet = new Set(include.map((name) => this.columns[this.columnIndex(name)]));
      columns = columns.filter((c) => includeSet.has(this.columns[c]));
    }
    const wanted = percentiles.length ? percentiles : [0.25, 0.5, 0.75];
    const statRows: string[] = ["count", "mean", "std", "min", ...wanted.map((p) => `${Math.round(p * 100)}%`), "max"];
    const rows = statRows.map((statistic) => {
      const row: CellValue[] = [statistic];
      for (const c of columns) {
        const values = this.data[c].map(toNumber).filter((value): value is number => value !== null);
        if (statistic === "count") row.push(values.length);
        else if (statistic === "mean") row.push(values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN);
        else if (statistic === "std") {
          if (values.length < 2) row.push(Number.NaN);
          else {
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
            row.push(Math.sqrt(variance));
          }
        }
        else if (statistic === "min") row.push(values.length ? Math.min(...values) : Number.NaN);
        else if (statistic === "max") row.push(values.length ? Math.max(...values) : Number.NaN);
        else {
          const p = Number(statistic.slice(0, -1)) / 100;
          const sorted = [...values].sort((a, b) => a - b);
          const position = (sorted.length - 1) * p;
          const base = Math.floor(position);
          const rest = position - base;
          row.push(sorted.length ? sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base] : Number.NaN);
        }
      }
      return row;
    });
    return new Table(["statistic", ...columns.map((c) => this.columns[c])], rows);
  }

  filterRange(columnIndex: number, min: number | null, max: number | null): Table {
    if (columnIndex < 0 || columnIndex >= this.columns.length) throw new Error(`Filter column index out of range: ${columnIndex}`);
    const keep = this.rows().map((row) => {
      const value = toNumber(row[columnIndex]);
      if (value === null) return false;
      if (min !== null && value < min) return false;
      if (max !== null && value > max) return false;
      return true;
    });
    return this.takeRows(keep.map((value, r) => (value ? r : -1)).filter((r) => r >= 0));
  }

  query(expression: string): Table {
    if (!expression.trim()) throw new Error("Query expression is required");
    const evaluator = compileQuery(expression, this.columns);
    const keep = this.rows().map((row) => {
      const result = evaluator(row);
      if (typeof result !== "boolean") throw new Error("Query expression must produce a boolean");
      return result;
    });
    return this.takeRows(keep.map((value, r) => (value ? r : -1)).filter((r) => r >= 0));
  }

  groupAggregate(groupSize: number, start: number, end: number, method: "mean" | "median" | "min" | "max" | "sum"): Table {
    if (groupSize <= 0) throw new Error("groupSize must be greater than zero");
    if (start < 0 || end <= start || end > groupSize) throw new Error("The aggregation window must satisfy 0 <= startRow < endRow <= groupSize");
    const rows: CellValue[][] = [];
    for (let base = 0; base < this.rowCount; base += groupSize) {
      const windowRows = this.rows().slice(base + start, base + end);
      if (!windowRows.length) continue;
      const row = this.columns.map((_, c) => {
        const values = windowRows.map((r) => toNumber(r[c])).filter((value): value is number => value !== null);
        if (!values.length) return MISSING;
        if (method === "mean") return values.reduce((a, b) => a + b, 0) / values.length;
        if (method === "median") return median(values);
        if (method === "min") return Math.min(...values);
        if (method === "max") return Math.max(...values);
        return values.reduce((a, b) => a + b, 0);
      });
      rows.push(row);
    }
    return new Table(this.columns, rows);
  }

  periodicTailMean(groupSize: number, tailRows: number): Table {
    if (groupSize < 1 || tailRows < 1) throw new Error("Periodic mean sizes must be positive");
    const numeric = this.numericColumns();
    const rows: CellValue[][] = [];
    for (let base = 0; base < this.rowCount; base += groupSize) {
      const chunk = this.rows().slice(base, Math.min(base + groupSize, this.rowCount));
      if (!chunk.length) continue;
      const tail = chunk.slice(Math.max(0, chunk.length - tailRows));
      rows.push(numeric.map((c) => {
        const values = tail.map((r) => toNumber(r[c])).filter((value): value is number => value !== null);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : MISSING;
      }));
    }
    return new Table(numeric.map((c) => this.columns[c]), rows);
  }

  pivot(index: string, columns: string, values: string, aggregate: "mean" | "first" | "max" | "min"): Table {
    const indexC = this.columnIndex(index);
    const columnsC = this.columnIndex(columns);
    const valuesC = this.columnIndex(values);
    const sourceRows = this.rows().filter((row) => !isMissing(row[indexC]) && !isMissing(row[columnsC]));
    const uniqueSorted = (columnIndex: number): CellValue[] => {
      const values: CellValue[] = [];
      for (const row of sourceRows) if (!values.some((item) => compareValues(item, row[columnIndex]) === 0)) values.push(row[columnIndex]);
      return values.sort(compareValues);
    };
    const rowKeys = uniqueSorted(indexC);
    const columnKeys = uniqueSorted(columnsC);
    const result = rowKeys.map((rowKey) => {
      const row: CellValue[] = [rowKey];
      for (const columnKey of columnKeys) {
        const matching = sourceRows.filter((item) => compareValues(item[indexC], rowKey) === 0 && compareValues(item[columnsC], columnKey) === 0);
        const present = matching.map((item) => item[valuesC]).filter((item) => !isMissing(item));
        let value: CellValue = MISSING;
        if (present.length) {
          if (aggregate === "first") value = present[0];
          else if (aggregate === "mean") {
            const numbers = present.filter((item): item is number => typeof item === "number");
            if (numbers.length !== present.length) throw new Error("Pivot mean requires numeric values");
            value = numbers.reduce((a, b) => a + b, 0) / numbers.length;
          } else {
            value = present.reduce((best, item) => {
              const order = compareValues(item, best);
              return aggregate === "max" ? (order > 0 ? item : best) : (order < 0 ? item : best);
            });
          }
        }
        row.push(value);
      }
      return row;
    });
    return new Table([index, ...columnKeys.map(String)], result);
  }

  concat(other: Table, axis: 0 | 1, ignoreIndex: boolean): Table {
    if (axis === 1) {
      const base = this.copy();
      for (const column of other.columns) {
        if (base.columns.includes(column)) throw new Error(`Column ${column} already exists in the left table`);
        base.setColumn(column, other.column(column));
      }
      return base;
    }
    const rows = [...this.rows(), ...other.rows()];
    if (ignoreIndex) return new Table(this.columns, rows);
    return new Table(this.columns, rows);
  }

  toCSV(index = false, lineTerminator = "\n"): string {
    const header = index ? [this.columns.join(",")] : [this.columns.join(",")];
    const rows = this.rows().map((row) => {
      const cells = [...row];
      if (index) cells.unshift(String(this.rowCount));
      return cells.map(escapeCsv).join(",");
    });
    return [...header, ...rows].join(lineTerminator);
  }

  preview(limit = 500): { columns: string[]; rows: Array<Array<string | number | boolean | null>>; totalRows: number; totalColumns: number } {
    const head = this.head(limit);
    return {
      columns: [...this.columns],
      rows: head.rows().map((row) => row.map((value) => {
        if (value === null || value === undefined) return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        if (typeof value === "object") return String(value);
        return value;
      })),
      totalRows: this.rowCount,
      totalColumns: this.columns.length,
    };
  }

  toString(limit = 20): string {
    return `Table · ${this.rowCount} 行 × ${this.columns.length} 列\n${this.head(limit).toCSV()}`;
  }
}

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return MISSING;
  if (typeof value === "number") return Number.isNaN(value) ? MISSING : value;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function escapeCsv(value: CellValue): string {
  const text = value === null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

// ---- pandas.query 表达式求值 ----

const QUERY_STRING_PATTERN = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g;
const QUERY_WORD_PATTERN = /[A-Za-z_$][\w$]*/g;

export function compileQuery(expression: string, columns: string[]): (row: CellValue[]) => boolean {
  // pandas 语法 → JS 语法：
  //  and/or/not → &&/||/!
  //  反引号列名 `col` → col 占位
  //  df['col'] / df.col / 裸列名 → 单元格引用
  const columnSet = new Set(columns);
  const placeholders = new Map<string, string>();
  let transformed = expression
    .replace(/\bnot\s+/gi, "! ")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||");

  // 反引号列名：`` `col` `` → __c0 占位
  transformed = transformed.replace(/`([^`]+)`/g, (_, name: string) => {
    const placeholder = `__c${placeholders.size}`;
    placeholders.set(placeholder, String(name));
    return placeholder;
  });
  // df['col'] / df["col"] / df.col → 单元格引用
  transformed = transformed.replace(/\b([A-Za-z_$][\w$]*)\s*\[\s*(['"])(.*?)\2\s*\]/g, (_, _df: string, __quote: string, name: string) => {
    const placeholder = `__c${placeholders.size}`;
    placeholders.set(placeholder, name);
    return placeholder;
  });
  transformed = transformed.replace(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/g, (match: string, df: string, name: string) => {
    if (df !== "df" && df !== "row" && !columnSet.has(df)) return match;
    if (columnSet.has(name)) {
      const placeholder = `__c${placeholders.size}`;
      placeholders.set(placeholder, name);
      return placeholder;
    }
    return match;
  });
  // 裸标识符列名（在列集合中，且不是 JS 关键字/字面量）
  transformed = transformed.replace(QUERY_WORD_PATTERN, (match: string) => {
    if (/^(true|false|null|undefined|NaN|Infinity|and|or|not|in|is)$/i.test(match)) return match;
    if (columnSet.has(match)) {
      const placeholder = `__c${placeholders.size}`;
      placeholders.set(placeholder, match);
      return placeholder;
    }
    return match;
  });
  // 未解析的占位符 → 引用 row
  for (const [placeholder, name] of placeholders) {
    const index = columns.indexOf(name);
    if (index < 0) throw new Error(`Unknown column: ${name}`);
    transformed = transformed.split(placeholder).join(`row[${index}]`);
  }
  let body: string;
  try {
    body = `return (${transformed});`;
    // eslint-disable-next-line no-new-func
    const compiled = new Function("row", body) as (row: CellValue[]) => unknown;
    return (row: CellValue[]) => Boolean(compiled(row));
  } catch (error) {
    throw new Error(`Query expression is invalid: ${String((error as Error).message)}`);
  }
}

export function tableFromValue(value: unknown, operation: string): Table {
  if (value instanceof Table) return value;
  if (Array.isArray(value)) {
    const records = value.every((item) => item && typeof item === "object" && !Array.isArray(item));
    return records ? Table.fromRecords(value as Array<Record<string, unknown>>) : new Table(Array.from({ length: value.length }, (_, i) => String(i)), [value]);
  }
  if (value && typeof value === "object") {
    return Table.fromObject(value as Record<string, unknown>);
  }
  throw new Error(`${operation} requires a table input`);
}
