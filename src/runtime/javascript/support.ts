import { getJavascriptSupportedNodeTypes, supportsNodeRuntime } from "../../nodeContract";

export const JAVASCRIPT_SUPPORTED_NODE_TYPES = getJavascriptSupportedNodeTypes();

export function isJavascriptSupportedNodeType(nodeType: string): boolean {
  return supportsNodeRuntime(nodeType, "javascript");
}
