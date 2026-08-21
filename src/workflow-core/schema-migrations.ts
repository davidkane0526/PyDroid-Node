import { registerWorkflowMigration } from "./migrations";

export const CURRENT_WORKFLOW_SCHEMA_VERSION = 4;

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
  registerWorkflowMigration(3, (document) => ({
    ...document,
    schemaVersion: 4,
    environment: document.environment && typeof document.environment === "object" && !Array.isArray(document.environment)
      ? document.environment
      : { pythonImports: [], pythonDefinitions: [] },
    parameters: Array.isArray(document.parameters) ? document.parameters : [],
  }));
  registered = true;
}
