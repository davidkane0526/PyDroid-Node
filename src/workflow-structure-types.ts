export const VISUAL_STRUCTURE_NODE_TYPES = new Set<string>([
  "logic.if_value",
  "logic.for_each_value",
  "logic.while_state",
]);

export const LOOP_STRUCTURE_NODE_TYPES = new Set<string>([
  "logic.for_each_value",
  "logic.while_state",
]);

export const IF_STRUCTURE_NODE_TYPES = new Set<string>([
  "logic.if_value",
]);

export const isVisualStructureNodeType = (nodeType: string | undefined | null): boolean =>
  typeof nodeType === "string" && VISUAL_STRUCTURE_NODE_TYPES.has(nodeType);

export const isLoopStructureNodeType = (nodeType: string | undefined | null): boolean =>
  typeof nodeType === "string" && LOOP_STRUCTURE_NODE_TYPES.has(nodeType);

export const isIfStructureNodeType = (nodeType: string | undefined | null): boolean =>
  typeof nodeType === "string" && IF_STRUCTURE_NODE_TYPES.has(nodeType);
