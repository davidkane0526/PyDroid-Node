import { registerWorkflowMigration } from "./migrations";

export const CURRENT_WORKFLOW_SCHEMA_VERSION = 3;

let registered = false;

export function ensureBuiltInWorkflowMigrationsRegistered(): void {
  if (registered) return;
  registerWorkflowMigration(1, (document) => ({
    ...document,
    schemaVersion: 2,
    functions: Array.isArray(document.functions) ? document.functions : [],
  }));
  registerWorkflowMigration(2, (document) => ({
    ...document,
    schemaVersion: 3,
    functions: Array.isArray(document.functions) ? document.functions : [],
    requirements: Array.isArray(document.requirements) ? document.requirements : [],
  }));
  registered = true;
}
