import type { ExecutionContext, NodeOutput } from "./support/types";

function integerSequence(upstream: unknown): number[] {
  if (!Array.isArray(upstream)) throw new Error("Sequence node requires a list input");
  const values = upstream.map((item) => Number(item));
  if (values.some((item) => !Number.isInteger(item))) throw new Error("Sequence node requires integer values");
  return [...new Set(values)].sort((left, right) => left - right);
}

export function executeSequenceNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, _context: ExecutionContext): NodeOutput | null {
  if (nodeType !== "sequence.consecutive_segments" && nodeType !== "sequence.filter_short_segments") return null;
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
    return { outputs: { output: segments }, tableResult: null, plotResult: null, exportResult: null };
  }
  const minimum = Number(params.minLength ?? 3);
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error("Minimum segment length must be >= 1");
  const result: number[] = [];
  if (values.length) {
    let start = values[0];
    let end = values[0];
    for (const value of values.slice(1)) {
      if (value === end + 1) end = value;
      else {
        if (end - start + 1 >= minimum) for (let item = start; item <= end; item += 1) result.push(item);
        start = end = value;
      }
    }
    if (end - start + 1 >= minimum) for (let item = start; item <= end; item += 1) result.push(item);
  }
  return { outputs: { output: result }, tableResult: null, plotResult: null, exportResult: null };
}
