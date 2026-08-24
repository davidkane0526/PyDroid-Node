import { Table, isMissing, toNumber } from "../../table";
import { resolveColumns } from "./common";

const BINARY = new Set(["add", "subtract", "multiply", "divide", "power"]);
const UNARY = new Set(["absolute", "negate", "sqrt", "square", "log10", "ln", "exp", "reciprocal", "normalize", "zscore"]);

function finiteNumber(raw: unknown, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Column math ${label} must be finite`);
  return value;
}

export function columnTransformSpec(params: Record<string, unknown>): Record<string, unknown> {
  const columns = params.columns;
  if (columns === null || columns === undefined || (typeof columns === "string" && !columns.trim())) throw new Error("Column transform requires at least one target column");
  const operation = String(params.operation ?? "multiply");
  if (!BINARY.has(operation) && !UNARY.has(operation) && operation !== "clip") throw new Error(`Unsupported column math operation: ${operation}`);
  const result: Record<string, unknown> = { columns, operation };
  if (BINARY.has(operation) || operation === "clip") result.operand = finiteNumber(params.operand ?? 1, "operand");
  if (operation === "clip") {
    result.operand2 = finiteNumber(params.operand2 ?? 1, "second operand");
    if (Number(result.operand) > Number(result.operand2)) throw new Error("Column math clip minimum cannot exceed maximum");
  }
  if (operation === "divide" && Number(result.operand) === 0) throw new Error("Column math cannot divide by zero");
  return result;
}

export function columnMath(frame: Table, params: Record<string, unknown>): Table {
  const transform = columnTransformSpec(params);
  const columns = resolveColumns(frame, transform.columns);
  if (!columns.length) throw new Error("Column math requires at least one target column");
  const operation = String(transform.operation);
  const operand = Number(transform.operand ?? 0);
  const operand2 = Number(transform.operand2 ?? 0);

  const selected = new Map(columns.map((column) => [frame.columnIndex(column), column]));
  const sourceRows = frame.rows();
  const normalizedStats = new Map<number, { min: number; max: number; mean: number; std: number }>();
  if (operation === "normalize" || operation === "zscore") {
    for (const [index, column] of selected) {
      const values = sourceRows.map((row) => row[index]).filter((value) => !isMissing(value)).map((value) => {
        const number = toNumber(value);
        if (number === null) throw new Error(`Column math requires numeric values in ${column}`);
        return number;
      });
      if (!values.length) throw new Error(`Column math requires numeric values in ${column}`);
      let min = values[0]; let max = values[0];
      for (const value of values.slice(1)) { if (value < min) min = value; if (value > max) max = value; }
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const std = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      if (operation === "normalize" && max === min) throw new Error(`Column math cannot normalize constant column ${column}`);
      if (operation === "zscore" && std === 0) throw new Error(`Column math cannot standardize constant column ${column}`);
      normalizedStats.set(index, { min, max, mean, std });
    }
  }

  const value = new Table(frame.columns, sourceRows.map((row) => row.map((cell, columnIndex) => {
    const column = selected.get(columnIndex);
    if (!column || isMissing(cell)) return cell;
    const number = toNumber(cell);
    if (number === null) throw new Error(`Column math requires numeric values in ${column}`);
    if (operation === "add") return number + operand;
    if (operation === "subtract") return number - operand;
    if (operation === "multiply") return number * operand;
    if (operation === "divide") return number / operand;
    if (operation === "power") return number ** operand;
    if (operation === "absolute") return Math.abs(number);
    if (operation === "negate") return -number;
    if (operation === "sqrt") {
      if (number < 0) throw new Error(`Column math sqrt requires non-negative values in ${column}`);
      return Math.sqrt(number);
    }
    if (operation === "square") return number ** 2;
    if (operation === "log10") {
      if (number <= 0) throw new Error(`Column math log10 requires positive values in ${column}`);
      return Math.log10(number);
    }
    if (operation === "ln") {
      if (number <= 0) throw new Error(`Column math ln requires positive values in ${column}`);
      return Math.log(number);
    }
    if (operation === "exp") {
      const result = Math.exp(number);
      if (!Number.isFinite(result)) throw new Error(`Column math exp overflow in ${column}`);
      return result;
    }
    if (operation === "reciprocal") {
      if (number === 0) throw new Error(`Column math reciprocal cannot divide by zero in ${column}`);
      return 1 / number;
    }
    if (operation === "clip") return Math.min(operand2, Math.max(operand, number));
    const stats = normalizedStats.get(columnIndex)!;
    if (operation === "normalize") return (number - stats.min) / (stats.max - stats.min);
    return (number - stats.mean) / stats.std;
  })));
  return value;
}
