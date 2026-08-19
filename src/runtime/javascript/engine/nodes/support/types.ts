import type { Table } from "../../table";
import type { PlotChart } from "../../plots";
export type NodeOutput = {
  outputs: Record<string, unknown>;
  tableResult: Table | null;
  plotResult: PlotChart | null;
  exportResult: string | null;
};

export type ExecutionContext = {
  csvText: string;
  inputFiles: Array<{ name: string; text?: string; base64?: string }>;
  notebookNamespace: Record<string, unknown>;
  variables: Map<string, unknown>;
  alertResponse?: unknown;
  inputDialogValue?: unknown;
};
