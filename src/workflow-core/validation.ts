import type { WorkflowDocument } from "../workflow";

export function validateWorkflowDocument(document: Record<string, unknown>): asserts document is WorkflowDocument {
  if (typeof document.name !== "string" || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new Error("工作流缺少name、nodes或edges");
  }
  if (document.requirements !== undefined && (!Array.isArray(document.requirements) || document.requirements.some((item) => typeof item !== "string"))) {
    throw new Error("工作流 requirements 必须是字符串数组");
  }
  const ids = new Set<string>();
  for (const raw of document.nodes) {
    if (!raw || typeof raw !== "object") throw new Error("工作流包含无效节点");
    const node = raw as { id?: unknown; data?: { nodeType?: unknown } };
    if (typeof node.id !== "string" || !node.data || typeof node.data.nodeType !== "string") throw new Error("工作流包含无效节点");
    if (ids.has(node.id)) throw new Error(`节点ID重复：${node.id}`);
    ids.add(node.id);
  }
  for (const raw of document.edges) {
    if (!raw || typeof raw !== "object") throw new Error("工作流包含无效连线");
    const edge = raw as { source?: unknown; target?: unknown };
    if (typeof edge.source !== "string" || typeof edge.target !== "string" || !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error("工作流连线引用了不存在的节点");
    }
  }
}
