/**
 * Canonical analysis contract shared by the Python notebook analyzer,
 * workflow lowering and the UI import path.
 *
 * Keep this contract structural and transport-safe: analyzer responses cross
 * Android/remote JSON boundaries before the workflow compiler consumes them.
 */
export type NotebookCellOperationAnalysis = {
  index: number;
  recognized: boolean;
  reason?: string;
  nodeType?: string;
  label?: string;
  parameters?: Record<string, string | number | boolean | null>;
  inputVariable?: string | null;
  outputVariable?: string | null;
  semantic?: boolean;
  source?: string;
  kind?: string;
  defines?: string[];
  uses?: string[];
  children?: NotebookCellChildAnalysis[];
};

export type NotebookCellChildAnalysis = Omit<NotebookCellOperationAnalysis, "index"> & {
  branch: "true" | "false" | "body";
  childIndex: number;
};

export type NotebookCellAnalysis = NotebookCellOperationAnalysis & {
  operations?: NotebookCellOperationAnalysis[];
};
