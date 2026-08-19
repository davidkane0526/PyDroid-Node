export type ExecutionResultJson = {
  status: "success" | "error";
  preview: { columns: string[]; rows: Array<Array<string | number | boolean | null>>; totalRows: number; totalColumns: number };
  plotChart: unknown | null;
  exportCsv: string | null;
  exports: Array<{ nodeId: string; fileName: string; content: string }>;
  nodeResults: Record<string, unknown>;
  nodeTimingsMs: Record<string, number>;
  executionOrder: string[];
  nodeId?: string;
  nodeType?: string;
  message?: string;
  debugTraceback?: string | null;
};

export type WorkflowInputFile = { name: string; text?: string; base64?: string };

export type WorkflowNode = {
  id: string;
  data: {
    nodeType: string;
    parameters: Record<string, unknown>;
    groupInputs?: Array<Record<string, unknown>>;
    groupOutputs?: Array<Record<string, unknown>>;
    branch?: string;
    canvasParentId?: string;
  };
  position?: { x: number; y: number };
  parentId?: string | null;
};

export type WorkflowEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type Workflow = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
