import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Edge } from "@xyflow/react";
import { serializeWorkflow, type WorkflowNode } from "./workflow";

type NativeExecutionResponse = { result: string };

type PythonExecutorPlugin = {
  runWorkflow(options: {
    workflow: string;
    csvText: string;
  }): Promise<NativeExecutionResponse>;
};

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

const PythonExecutor = registerPlugin<PythonExecutorPlugin>("PythonExecutor");

export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: Edge[],
  csvText: string,
): Promise<ExecutionResult> {
  const workflow = JSON.stringify(serializeWorkflow("Android 验证流程", nodes, edges));

  if (!Capacitor.isNativePlatform()) {
    const lines = csvText.trim().split(/\r?\n/).slice(0, 6);
    return {
      status: "success",
      preview: {
        columns: lines[0]?.split(",").map((_, index) => String(index)) ?? [],
        rows: lines.map((line) => line.split(",")),
        totalRows: lines.length,
        totalColumns: lines[0]?.split(",").length ?? 0,
      },
      plotPngBase64: null,
      exportCsv: csvText,
    };
  }

  const response = await PythonExecutor.runWorkflow({ workflow, csvText });
  const result = JSON.parse(response.result) as ExecutionResult | ExecutionErrorResult;
  if (result.status === "error") {
    throw new WorkflowExecutionError(result.message, result.nodeId, result.nodeType);
  }
  return result;
}
