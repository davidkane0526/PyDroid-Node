export type { NodeOutput, ExecutionContext } from "./nodes/support/types";
import type { ExecutionContext, NodeOutput } from "./nodes/support/types";
import { executeIoGenerateNode } from "./nodes/io_generate";
import { executeTableCollectionsNode } from "./nodes/table_collections";
import { executeTablePandasNode } from "./nodes/table_pandas";
import { executeControlStateNode } from "./nodes/control_state";
import { executeAnalysisPulseNode } from "./nodes/analysis_pulse";
import { executePlotsNode } from "./nodes/plots";
import { executeConversionUiNode } from "./nodes/conversion_ui";
import { executeSequenceNode } from "./nodes/sequence";
export { terMatrix } from "./nodes/support/analysis";

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
  for (const handler of DOMAIN_HANDLERS) {
    const result = handler(nodeType, params, upstream, context);
    if (result) return result;
  }
  throw new Error(`Unsupported node type: ${nodeType}`);
}
