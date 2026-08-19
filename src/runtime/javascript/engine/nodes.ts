import { PortableRandom, portableSampleCount } from "./random";
// 节点实现：每个节点类型等价于原 engine.py _execute_node 的分支。
import { Table, tableFromValue, toNumber, isMissing, compileQuery } from "./table";
import { parseCsv } from "./csv";
import { printable, singleValue } from "./printable";
import { linePlot, scatterPlot, barPlot, histogramPlot, boxPlot, areaPlot, heatmapPlot, type PlotChart } from "./plots";
import { executeJsCell, executeCustomFunction } from "./notebook";

export type NodeOutput = {
  outputs: Record<string, unknown>;
  tableResult: Table | null;
  plotResult: PlotChart | null;
  exportResult: string | null;
};

export type ExecutionContext = {
  csvText: string;
  inputFiles: Array<{ name: string; text?: string; base64?: string }>;
  notebookNamespace: Record<string, unknown>;
  variables: Map<string, unknown>;
  alertResponse?: unknown;
  inputDialogValue?: unknown;
};

function asBool(raw: unknown): boolean {
  if (typeof raw === "string") return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  return Boolean(raw);
}

function optionalFloat(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric parameter: ${raw}`);
  return number;
}

function scalarValue(raw: unknown): unknown {
  const text = String(raw);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parameterList(raw: unknown, numericWhenPossible = false): unknown[] {
  if (raw === null || raw === undefined || String(raw).trim() === "") return [];
  let items: unknown[];
  if (Array.isArray(raw)) {
    items = raw;
  } else {
    const text = String(raw).trim();
    if (text.startsWith("[")) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array or comma-separated values");
      items = parsed;
    } else {
      items = text.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  if (numericWhenPossible && items.length && items.every((item) => /^-?\d+$/.test(String(item).trim()))) {
    return items.map((item) => Number(item));
  }
  return items.map((item) => String(item));
}

function parseColumns(raw: unknown, columnCount: number): number[] {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return Array.from({ length: columnCount }, (_, i) => i);
  }
  const columns = String(raw).split(",").map((item) => Number(item.trim()));
  const invalid = columns.filter((column) => !Number.isInteger(column) || column < 0 || column >= columnCount);
  if (invalid.length) throw new Error(`Column indexes out of range: ${invalid.join(",")}`);
  return columns;
}

function resolveColumn(table: Table, raw: unknown): string {
  const value = String(raw).trim();
  if (!value) throw new Error("Column name is required");
  if (table.columns.includes(value)) return value;
  const index = Number(value);
  if (!Number.isInteger(index)) throw new Error(`Unknown column: ${value}`);
  if (index < 0 || index >= table.columns.length) throw new Error(`Column index out of range: ${index}`);
  return table.columns[index];
}

function resolveColumns(table: Table, raw: unknown): string[] {
  if (raw === null || raw === undefined || !String(raw).trim()) return [];
  return String(raw).split(",").map((item) => item.trim()).filter(Boolean).map((item) => resolveColumn(table, item));
}

function renameColumns(table: Table, raw: unknown): Table {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Column names are required");
  if (text.startsWith("{")) {
    const mapping = JSON.parse(text) as Record<string, unknown>;
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Column mapping must be a JSON object");
    const resolved = Object.fromEntries(Object.entries(mapping).map(([key, value]) => [resolveColumn(table, key), String(value)]));
    const columns = table.columns.map((column) => resolved[column] ?? column);
    return new Table(columns, table.rows());
  }
  const names = text.split(",").map((item) => item.trim());
  if (names.length !== table.columns.length || names.some((name) => !name)) {
    throw new Error(`Expected ${table.columns.length} non-empty column names, received ${names.length}`);
  }
  return table.renameColumns(names);
}

function requireTable(value: unknown, operation: string): Table {
  if (!(value instanceof Table)) throw new Error(`${operation} requires a table input`);
  return value;
}

function selectedFile(context: ExecutionContext, params: Record<string, unknown>): { name: string; text?: string; base64?: string } {
  if (!context.inputFiles.length) throw new Error("该读取节点需要先选择或拖入文件");
  const index = Number(params.fileIndex ?? 0);
  if (!Number.isInteger(index) || index < 0 || index >= context.inputFiles.length) {
    throw new Error(`文件序号 ${index} 超出范围；当前共 ${context.inputFiles.length} 个文件`);
  }
  return context.inputFiles[index];
}

function decodeJsonCompatible(text: string, label: string): unknown {
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

function readCsv(csvText: string, params: Record<string, unknown>): Table {
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

function readCsvBatch(context: ExecutionContext, params: Record<string, unknown>): Table {
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

function groupAggregate(frame: Table, params: Record<string, unknown>): Table {
  const groupSize = Number(params.groupSize ?? 20);
  const start = Number(params.startRow ?? 0);
  const endRaw = params.endRow;
  const end = String(endRaw ?? "").trim() ? Number(endRaw) : groupSize;
  const method = String(params.method ?? "mean");
  if (!["mean", "median", "min", "max", "sum"].includes(method)) throw new Error(`Unsupported aggregation method: ${method}`);
  return frame.groupAggregate(groupSize, start, end, method as "mean" | "median" | "min" | "max" | "sum");
}

function groupByAggregate(frame: Table, params: Record<string, unknown>): Table {
  const groupBy = resolveColumns(frame, params.groupBy);
  if (!groupBy.length) throw new Error("Groupby aggregate requires at least one grouping column");
  const method = String(params.method ?? "mean");
  if (!["mean", "median", "sum", "min", "max", "std", "count"].includes(method)) {
    throw new Error(`Unsupported groupby method: ${method}`);
  }
  const groupIndexes = groupBy.map((column) => frame.columnIndex(column));
  const numericIndexes = frame.columns
    .map((column, index) => ({ column, index }))
    .filter(({ index }) => !groupIndexes.includes(index))
    .filter(({ index }) => frame.column(index).some((value) => toNumber(value) !== null))
    .map(({ index }) => index);
  const groups = new Map<string, { keys: unknown[]; rows: unknown[][] }>();
  for (const row of frame.rows()) {
    const keys = groupIndexes.map((index) => row[index]);
    const encoded = JSON.stringify(keys);
    const group = groups.get(encoded) ?? { keys, rows: [] };
    group.rows.push(row);
    groups.set(encoded, group);
  }
  const sorted = [...groups.values()].sort((left, right) => JSON.stringify(left.keys).localeCompare(JSON.stringify(right.keys), undefined, { numeric: true }));
  if (method === "count") {
    return new Table([...groupBy, "count"], sorted.map((group) => [...group.keys, group.rows.length]));
  }
  const aggregate = (values: number[]): number | null => {
    if (!values.length) return null;
    if (method === "sum") return values.reduce((total, value) => total + value, 0);
    if (method === "min") return Math.min(...values);
    if (method === "max") return Math.max(...values);
    if (method === "mean") return values.reduce((total, value) => total + value, 0) / values.length;
    if (method === "median") {
      const ordered = [...values].sort((a, b) => a - b);
      const middle = Math.floor(ordered.length / 2);
      return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    }
    if (values.length < 2) return null; // pandas std uses ddof=1
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1));
  };
  return new Table(
    [...groupBy, ...numericIndexes.map((index) => frame.columns[index])],
    sorted.map((group) => [
      ...group.keys,
      ...numericIndexes.map((index) => aggregate(group.rows.map((row) => toNumber(row[index])).filter((value): value is number => value !== null))),
    ]),
  );
}

function filterRange(frame: Table, params: Record<string, unknown>): Table {
  const columnIndex = Number(params.column ?? 0);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= frame.columns.length) {
    throw new Error(`Filter column index out of range: ${columnIndex}`);
  }
  const min = optionalFloat(params.min);
  const max = optionalFloat(params.max);
  return frame.filterRange(columnIndex, min, max);
}

function logicExpression(expression: string, value: number, iteration: number): number | boolean {
  // 与 Python 相同的受控算术语言：value / iteration / 数字 / 算术 / 比较 / and/or/not
  const transformed = expression
    .replace(/\bnot\s+/gi, "! ")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||")
    .replace(/\/\//g, "Math.floor(")
    .replace(/\*\*/g, "Math.pow(");
  let script = transformed;
  // 处理 // 与 ** 的括号闭合
  const floorCount = (script.match(/Math\.floor\(/g) ?? []).length;
  const powCount = (script.match(/Math\.pow\(/g) ?? []).length;
  for (let i = 0; i < floorCount; i += 1) {
    // 找到对应二元运算的位置比较困难，这里用保守替代：仅支持简单形式
    script = script.replace(/Math\.floor\(([^()]+)\)/g, "Math.floor($1)");
  }
  void powCount;
  let result: unknown;
  try {
    // eslint-disable-next-line no-new-func
    result = new Function("value", "iteration", `return (${script});`)(value, iteration);
  } catch {
    throw new Error("While expressions support only value, iteration, numbers, arithmetic, comparisons, and/or/not");
  }
  if (typeof result !== "number" && typeof result !== "boolean") {
    throw new Error("While expression must produce a number or boolean");
  }
  return result;
}

export function terMatrix(frame: Table, params: Record<string, unknown>): Table {
  const vgColumn = resolveColumn(frame, params.vgColumn ?? "Vg_V");
  const voltageColumn = resolveColumn(frame, params.voltageColumn ?? 0);
  const currentColumn = resolveColumn(frame, params.currentColumn ?? 1);
  const currentFloor = Number(params.currentFloor ?? 1e-15);
  const mode = String(params.mode ?? "high-low");
  if (!["high-low", "down-minus-up", "up-minus-down"].includes(mode)) throw new Error(`Unsupported TER mode: ${mode}`);
  const sourceColumn = String(params.sourceColumn ?? "source_file").trim();

  // 按 Vg 分组（排序）
  const vgIndexes = new Map<string, number[]>();
  frame.rows().forEach((row, r) => {
    const key = String(row[frame.columnIndex(vgColumn)]);
    const list = vgIndexes.get(key) ?? [];
    list.push(r);
    vgIndexes.set(key, list);
  });
  const vgKeys = [...vgIndexes.keys()].sort((a, b) => Number(a) - Number(b));
  const groups: Array<{ vg: string; voltages: number[]; currents: number[]; source: string }> = [];
  let detectedMin = Number.POSITIVE_INFINITY;
  let detectedMax = Number.NEGATIVE_INFINITY;
  let detectedStep = Number.POSITIVE_INFINITY;
  for (const vg of vgKeys) {
    const indexes = vgIndexes.get(vg) ?? [];
    const cleaned: Array<{ voltage: number; current: number }> = [];
    for (const r of indexes) {
      const row = frame.row(r);
      const voltage = toNumber(row[frame.columnIndex(voltageColumn)]);
      const current = toNumber(row[frame.columnIndex(currentColumn)]);
      if (voltage !== null && current !== null && Number.isFinite(voltage) && Number.isFinite(current)) {
        cleaned.push({ voltage, current });
      }
    }
    if (cleaned.length < 3) throw new Error(`Vg=${vg} has fewer than 3 valid samples`);
    const voltages = cleaned.map((item) => item.voltage);
    const currents = cleaned.map((item) => item.current);
    for (let i = 1; i < voltages.length; i += 1) {
      const difference = Math.abs(voltages[i] - voltages[i - 1]);
      if (difference > 1e-12) detectedStep = Math.min(detectedStep, difference);
    }
    detectedMin = Math.min(detectedMin, ...voltages);
    detectedMax = Math.max(detectedMax, ...voltages);
    const firstRow = frame.row(indexes[0]);
    const source = sourceColumn && frame.columns.includes(sourceColumn) ? String(firstRow[frame.columnIndex(sourceColumn)] ?? "") : "";
    groups.push({ vg, voltages, currents, source });
  }

  const step = optionalFloat(params.vstep) || detectedStep;
  const vmin = optionalFloat(params.vmin);
  const vmax = optionalFloat(params.vmax);
  const low = vmin === null || vmin === 0 ? detectedMin : vmin;
  const high = vmax === null || vmax === 0 ? detectedMax : vmax;
  if (!Number.isFinite(step) || step <= 0 || !(low < 0 && high > 0)) {
    throw new Error("Unable to detect a valid Vds range and step");
  }
  const tolerance = optionalFloat(params.tolerance) || step / 20;

  const targets: number[] = [];
  for (let target = low; target < -step / 2; target += step) targets.push(round12(target));
  for (let target = step; target <= high + step / 2; target += step) targets.push(round12(target));

  const records: Array<Record<string, unknown>> = [];
  for (const group of groups) {
    const directions = new Array<number>(group.voltages.length).fill(0);
    for (let index = 0; index < group.voltages.length; index += 1) {
      if (index > 0 && Math.abs(group.voltages[index] - group.voltages[index - 1]) > tolerance) {
        directions[index] = group.voltages[index] > group.voltages[index - 1] ? 1 : -1;
      } else if (index + 1 < group.voltages.length && Math.abs(group.voltages[index + 1] - group.voltages[index]) > tolerance) {
        directions[index] = group.voltages[index + 1] > group.voltages[index] ? 1 : -1;
      }
    }
    for (const target of targets) {
      const matched: number[] = [];
      group.voltages.forEach((measured, index) => {
        if (Math.abs(measured - target) <= tolerance) matched.push(index);
      });
      const up = matched.filter((index) => directions[index] === 1);
      const down = matched.filter((index) => directions[index] === -1);
      const iUp = up.length ? group.currents[up[0]] : Number.NaN;
      const iDown = down.length ? group.currents[down[0]] : Number.NaN;
      const rUp = Number.isFinite(iUp) && Math.abs(iUp) > currentFloor ? Math.abs(target / iUp) : Number.NaN;
      const rDown = Number.isFinite(iDown) && Math.abs(iDown) > currentFloor ? Math.abs(target / iDown) : Number.NaN;
      let ter = Number.NaN;
      if (Number.isFinite(rUp) && Number.isFinite(rDown)) {
        if (mode === "down-minus-up" && rUp !== 0) ter = ((rDown - rUp) / rUp) * 100;
        else if (mode === "up-minus-down" && rDown !== 0) ter = ((rUp - rDown) / rDown) * 100;
        else if (mode === "high-low") {
          const rLow = Math.min(rUp, rDown);
          const rHigh = Math.max(rUp, rDown);
          if (rLow !== 0) ter = ((rHigh - rLow) / rLow) * 100;
        }
      }
      records.push({
        Vg_V: Number(group.vg),
        Vds_V: target,
        I_up_A: iUp,
        I_down_A: iDown,
        R_up_ohm: rUp,
        R_down_ohm: rDown,
        TER_percent: ter,
        ...(group.source ? { source_file: group.source } : {}),
      });
    }
  }
  const table = Table.fromRecords(records);
  return table.sortValues(["Vg_V", "Vds_V"], true, "last");
}

function round12(value: number): number {
  return Number(value.toFixed(12));
}

function pulseWaveform(params: Record<string, unknown>): Table {
  const voltageMax = Number(params.voltageMax ?? 3);
  const voltageStep = Math.abs(Number(params.voltageStep ?? 0.2));
  const readVoltage = Number(params.readVoltage ?? 0.1);
  const pulseTime = Number(params.pulseTime ?? 0.01);
  const readTime = Number(params.readTime ?? 0.01);
  const timeShift = Number(params.timeShift ?? 0);
  const cycles = Number(params.cycles ?? 1);
  const ratio = Number(params.ratio ?? 1);
  if (!Number.isFinite(voltageMax) || voltageMax === 0 || !Number.isFinite(voltageStep) || voltageStep <= 0) {
    throw new Error("Pulse waveform requires a non-zero voltage maximum and a positive voltage step");
  }
  if (![pulseTime, readTime].every((value) => Number.isFinite(value) && value >= 0) || pulseTime + readTime <= 0) {
    throw new Error("Pulse and read times must be finite and their sum must be positive");
  }
  if (cycles !== 0.25 && cycles !== 0.5 && (!Number.isInteger(cycles) || cycles < 1 || cycles > 100)) {
    throw new Error("Pulse cycles must be 0.25, 0.5, or an integer from 1 to 100");
  }
  const direction = voltageMax > 0 ? 1 : -1;
  const magnitudes: number[] = [];
  for (let value = Math.min(voltageStep, Math.abs(voltageMax)); value <= Math.abs(voltageMax) + voltageStep * 0.01; value += voltageStep) {
    magnitudes.push(round12(value));
  }
  if (!magnitudes.length || Math.abs(magnitudes[magnitudes.length - 1] - Math.abs(voltageMax)) > voltageStep * 0.01) {
    magnitudes.push(Math.abs(voltageMax));
  }
  const levels = magnitudes.map((value) => direction * Math.min(value, Math.abs(voltageMax)));
  const quarter = levels;
  const half = [...quarter, ...quarter.map((value) => -value)];
  const sequence = cycles === 0.25 ? quarter : cycles === 0.5 ? half : [...half, ...[...half].reverse()];
  const repeat = cycles >= 1 ? Math.trunc(cycles) : 1;
  const final = Array.from({ length: repeat }, () => sequence).flat();
  if (final.length * 2 > 100_000) throw new Error("Pulse waveform exceeds the 100000-row safety limit");
  const rows: Array<Record<string, unknown>> = [];
  let moment = timeShift;
  final.forEach((level, index) => {
    moment += readTime;
    rows.push({ sequence: index, time_s: moment, voltage_V: readVoltage * ratio, phase: "read" });
    moment += pulseTime;
    rows.push({ sequence: index, time_s: moment, voltage_V: level * ratio, phase: "pulse" });
  });
  return new Table(["sequence", "time_s", "voltage_V", "phase"], rows.map((row) => [row.sequence, row.time_s, row.voltage_V, row.phase]));
}

function oscillatingPulseRamp(params: Record<string, unknown>): Table {
  const interval = Number(params.interval ?? 0.005);
  const total = Number(params.totalTime ?? 10);
  const step = Math.abs(Number(params.amplitudeStep ?? 0.2));
  const fixed = Number(params.fixedVoltage ?? 0.6);
  const gate = Number(params.gateVoltage ?? 0);
  if (![interval, total, step, fixed, gate].every(Number.isFinite) || interval <= 0 || total <= 0 || step <= 0) {
    throw new Error("Oscillating pulse interval, total time and amplitude step must be positive finite values");
  }
  const count = Math.max(0, Math.ceil(total / interval) - 1);
  if (count > 100_000) throw new Error("Oscillating pulse waveform exceeds the 100000-row safety limit");
  const rows: Array<Array<number>> = [];
  let magnitude = step;
  let sign = 1;
  for (let index = 0; index < count; index += 1) {
    const moment = (index + 1) * interval;
    if (index % 2 === 0) {
      rows.push([moment, 0, fixed, gate]);
    } else {
      rows.push([moment, sign * magnitude, 0, gate]);
      // Match the Python runtime exactly: +step, -step, +2*step, -2*step, …
      // and only advance magnitude after the negative half-cycle completes.
      if (sign > 0) sign = -1;
      else {
        sign = 1;
        magnitude += step;
      }
    }
  }
  return new Table(["time_s", "port1_V", "port2_V", "port3_V"], rows);
}

function pulseCombineChannels(upstream: Record<string, unknown>, params: Record<string, unknown>): Table {
  const timeName = String(params.timeColumn ?? "time_s");
  const voltageName = String(params.voltageColumn ?? "voltage_V");
  const columns: Record<string, string> = { drain: "Vd_V", source: "Vs_V", gate: "Vg_V" };
  const prepared: Array<{ time: number[]; values: number[]; output: string }> = [];
  for (const [port, outputColumn] of Object.entries(columns)) {
    const table = upstream[port];
    if (table === null || table === undefined) continue;
    const frame = requireTable(table, `Pulse ${port} waveform`);
    const timeColumn = resolveColumn(frame, timeName);
    const voltageColumn = resolveColumn(frame, voltageName);
    const rows = frame.rows().map((row) => ({
      time: toNumber(row[frame.columnIndex(timeColumn)]),
      value: toNumber(row[frame.columnIndex(voltageColumn)]),
    })).filter((item) => item.time !== null).sort((a, b) => (a.time as number) - (b.time as number));
    prepared.push({ time: rows.map((item) => item.time as number), values: rows.map((item) => item.value ?? 0), output: outputColumn });
  }
  if (!prepared.length) throw new Error("Combine Vd / Vs / Vg requires at least one waveform");
  const allTimes = [...new Set(prepared.flatMap((item) => item.time))].sort((a, b) => a - b);
  const rows = allTimes.map((time) => {
    const row: Array<number> = [time];
    for (const item of prepared) {
      // merge_asof：最近一个 <= time 的值
      let value = 0;
      for (let i = 0; i < item.time.length; i += 1) {
        if (item.time[i] <= time) value = item.values[i];
        else break;
      }
      row.push(value);
    }
    return row;
  });
  return new Table(["time_s", ...prepared.map((item) => item.output)], rows);
}

function pulseSegmentMeasurement(upstream: Record<string, unknown>, params: Record<string, unknown>): Table {
  const measurement = requireTable(upstream.measurement, "Pulse measurement");
  const waveform = requireTable(upstream.waveform, "Pulse waveform");
  const measuredTime = resolveColumn(measurement, params.measurementTimeColumn ?? "time");
  const current = resolveColumn(measurement, params.currentColumn ?? "current");
  const waveformTime = resolveColumn(waveform, params.waveformTimeColumn ?? "time_s");
  const waveformVoltage = resolveColumn(waveform, params.waveformVoltageColumn ?? "voltage_V");
  const leading = Number(params.dropLeadingRows ?? 0);
  const trailing = Number(params.dropTrailingRows ?? 0);
  if (leading < 0 || trailing < 0) throw new Error("Pulse segment row trimming must not be negative");
  const samples = measurement.rows().map((row) => ({
    time: toNumber(row[measurement.columnIndex(measuredTime)]),
    current: toNumber(row[measurement.columnIndex(current)]),
  })).filter((item) => item.time !== null && item.current !== null).sort((a, b) => (a.time as number) - (b.time as number));
  const events = waveform.rows().map((row, r) => ({
    sequence: row[waveform.columns.includes("sequence") ? waveform.columnIndex("sequence") : -1] ?? r,
    phase: waveform.columns.includes("phase") ? String(row[waveform.columnIndex("phase")] ?? "pulse") : "pulse",
    time: toNumber(row[waveform.columnIndex(waveformTime)]),
    voltage: toNumber(row[waveform.columnIndex(waveformVoltage)]),
  })).filter((item) => item.time !== null).sort((a, b) => (a.time as number) - (b.time as number));
  if (!events.length) throw new Error("Pulse waveform contains no valid time values");
  const times = samples.map((item) => item.time as number);
  const currents = samples.map((item) => item.current as number);
  const searchLeft = (value: number): number => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const rows: Array<Array<unknown>> = [];
  events.forEach((event, index) => {
    const start = searchLeft(event.time as number);
    const endTime = index + 1 < events.length ? events[index + 1].time as number : Number.POSITIVE_INFINITY;
    const end = searchLeft(endTime);
    let segment = currents.slice(start, end).slice(leading, trailing === 0 ? undefined : -trailing);
    rows.push([
      event.sequence,
      event.phase,
      event.time,
      event.voltage,
      segment.length,
      segment.length ? segment.reduce((a, b) => a + b, 0) / segment.length : Number.NaN,
    ]);
  });
  return new Table(["sequence", "phase", "waveform_time_s", "voltage_V", "sample_count", "mean_current_A"], rows);
}

export function executeNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput {
  const tableResult: Table | null = null;
  const plotResult: PlotChart | null = null;
  const exportResult: string | null = null;

  const table = (): Table => requireTable(upstream, "Table input");

  switch (nodeType) {
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
    case "table.concat": {
      const axis = Number(params.axis ?? 0);
      if (axis !== 0 && axis !== 1) throw new Error("Concat axis must be 0 or 1");
      const inputs = upstream as Record<string, unknown>;
      const left = requireTable(inputs.left, "Concat input left");
      const right = requireTable(inputs.right, "Concat input right");
      const value = left.concat(right, axis as 0 | 1, asBool(params.ignoreIndex ?? axis === 0));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.select_columns": {
      const value = table().selectColumns(parseColumns(params.columns, table().columns.length));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.absolute": {
      const value = table().abs();
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.transpose": {
      const value = table().transpose();
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.slice": {
      const frame = table();
      const part = (prefix: string): { start: number | null; stop: number | null; step: number } => {
        const start = params[`${prefix}Start`];
        const stop = params[`${prefix}Stop`];
        const step = Number(params[`${prefix}Step`] ?? 1);
        if (step === 0) throw new Error("Slice step cannot be zero");
        return {
          start: start === null || start === undefined || start === "" ? null : Number(start),
          stop: stop === null || stop === undefined || stop === "" ? null : Number(stop),
          step,
        };
      };
      const row = part("row");
      const column = part("column");
      const rowStart = row.start ?? 0;
      const rowStop = row.stop ?? frame.rowCount;
      const columnStart = column.start ?? 0;
      const columnStop = column.stop ?? frame.columns.length;
      const rows = Array.from({ length: frame.rowCount }, (_, i) => i).filter((_, i) => {
        const relative = (i - rowStart) / row.step;
        return Number.isInteger(relative) && relative >= 0 && i >= rowStart && i < rowStop;
      });
      const selected = table().selectColumns(Array.from({ length: frame.columns.length }, (_, c) => c).filter((c) => {
        const relative = (c - columnStart) / column.step;
        return Number.isInteger(relative) && relative >= 0 && c >= columnStart && c < columnStop;
      }));
      const value = selected.takeRows(rows);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.reset_index": {
      const value = table().resetIndex(asBool(params.drop ?? true));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.periodic_window": {
      const frame = table();
      const groupSize = Number(params.groupSize ?? 75);
      const count = Number(params.count ?? 25);
      if (groupSize < 1 || count < 1) throw new Error("Periodic window sizes must be positive");
      const position = String(params.position ?? "start");
      const offset = position === "end" ? groupSize - count : position === "offset" ? Number(params.offset ?? 0) : 0;
      const indexes: number[] = [];
      for (let base = 0; base < frame.rowCount; base += groupSize) {
        for (let r = base + offset; r < Math.min(base + offset + count, frame.rowCount); r += 1) indexes.push(r);
      }
      const value = frame.takeRows(indexes);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.periodic_tail_mean": {
      const frame = table();
      const value = frame.periodicTailMean(Number(params.groupSize ?? 25), Number(params.tailRows ?? 10));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.sort_index": {
      const axis = Number(params.axis ?? 0);
      const value = table().sortIndex(asBool(params.ascending ?? true), axis);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.difference": {
      const value = table().diff(Number(params.periods ?? 1), Number(params.axis ?? 0));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.filter_range": {
      const value = filterRange(table(), params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.rename_columns": {
      const value = renameColumns(table(), params.names);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.pivot": {
      const frame = table();
      const index = resolveColumns(frame, params.index);
      const columns = resolveColumns(frame, params.columns);
      const values = resolveColumns(frame, params.values);
      if (index.length !== 1 || columns.length !== 1 || values.length !== 1) throw new Error("Pivot requires one row key, column key, and value column");
      const aggregate = String(params.aggregate ?? "mean");
      if (!["mean", "first", "max", "min"].includes(aggregate)) throw new Error("Unsupported pivot aggregate");
      let value = frame.pivot(index[0], columns[0], values[0], aggregate as "mean" | "first" | "max" | "min");
      if (asBool(params.resetIndex ?? true)) value = value;
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.dropna": {
      const frame = table();
      const how = String(params.how ?? "any");
      if (!["any", "all"].includes(how)) throw new Error("Drop missing values supports only any or all");
      const subset = resolveColumns(frame, params.subset);
      const value = frame.dropna(how as "any" | "all", subset);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.fillna": {
      const frame = table();
      const method = String(params.method ?? "value");
      let value: Table;
      if (method === "forward") value = frame.fillna("forward");
      else if (method === "backward") value = frame.fillna("backward");
      else if (method === "value") value = frame.fillna("value", scalarValue(params.value ?? "0"));
      else throw new Error(`Unsupported fill method: ${method}`);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.sort_values": {
      const frame = table();
      const columns = resolveColumns(frame, params.columns);
      if (!columns.length) throw new Error("Sort values requires at least one column");
      const naPosition = String(params.naPosition ?? "last");
      if (!["first", "last"].includes(naPosition)) throw new Error("naPosition must be first or last");
      const value = frame.sortValues(columns, asBool(params.ascending ?? true), naPosition as "first" | "last");
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.head": {
      const value = table().head(Number(params.n ?? 5));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.tail": {
      const value = table().tail(Number(params.n ?? 5));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.drop_duplicates": {
      const frame = table();
      const subset = resolveColumns(frame, params.subset);
      const keepRaw = String(params.keep ?? "first");
      const keep = keepRaw === "false" ? false : keepRaw as "first" | "last";
      const value = frame.dropDuplicates(subset, keep);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.sample": {
      const frame = table();
      const fraction = optionalFloat(params.fraction);
      const n = portableSampleCount(frame.rowCount, fraction, Number(params.n ?? 5));
      const value = frame.sample(n, asBool(params.replace ?? false), Number(params.randomState ?? 0));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.round": {
      const value = table().round(Number(params.decimals ?? 2));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.describe": {
      const frame = table();
      const percentiles = parameterList(params.percentiles).map((item) => Number(item));
      const includeText = String(params.include ?? "").trim();
      const excludeText = String(params.exclude ?? "").trim();
      const include = includeText === "all" ? "all" as const : includeText ? parameterList(includeText).map(String) : null;
      const exclude = excludeText ? parameterList(excludeText).map(String) : null;
      const value = frame.describe(percentiles, include, exclude);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pandas.query": {
      const expression = String(params.expression ?? "").trim();
      if (!expression) throw new Error("Query expression is required");
      const value = table().query(expression);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "logic.if_rows": {
      const frame = table();
      const condition = String(params.condition ?? "").trim();
      if (!condition) throw new Error("Conditional branch requires a condition");
      const matching = frame.query(condition);
      const rejectedIndexes = new Set(matching.rows().map((row) => frame.rows().findIndex((item) => JSON.stringify(item) === JSON.stringify(row))));
      void rejectedIndexes;
      // 保留原表相对顺序的补集
      const kept = frame.rows().map((row) => frame.rows().indexOf(row)).filter((index, position, self) => self.indexOf(index) === position);
      const matchingSet = new Set(matching.rows().map((row) => JSON.stringify(row)));
      const falseRows = frame.rows().filter((row) => !matchingSet.has(JSON.stringify(row)));
      void kept;
      const trueTable = new Table(frame.columns, matching.rows());
      const falseTable = new Table(frame.columns, falseRows);
      return { outputs: { true: trueTable, false: falseTable }, tableResult: trueTable, plotResult, exportResult };
    }
    case "logic.merge_rows": {
      const inputs = upstream as Record<string, unknown>;
      const left = requireTable(inputs.left, "Branch merge A");
      const right = requireTable(inputs.right, "Branch merge B");
      const ignoreIndex = asBool(params.ignoreIndex ?? true);
      const value = left.concat(right, 0, ignoreIndex);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "logic.for_range": {
      const start = Number(params.start ?? 0);
      const stop = Number(params.stop ?? 10);
      const step = Number(params.step ?? 1);
      if (step === 0) throw new Error("For range step must not be zero");
      const values: number[] = [];
      for (let value = start; step > 0 ? value < stop : value > stop; value += step) values.push(value);
      if (values.length > 100_000) throw new Error("For range is limited to 100000 iterations");
      const value = new Table(["iteration", "value"], values.map((item, index) => [index, item]));
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "logic.while_number": {
      let current = Number(params.start ?? 0);
      const condition = String(params.condition ?? "value < 10").trim();
      const update = String(params.update ?? "value + 1").trim();
      const maximum = Number(params.maxIterations ?? 100);
      if (!condition || !update || maximum < 1 || maximum > 10_000) {
        throw new Error("While requires expressions and maxIterations between 1 and 10000");
      }
      const rows: Array<Array<number>> = [];
      for (let iteration = 0; iteration < maximum; iteration += 1) {
        if (!Boolean(logicExpression(condition, current, iteration))) break;
        rows.push([iteration, current]);
        const nextValue = logicExpression(update, current, iteration);
        if (typeof nextValue === "boolean") throw new Error("While update expression must produce a number");
        current = Number(nextValue);
        if (iteration === maximum - 1 && Boolean(logicExpression(condition, current, maximum))) {
          throw new Error(`While reached the safety limit of ${maximum} iterations`);
        }
      }
      return { outputs: { output: new Table(["iteration", "value"], rows) }, tableResult: new Table(["iteration", "value"], rows), plotResult, exportResult };
    }
    case "table.group_mean":
    case "table.group_aggregate": {
      const mergedParams = nodeType === "table.group_mean" ? { ...params, method: "mean", startRow: 0, endRow: params.groupSize ?? 20 } : params;
      const value = groupAggregate(table(), mergedParams);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.groupby_aggregate": {
      const value = groupByAggregate(table(), params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "analysis.ter_matrix": {
      const value = terMatrix(table(), params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.generate_waveform": {
      const value = pulseWaveform(params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.generate_oscillating_ramp": {
      const value = oscillatingPulseRamp(params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.combine_channels": {
      const value = pulseCombineChannels(upstream as Record<string, unknown>, params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.segment_measurement": {
      const value = pulseSegmentMeasurement(upstream as Record<string, unknown>, params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "plot.line": {
      const chart = linePlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.scatter": {
      const chart = scatterPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.bar": {
      const chart = barPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.histogram": {
      const chart = histogramPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.box": {
      const chart = boxPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.area": {
      const chart = areaPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.heatmap": {
      const chart = heatmapPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
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
    case "variable.set": {
      const name = String(params.name ?? "").trim();
      if (!name) throw new Error("Set variable requires a name");
      context.variables.set(name, upstream);
      return { outputs: { output: upstream }, tableResult: upstream instanceof Table ? upstream : null, plotResult, exportResult };
    }
    case "variable.get": {
      const name = String(params.name ?? "").trim();
      if (!name) throw new Error("Get variable requires a name");
      if (!context.variables.has(name)) throw new Error(`Variable ${JSON.stringify(name)} is not defined; add a 设置变量 node before reading it`);
      const value = context.variables.get(name);
      return { outputs: { output: value }, tableResult: value instanceof Table ? value : null, plotResult, exportResult };
    }
    case "custom.python_function": {
      const outputs = executeCustomFunction(String(params.code ?? ""), (upstream as Record<string, unknown>) ?? {}, params);
      const tableValue = Object.values(outputs).find((item) => item instanceof Table);
      return { outputs, tableResult: tableValue instanceof Table ? tableValue : null, plotResult, exportResult };
    }
    case "notebook.code_cell": {
      const source = typeof params.notebookSource === "string" ? params.notebookSource : String(params.source ?? "");
      const result = executeJsCell(source, context.notebookNamespace);
      return { outputs: result.outputs, tableResult: result.table, plotResult: result.plot, exportResult };
    }
    case "notebook.markdown_cell": {
      const text = String(params.source ?? "");
      return { outputs: { next: text, output: text }, tableResult, plotResult, exportResult };
    }
    case "notebook.if_block":
    case "notebook.for_block":
    case "notebook.while_block": {
      const source = String(params.notebookSource ?? "");
      const result = executeJsCell(source, context.notebookNamespace);
      return { outputs: result.outputs, tableResult: result.table, plotResult: result.plot, exportResult };
    }
    default:
      throw new Error(`Unsupported node type: ${nodeType}`);
  }
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Table) return value.records();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}
