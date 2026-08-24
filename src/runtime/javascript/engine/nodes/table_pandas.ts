import { PortableRandom, portableSampleCount } from "../random";
import { Table, compileQuery, isMissing, toNumber } from "../table";
import { asBool, optionalFloat, parameterList, parseColumns, renameColumns, requireTable, resolveColumn, resolveColumns, scalarValue } from "./support/common";
import { filterRange, groupAggregate, groupByAggregate } from "./support/table_ops";
import type { ExecutionContext, NodeOutput } from "./support/types";

export function executeTablePandasNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput | null {
  const tableResult: Table | null = null;
  const plotResult = null;
  const exportResult: string | null = null;
  const table = (): Table => requireTable(upstream, "Table input");

  switch (nodeType) {
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
    case "table.column_math": {
      const frame = table();
      const columns = resolveColumns(frame, params.columns);
      if (!columns.length) throw new Error("Column math requires at least one target column");
      const operation = String(params.operation ?? "multiply");
      if (!["add", "subtract", "multiply", "divide", "power", "absolute", "negate"].includes(operation)) {
        throw new Error(`Unsupported column math operation: ${operation}`);
      }
      const operand = Number(params.operand ?? 1);
      if (!Number.isFinite(operand)) throw new Error("Column math operand must be finite");
      if (operation === "divide" && operand === 0) throw new Error("Column math cannot divide by zero");
      const selected = new Set(columns.map((column) => frame.columnIndex(column)));
      const value = new Table(frame.columns, frame.rows().map((row) => row.map((cell, columnIndex) => {
        if (!selected.has(columnIndex) || isMissing(cell)) return cell;
        const number = toNumber(cell);
        if (number === null) throw new Error(`Column math requires numeric values in ${frame.columns[columnIndex]}`);
        if (operation === "add") return number + operand;
        if (operation === "subtract") return number - operand;
        if (operation === "multiply") return number * operand;
        if (operation === "divide") return number / operand;
        if (operation === "power") return number ** operand;
        if (operation === "absolute") return Math.abs(number);
        return -number;
      })));
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
        const step = Math.trunc(Number(params[`${prefix}Step`] ?? 1));
        if (step === 0) throw new Error("Slice step cannot be zero");
        return { start: start === null || start === undefined || start === "" ? null : Number(start), stop: stop === null || stop === undefined || stop === "" ? null : Number(stop), step };
      };
      const indexes = (length: number, slice: { start: number | null; stop: number | null; step: number }): number[] => {
        const lower = slice.step < 0 ? -1 : 0;
        const upper = slice.step < 0 ? length - 1 : length;
        const norm = (value: number | null, isStart: boolean) => {
          if (value === null) return isStart ? (slice.step < 0 ? upper : lower) : (slice.step < 0 ? lower : upper);
          let result = Math.trunc(value); if (result < 0) result += length;
          return Math.min(upper, Math.max(lower, result));
        };
        const start = norm(slice.start, true); const stop = norm(slice.stop, false); const result: number[] = [];
        if (slice.step > 0) for (let i = start; i < stop; i += slice.step) result.push(i);
        else for (let i = start; i > stop; i += slice.step) result.push(i);
        return result;
      };
      const row = part("row"); const column = part("column");
      const value = frame.selectColumns(indexes(frame.columnCount, column)).takeRows(indexes(frame.rowCount, row));
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
      if (offset < 0 || offset + count > groupSize) throw new Error("Periodic window must stay inside each group");
      const indexes: number[] = [];
      for (let base = 0; base < frame.rowCount; base += groupSize) {
        for (let r = base + offset; r < Math.min(base + offset + count, frame.rowCount); r += 1) indexes.push(r);
      }
      const value = frame.takeRows(indexes);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.periodic_tail_mean": {
      const frame = table();
      const value = frame.periodicTailMean(Number(params.groupSize ?? 25), Number(params.tailRows ?? 10), String(params.partialGroup ?? "include") as "include" | "drop" | "error");
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.row_chunks_to_columns": {
      const frame = table();
      const chunks = Number(params.chunks ?? 2);
      if (!Number.isInteger(chunks) || chunks < 1) throw new Error("Row chunks to columns requires chunks >= 1");
      const rows = frame.rows();
      const base = Math.floor(rows.length / chunks);
      const remainder = rows.length % chunks;
      const parts: unknown[][][] = [];
      let cursor = 0;
      for (let index = 0; index < chunks; index += 1) {
        const size = base + (index < remainder ? 1 : 0);
        parts.push(rows.slice(cursor, cursor + size));
        cursor += size;
      }
      const height = Math.max(0, ...parts.map((part) => part.length));
      const outputRows = Array.from({ length: height }, (_, rowIndex) => parts.flatMap((part) => part[rowIndex] ?? frame.columns.map(() => null)));
      const outputColumns = Array.from({ length: chunks }, (_, chunkIndex) => frame.columns.map((column) => `${column}_${chunkIndex + 1}`)).flat();
      const value = new Table(outputColumns, outputRows);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "stats.column_group_cv": {
      const frame = table();
      const groupSize = Number(params.groupSize ?? 50);
      if (!Number.isInteger(groupSize) || groupSize < 1) throw new Error("Column group CV requires groupSize >= 1");
      const rows = frame.rows();
      const groups: Array<Array<number | null>> = [];
      for (let start = 0; start < frame.columns.length; start += groupSize) {
        const stop = Math.min(start + groupSize, frame.columns.length);
        groups.push(rows.map((row) => {
          const values = row.slice(start, stop).map((item) => Number(item)).filter((item) => Number.isFinite(item));
          if (!values.length) return null;
          const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
          if (mean === 0) return null;
          const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length;
          return Math.sqrt(variance) / mean;
        }));
      }
      return { outputs: { output: groups }, tableResult, plotResult, exportResult };
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
    default:
      return null;
  }
}
