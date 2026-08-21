import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkflow, parseWorkflowWithReport, WORKFLOW_SCHEMA_VERSION } from "./workflow";

const fixtureRoot = path.resolve(process.cwd(), "tests/workflow-compatibility/fixtures");
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8")) as {
  fixtures: Array<{ file: string; origin: string; schemaVersion: number; expectedCurrent: boolean }>;
};

describe("historical workflow compatibility corpus", () => {
  for (const fixture of manifest.fixtures.filter((entry) => entry.expectedCurrent)) {
    it(`migrates ${fixture.file} (${fixture.origin}) to the current schema`, () => {
      const rawText = fs.readFileSync(path.join(fixtureRoot, fixture.file), "utf8");
      const migrated = parseWorkflowWithReport(rawText);
      expect(migrated.report.schemaFromVersion).toBe(fixture.schemaVersion);
      expect(migrated.document.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
      expect(migrated.document.functions).toBeInstanceOf(Array);
      expect(migrated.document.requirements).toBeInstanceOf(Array);
      expect(migrated.document.nodes.every((node) => Number.isInteger(node.data.nodeVersion))).toBe(true);
      expect(migrated.document.functions.flatMap((fn) => fn.nodes).every((node) => Number.isInteger(node.data.nodeVersion))).toBe(true);
      const canonical = JSON.stringify(migrated.document);
      const reopened = parseWorkflowWithReport(canonical);
      expect(reopened.report.schemaSteps).toEqual([]);
      expect(reopened.report.nodeSteps).toEqual([]);
      expect(reopened.document).toEqual(migrated.document);
      expect(JSON.parse(rawText).schemaVersion).toBe(fixture.schemaVersion);
    });
  }

  it("rejects the future fixture without rewriting it", () => {
    const fixture = manifest.fixtures.find((entry) => !entry.expectedCurrent)!;
    const file = path.join(fixtureRoot, fixture.file);
    const before = fs.readFileSync(file, "utf8");
    expect(() => parseWorkflow(before)).toThrow(/高于当前支持/);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});
