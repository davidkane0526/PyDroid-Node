import { describe, expect, it } from "vitest";
import { migrateWorkflowDocument, normalizeWorkflowNodeVersions, registerWorkflowMigration } from "./migrations";

describe("workflow migrations", () => {
  it("rejects a workflow newer than the application", () => {
    expect(() => migrateWorkflowDocument({ schemaVersion: 3 }, 2)).toThrow(/不支持的工作流版本/);
  });

  it("runs registered migrations sequentially", () => {
    registerWorkflowMigration(40, (doc) => ({ ...doc, schemaVersion: 41, migrated: true }));
    expect(migrateWorkflowDocument({ schemaVersion: 40 }, 41)).toMatchObject({ schemaVersion: 41, migrated: true });
  });

  it("defaults missing node versions to one", () => {
    const migrated = normalizeWorkflowNodeVersions({ schemaVersion: 1, nodes: [{ id: "n", data: { nodeType: "python.print" } }] });
    expect(((migrated.nodes as Array<{ data: { nodeVersion: number } }>)[0].data.nodeVersion)).toBe(1);
  });
});
