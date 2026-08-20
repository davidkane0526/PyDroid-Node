import { compactNodeLayout } from "../workflow";
import type { WorkflowSnapshot } from "../workflow-core/model";
import type { WorkflowNode } from "../workflow";

export type EditorLayoutDirection = "horizontal" | "vertical";

export function arrangeStructureChildren(nodes: WorkflowNode[], direction: EditorLayoutDirection): WorkflowNode[] {
  const structures = new Map(nodes.filter((node) => ["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(node.data.nodeType)).map((node) => [node.id, node]));
  const totals = new Map<string, number>();
  for (const node of nodes) if (node.parentId && structures.has(node.parentId)) {
    const parent = structures.get(node.parentId)!;
    const branch = parent.data.nodeType === "logic.if_subflow" ? (node.data.branch ?? "true") : "body";
    const key = `${parent.id}:${branch}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const counters = new Map<string, number>();
  return nodes.map((node) => {
    if (structures.has(node.id)) {
      const branchCount = node.data.nodeType === "logic.if_subflow"
        ? Math.max(totals.get(`${node.id}:true`) ?? 0, totals.get(`${node.id}:false`) ?? 0)
        : totals.get(`${node.id}:body`) ?? 0;
      const rows = node.data.nodeType === "logic.if_subflow" || direction === "vertical" ? branchCount : Math.ceil(branchCount / 2);
      const height = Math.max(300, 126 + rows * 116);
      return { ...node, style: { ...node.style, width: Number(node.style?.width ?? 520), height } };
    }
    if (!node.parentId || !structures.has(node.parentId)) return node;
    const parent = structures.get(node.parentId)!;
    const branch = parent.data.nodeType === "logic.if_subflow" ? (node.data.branch ?? "true") : "body";
    const key = `${parent.id}:${branch}`;
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const position = parent.data.nodeType === "logic.if_subflow"
      ? { x: branch === "false" ? 285 : 35, y: 108 + index * 112 }
      : direction === "horizontal"
        ? { x: 42 + (index % 2) * 238, y: 108 + Math.floor(index / 2) * 116 }
        : { x: 168, y: 108 + index * 116 };
    return { ...node, position, extent: "parent" as const, expandParent: true };
  });
}

export function arrangeCanvasSnapshot(snapshot: WorkflowSnapshot, canvasId: string | null, viewportWidth: number, direction: EditorLayoutDirection): WorkflowSnapshot {
  const layer = snapshot.nodes.filter((node) => (node.data.canvasParentId ?? null) === canvasId);
  const arranged = new Map(compactNodeLayout(layer, viewportWidth, direction, snapshot.edges).map((node) => [node.id, node]));
  const nodes = arrangeStructureChildren(snapshot.nodes.map((node) => arranged.get(node.id) ?? node), direction);
  return { ...snapshot, nodes };
}
