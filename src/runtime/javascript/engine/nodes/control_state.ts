import { Table, toNumber } from "../table";
import { asBool, requireTable } from "./support/common";
import { logicExpression } from "./support/control";
import { groupAggregate, groupByAggregate } from "./support/table_ops";
import type { ExecutionContext, NodeOutput } from "./support/types";

export function executeControlStateNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput | null {
  const tableResult: Table | null = null;
  const plotResult = null;
  const exportResult: string | null = null;
  const table = (): Table => requireTable(upstream, "Table input");

  switch (nodeType) {
    case "table.split_condition": {
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
    case "table.merge_rows": {
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
      const trace = new Table(["iteration", "value"], rows);
      return { outputs: { output: trace, last: current, iterations: rows.length }, tableResult: trace, plotResult, exportResult };
    }
    case "table.group_aggregate": {
      const value = groupAggregate(table(), params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "table.groupby_aggregate": {
      const value = groupByAggregate(table(), params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "variable.set":
    case "variable.set_workspace": {
      const name = String(params.name ?? "").trim();
      if (!name) throw new Error("Set variable requires a name");
      const target = nodeType === "variable.set_workspace" ? context.workspaceVariables : context.variables;
      target.set(name, upstream);
      return { outputs: { output: upstream }, tableResult: upstream instanceof Table ? upstream : null, plotResult, exportResult };
    }
    case "variable.get":
    case "variable.get_workspace": {
      const name = String(params.name ?? "").trim();
      if (!name) throw new Error("Get variable requires a name");
      const source = nodeType === "variable.get_workspace" ? context.workspaceVariables : context.variables;
      if (!source.has(name)) throw new Error(`${nodeType === "variable.get_workspace" ? "Workspace variable" : "Variable"} ${JSON.stringify(name)} is not defined`);
      const value = source.get(name);
      return { outputs: { output: value }, tableResult: value instanceof Table ? value : null, plotResult, exportResult };
    }
    default:
      return null;
  }
}
