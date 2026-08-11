import { describe, expect, it } from "vitest";
import { parseWorkflow, serializeWorkflow, WORKFLOW_SCHEMA_VERSION } from "./workflow";

describe("serializeWorkflow", () => {
  it("uses the current schema version", () => {
    const workflow = serializeWorkflow("test", [], []);
    expect(workflow.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
    expect(workflow.name).toBe("test");
  });

  it("round-trips a valid workflow", () => {
    const workflow = serializeWorkflow("valid", [], []);
    expect(parseWorkflow(JSON.stringify(workflow))).toEqual(workflow);
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseWorkflow('{"schemaVersion":99,"name":"x","nodes":[],"edges":[]}')).toThrow(
      "不支持的工作流版本",
    );
  });
});
