import type { Edge } from "@xyflow/react";
import { serializeWorkflow, type WorkflowNode } from "../../src/workflow";

export type TablePreview = {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  totalRows: number;
  totalColumns: number;
};

export type ExecutionResult = {
  status: "success";
  preview: TablePreview;
  plotPngBase64: string | null;
  exportCsv: string | null;
};

type ExecutionErrorResult = {
  status: "error";
  nodeId: string;
  nodeType: string;
  message: string;
};

type DesktopBridge = {
  runWorkflow(payload: { workflow: string; csvText: string }): Promise<string>;
};

declare global {
  interface Window {
    pyDroidDesktop?: DesktopBridge;
  }
}

export class WorkflowExecutionError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly nodeType: string,
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
): Promise<ExecutionResult> {
  const bridge = window.pyDroidDesktop;
  if (!bridge) throw new Error("Windows desktop bridge is unavailable");

  const workflow = JSON.stringify(serializeWorkflow("Windows 桌面流程", nodes, edges));
  const response = await bridge.runWorkflow({ workflow, csvText });
  const result = JSON.parse(response) as ExecutionResult | ExecutionErrorResult;
  if (result.status === "error") {
    throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType);
  }
  return result;
}
