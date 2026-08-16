import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "../workflow";
import { getRuntime, registerRuntime, resolveRuntime } from "./registry";
import type { RuntimeAdapter } from "./types";

function node(nodeType: string): WorkflowNode {
  return { id: nodeType, type: "workflowNode", position: { x: 0, y: 0 }, data: { label: nodeType, nodeType, parameters: {}, status: "idle" } } as WorkflowNode;
}

const python: RuntimeAdapter = {
  descriptor: { id: "python", label: "Python", shortLabel: "Python", description: "test", capabilities: ["workflow"] },
  warmUp: async () => undefined,
  getEnvironment: async () => ({ runtimeId: "python", runtimeLabel: "Python", version: "test", packages: [] }),
  execute: async () => { throw new Error("not used"); },
};

const javascript: RuntimeAdapter = {
  descriptor: { id: "javascript", label: "JavaScript", shortLabel: "JS", description: "test", capabilities: ["workflow"] },
  warmUp: async () => undefined,
  getEnvironment: async () => ({ runtimeId: "javascript", runtimeLabel: "JavaScript", version: "test", packages: [] }),
  execute: async () => { throw new Error("not used"); },
  canExecute: (nodes) => ({ supported: nodes.every((item) => item.data.nodeType !== "python-only") }),
};

describe("runtime registry", () => {
  registerRuntime(python);
  registerRuntime(javascript);

  it("prefers JavaScript in auto mode for compatible workflows", () => {
    expect(resolveRuntime("auto", [node("io.read_csv")]).descriptor.id).toBe("javascript");
  });

  it("falls back to Python in auto mode when JavaScript cannot execute the workflow", () => {
    expect(resolveRuntime("auto", [node("python-only")]).descriptor.id).toBe("python");
  });

  it("honors an explicit runtime selection", () => {
    expect(resolveRuntime("javascript", [node("python-only")])).toBe(getRuntime("javascript"));
  });
});
