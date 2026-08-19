// JavaScript workflow engine compatibility façade.
// Phase 6 keeps public imports stable while workflow orchestration lives in ./workflow/*.
export { executeWorkflowJson } from "./workflow/execute";
export { environmentInfoJson, previewOf, tableFromAny } from "./workflow/result";
export { orderedNodes } from "./workflow/graph";
export type { ExecutionResultJson } from "./workflow/types";
