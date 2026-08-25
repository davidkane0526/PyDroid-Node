export type { NodeOutput, ExecutionContext } from "./nodes/support/types";
import type { ExecutionContext, NodeOutput } from "./nodes/support/types";
import { Table } from "./table";
import { executeIoGenerateNode } from "./nodes/io_generate";
import { executeTableCollectionsNode } from "./nodes/table_collections";
import { executeTablePandasNode } from "./nodes/table_pandas";
import { executeControlStateNode } from "./nodes/control_state";
import { executeAnalysisPulseNode } from "./nodes/analysis_pulse";
import { executePlotsNode } from "./nodes/plots";
import { executeConversionUiNode } from "./nodes/conversion_ui";
import { executeSequenceNode } from "./nodes/sequence";
import { getJavascriptNodeProvider } from "./providers";
export { terMatrix } from "./nodes/support/analysis";


const PARAMETER_SOCKET_EXCLUDED_TYPES = new Set(["custom.python_function"]);

function bindParameterSocketInputs(
  nodeType: string,
  params: Record<string, unknown>,
  upstream: unknown,
): { params: Record<string, unknown>; upstream: unknown } {
  if (PARAMETER_SOCKET_EXCLUDED_TYPES.has(nodeType) || !upstream || typeof upstream !== "object" || Array.isArray(upstream) || upstream instanceof Table) {
    return { params, upstream };
  }
  const inputMap = upstream as Record<string, unknown>;
  const merged = { ...params };
  const remaining: Record<string, unknown> = {};
  let bound = 0;
  for (const [port, value] of Object.entries(inputMap)) {
    if (port !== "input" && Object.prototype.hasOwnProperty.call(merged, port)) {
      merged[port] = value;
      bound += 1;
    } else {
      remaining[port] = value;
    }
  }
  if (!bound) return { params, upstream };
  const remainingPorts = Object.keys(remaining);
  if (!remainingPorts.length) return { params: merged, upstream: null };
  if (remainingPorts.length === 1 && remainingPorts[0] === "input") return { params: merged, upstream: remaining.input };
  return { params: merged, upstream: remaining };
}

const DOMAIN_HANDLERS = [
  executeIoGenerateNode,
  executeTableCollectionsNode,
  executeTablePandasNode,
  executeSequenceNode,
  executeControlStateNode,
  executeAnalysisPulseNode,
  executePlotsNode,
  executeConversionUiNode,
] as const;

export function executeNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput {
  const bound = bindParameterSocketInputs(nodeType, params, upstream);
  const provider = getJavascriptNodeProvider(nodeType);
  if (provider) return provider({ nodeType, params: bound.params, upstream: bound.upstream, context });
  for (const handler of DOMAIN_HANDLERS) {
    const result = handler(nodeType, bound.params, bound.upstream, context);
    if (result) return result;
  }
  throw new Error(`Unsupported node type: ${nodeType}`);
}
