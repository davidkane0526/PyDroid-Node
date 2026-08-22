import { logicExpression } from "../nodes/support/control";
import { Table } from "../table";
import type { WorkflowNode } from "./types";

export const GENERIC_VISUAL_STRUCTURE_TYPES = new Set([
  "logic.if_value",
  "logic.for_each_value",
  "logic.while_state",
]);

function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Table) return value.rowCount > 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Set || value instanceof Map) return value.size > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function iterableItems(value: unknown): unknown[] {
  if (value instanceof Table) return Array.from({ length: value.rowCount }, (_, index) => new Table(value.columns, [value.row(index)]));
  if (Array.isArray(value)) return [...value];
  if (typeof value === "string") return [...value];
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return [...value.keys()];
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
  throw new Error("For Each structure requires a list, table, text, set, map, or object input");
}

function scalarCondition(expression: string, value: unknown, iteration: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("While State expression mode requires a finite numeric state");
  }
  return Boolean(logicExpression(expression, value, iteration));
}

export function executeGenericStructure(
  node: WorkflowNode,
  upstream: unknown,
  runContainer: (branch: "true" | "false" | "body", seed: unknown) => unknown,
  notebookNamespace: Record<string, unknown>,
): Record<string, unknown> {
  const nodeType = node.data.nodeType;
  const params = node.data.parameters;

  if (nodeType === "logic.if_value") {
    const inputs = upstream && typeof upstream === "object" && !(upstream instanceof Table) && !Array.isArray(upstream)
      ? upstream as Record<string, unknown>
      : { condition: upstream };
    const condition = inputs.condition;
    const seed = Object.prototype.hasOwnProperty.call(inputs, "input") ? inputs.input : condition;
    const selected = Boolean(params.invert ?? false) ? !truthy(condition) : truthy(condition);
    const branch = selected ? "true" : "false";
    const result = runContainer(branch, seed);
    return { done: result, true: branch === "true" ? result : null, false: branch === "false" ? result : null, output: result };
  }

  if (nodeType === "logic.for_each_value") {
    const items = iterableItems(upstream);
    const maximum = Number(params.maxIterations ?? 10000);
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100_000) throw new Error("For Each maxIterations must be between 1 and 100000");
    if (items.length > maximum) throw new Error(`For Each structure has ${items.length} items, exceeding maxIterations=${maximum}`);
    const itemVariable = String(params.itemVariable ?? "").trim();
    const indexVariable = String(params.indexVariable ?? "").trim();
    const results = items.map((item, iteration) => {
      if (itemVariable) notebookNamespace[itemVariable] = item;
      if (indexVariable) notebookNamespace[indexVariable] = iteration;
      return runContainer("body", item);
    });
    const done = results;
    return {
      done,
      last: results.length ? results[results.length - 1] : null,
      lastItem: items.length ? items[items.length - 1] : null,
      output: done,
    };
  }

  if (nodeType === "logic.while_state") {
    let current = upstream;
    const maximum = Number(params.maxIterations ?? 100);
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 10_000) throw new Error("While State maxIterations must be between 1 and 10000");
    const mode = String(params.conditionMode ?? "expression");
    const condition = String(params.condition ?? "value < 10").trim();
    const stateVariable = String(params.stateVariable ?? "").trim();
    const indexVariable = String(params.indexVariable ?? "").trim();
    let iterations = 0;
    const shouldContinue = (value: unknown, iteration: number): boolean => {
      if (mode === "truthy" || mode === "notEmpty") return truthy(value);
      if (mode === "expression") return scalarCondition(condition, value, iteration);
      throw new Error(`Unsupported While State conditionMode: ${mode}`);
    };
    for (let iteration = 0; iteration < maximum; iteration += 1) {
      if (!shouldContinue(current, iteration)) return { done: current, iterations, output: current };
      if (stateVariable) notebookNamespace[stateVariable] = current;
      if (indexVariable) notebookNamespace[indexVariable] = iteration;
      current = runContainer("body", current);
      iterations += 1;
    }
    if (shouldContinue(current, maximum)) throw new Error(`While State reached maxIterations=${maximum}`);
    return { done: current, iterations, output: current };
  }

  throw new Error(`Unsupported generic structure: ${nodeType}`);
}
