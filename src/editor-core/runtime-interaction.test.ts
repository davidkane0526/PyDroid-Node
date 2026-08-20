import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "../workflow";
import { applyRuntimeNodeParameterOverride } from "./runtime-interaction";

const node = (id: string, value: string): WorkflowNode => ({
  id,
  type: "workflow",
  position: { x: 0, y: 0 },
  data: { label: id, nodeType: "ui.input_dialog", nodeVersion: 1, parameters: { value }, status: "idle" },
});

describe("runtime interaction overrides", () => {
  it("creates execution-only parameter overrides without mutating editor nodes", () => {
    const original = [node("input", "default"), node("other", "keep")];
    const next = applyRuntimeNodeParameterOverride(original, "input", { value: "runtime" });
    expect(next).not.toBe(original);
    expect(next[0]?.data.parameters.value).toBe("runtime");
    expect(original[0]?.data.parameters.value).toBe("default");
    expect(next[1]).toBe(original[1]);
  });

  it("returns the original array when the runtime node no longer exists", () => {
    const original = [node("input", "default")];
    expect(applyRuntimeNodeParameterOverride(original, "missing", { value: "runtime" })).toBe(original);
  });
});
