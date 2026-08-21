import { describe, expect, it } from "vitest";
import { WorkflowCompatibilityError, migrateWorkflowDocument, migrateWorkflowDocumentWithReport, normalizeWorkflowNodeVersions, registerWorkflowMigration } from "./migrations";

describe("workflow migrations", () => {
  it("rejects non-numeric schema versions instead of coercing them", () => {
    expect(() => migrateWorkflowDocumentWithReport({ schemaVersion: "1" }, 3)).toThrow(/不支持的工作流版本/);
    expect(() => migrateWorkflowDocumentWithReport({ schemaVersion: true }, 3)).toThrow(/不支持的工作流版本/);
  });

  it("rejects a workflow newer than the application with a typed compatibility error", () => {
    try {
      migrateWorkflowDocument({ schemaVersion: 3 }, 2);
      throw new Error("expected future schema rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowCompatibilityError);
      expect((error as WorkflowCompatibilityError).code).toBe("future-schema-version");
    }
  });

  it("runs registered migrations sequentially without mutating the source", () => {
    registerWorkflowMigration(40, (doc) => ({ ...doc, schemaVersion: 41, migrated: true }));
    registerWorkflowMigration(41, (doc) => ({ ...doc, schemaVersion: 42, second: true }));
    const source = { schemaVersion: 40, nested: { stable: true } };
    const migrated = migrateWorkflowDocumentWithReport(source, 42);
    expect(migrated.document).toMatchObject({ schemaVersion: 42, migrated: true, second: true });
    expect(migrated.steps).toEqual([{ fromVersion: 40, toVersion: 41 }, { fromVersion: 41, toVersion: 42 }]);
    expect(source).toEqual({ schemaVersion: 40, nested: { stable: true } });
  });

  it("fails closed when a schema migration step is missing or returns the wrong version", () => {
    expect(() => migrateWorkflowDocumentWithReport({ schemaVersion: 70 }, 71)).toThrow(/缺少 v70/);
    registerWorkflowMigration(80, (doc) => ({ ...doc, schemaVersion: 82 }));
    expect(() => migrateWorkflowDocumentWithReport({ schemaVersion: 80 }, 81)).toThrow(/未生成 v81/);
  });

  it("prevents historical schema migration steps from being overwritten", () => {
    registerWorkflowMigration(90, (doc) => ({ ...doc, schemaVersion: 91 }));
    expect(() => registerWorkflowMigration(90, (doc) => ({ ...doc, schemaVersion: 91, overwritten: true }))).toThrow(/already registered/);
  });

  it("defaults missing node versions to one in root and reusable-function graphs", () => {
    const migrated = normalizeWorkflowNodeVersions({
      schemaVersion: 1,
      nodes: [{ id: "n", data: { nodeType: "python.print" } }],
      functions: [{ id: "fn", nodes: [{ id: "inside", data: { nodeType: "table.absolute" } }] }],
    });
    expect(((migrated.nodes as Array<{ data: { nodeVersion: number } }>)[0].data.nodeVersion)).toBe(1);
    expect((((migrated.functions as Array<{ nodes: Array<{ data: { nodeVersion: number } }> }>)[0].nodes)[0].data.nodeVersion)).toBe(1);
  });
});
