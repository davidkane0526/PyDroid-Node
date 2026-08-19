import type { Workflow, WorkflowInputFile } from "./types";

export const WORKFLOW_LIMITS = {
  nodes: 2_000,
  edges: 10_000,
  inputFiles: 500,
  inputTextChars: 64 * 1024 * 1024,
  workflowJsonChars: 16 * 1024 * 1024,
  inputFilesJsonChars: 96 * 1024 * 1024,
} as const;

export function decodeJsonCompatible(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const converted = text
      .replace(/([{,]\s*)'([^']*)'(\s*[:,\]}])/g, "$1\"$2\"$3")
      .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, "$1\"$2\":")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    try {
      return JSON.parse(converted);
    } catch {
      throw new Error(`${label} 格式错误（JSON 或 Python 字面量均无法解析）`);
    }
  }
}

export function parseWorkflowInputs(workflowJson: string, csvText: string, inputFilesJson: string): { workflow: Workflow; inputFiles: WorkflowInputFile[] } {
  if (typeof workflowJson !== "string" || workflowJson.length > WORKFLOW_LIMITS.workflowJsonChars) {
    throw new Error("Workflow document is missing or exceeds the 16 MiB safety limit");
  }
  if (typeof csvText !== "string" || csvText.length > WORKFLOW_LIMITS.inputTextChars) {
    throw new Error("CSV input exceeds the 64 MiB safety limit");
  }
  if (typeof inputFilesJson !== "string" || inputFilesJson.length > WORKFLOW_LIMITS.inputFilesJsonChars) {
    throw new Error("Multi-file input document exceeds the 96 MiB safety limit");
  }

  const workflow = decodeJsonCompatible(workflowJson, "工作流 JSON") as Workflow;
  const inputFiles = decodeJsonCompatible(inputFilesJson, "输入文件 JSON") as WorkflowInputFile[];
  if (!workflow || typeof workflow !== "object") throw new Error("Workflow must be a JSON object");
  const nodes = workflow.nodes;
  const edges = workflow.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error("Workflow nodes and edges must be JSON arrays");
  if (nodes.length > WORKFLOW_LIMITS.nodes || edges.length > WORKFLOW_LIMITS.edges) {
    throw new Error(`Workflow exceeds the safety limit of ${WORKFLOW_LIMITS.nodes} nodes or ${WORKFLOW_LIMITS.edges} edges`);
  }
  if (!Array.isArray(inputFiles)) throw new Error("inputFiles must be a JSON array");
  if (inputFiles.length > WORKFLOW_LIMITS.inputFiles) throw new Error(`Multi-file input exceeds the safety limit of ${WORKFLOW_LIMITS.inputFiles} files`);

  let totalInputChars = 0;
  for (let index = 0; index < inputFiles.length; index += 1) {
    const item = inputFiles[index];
    if (!item || typeof item.name !== "string" || (item.text !== undefined && typeof item.text !== "string") || (item.base64 !== undefined && typeof item.base64 !== "string")) {
      throw new Error(`Input file ${index + 1} must contain a name and readable content`);
    }
    totalInputChars += String(item.text ?? "").length + String(item.base64 ?? "").length;
    if (totalInputChars > WORKFLOW_LIMITS.inputTextChars) throw new Error("Combined multi-file input exceeds the 64 MiB safety limit");
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || typeof node.id !== "string" || !node.id) throw new Error(`Workflow node ${index + 1} has an invalid ID`);
    if (!node.data || typeof node.data !== "object" || typeof node.data.nodeType !== "string" || !node.data.parameters || typeof node.data.parameters !== "object") {
      throw new Error(`Workflow node ${node.id} has invalid data or parameters`);
    }
  }
  for (const edge of edges) {
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string") {
      throw new Error("Every workflow edge must be a JSON object with source and target");
    }
  }

  return { workflow, inputFiles };
}
