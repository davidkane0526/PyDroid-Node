import { logicExpression } from "./support/control";
import type { ExecutionContext, NodeOutput } from "./support/types";

const SUPPORTED = new Set([
  "sequence.consecutive_segments",
  "sequence.filter_short_segments",
  "sequence.map_expression",
  "sequence.reduce",
  "sequence.accumulate",
]);

function sequence(upstream: unknown): unknown[] {
  if (!Array.isArray(upstream)) throw new Error("Sequence node requires a list input");
  return upstream;
}

function numericSequence(upstream: unknown): number[] {
  return sequence(upstream).map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) throw new Error("Sequence numeric node requires finite number values");
    return item;
  });
}

function integerSequence(upstream: unknown): number[] {
  const values = sequence(upstream).map((item) => Number(item));
  if (values.some((item) => !Number.isInteger(item))) throw new Error("Sequence node requires integer values");
  return [...new Set(values)].sort((left, right) => left - right);
}

export function executeSequenceNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, _context: ExecutionContext): NodeOutput | null {
  if (!SUPPORTED.has(nodeType)) return null;
  let result: unknown;
  if (nodeType === "sequence.map_expression") {
    const values = numericSequence(upstream);
    const expression = String(params.expression ?? "value").trim() || "value";
    result = values.map((value, iteration) => logicExpression(expression, value, iteration));
  } else if (nodeType === "sequence.reduce") {
    const values = numericSequence(upstream);
    const method = String(params.method ?? "sum");
    if (method === "count") result = values.length;
    else {
      if (!values.length) throw new Error(`Reduce method ${method} requires at least one value`);
      if (method === "sum") result = values.reduce((total, value) => total + value, 0);
      else if (method === "mean") result = values.reduce((total, value) => total + value, 0) / values.length;
      else if (method === "min") result = Math.min(...values);
      else if (method === "max") result = Math.max(...values);
      else if (method === "product") result = values.reduce((total, value) => total * value, 1);
      else throw new Error(`Unsupported reduce method: ${method}`);
    }
  } else if (nodeType === "sequence.accumulate") {
    const values = numericSequence(upstream);
    const method = String(params.method ?? "sum");
    const accumulated: number[] = [];
    let current: number | undefined;
    for (const value of values) {
      if (current === undefined) current = value;
      else if (method === "sum") current += value;
      else if (method === "product") current *= value;
      else if (method === "min") current = Math.min(current, value);
      else if (method === "max") current = Math.max(current, value);
      else throw new Error(`Unsupported accumulate method: ${method}`);
      accumulated.push(current);
    }
    result = accumulated;
  } else {
    const values = integerSequence(upstream);
    if (nodeType === "sequence.consecutive_segments") {
      const segments: Array<[number, number, number]> = [];
      if (values.length) {
        let start = values[0];
        let end = values[0];
        for (const value of values.slice(1)) {
          if (value === end + 1) end = value;
          else {
            segments.push([start, end, end - start + 1]);
            start = end = value;
          }
        }
        segments.push([start, end, end - start + 1]);
      }
      result = segments;
    } else {
      const minimum = Number(params.minLength ?? 3);
      if (!Number.isInteger(minimum) || minimum < 1) throw new Error("Minimum segment length must be >= 1");
      const filtered: number[] = [];
      if (values.length) {
        let start = values[0];
        let end = values[0];
        for (const value of values.slice(1)) {
          if (value === end + 1) end = value;
          else {
            if (end - start + 1 >= minimum) for (let item = start; item <= end; item += 1) filtered.push(item);
            start = end = value;
          }
        }
        if (end - start + 1 >= minimum) for (let item = start; item <= end; item += 1) filtered.push(item);
      }
      result = filtered;
    }
  }
  return { outputs: { output: result }, tableResult: null, plotResult: null, exportResult: null };
}
