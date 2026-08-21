import { describe, expect, it } from "vitest";
import { describeFlow, describeFunction, describeGroup, describeSavedNode, resourceContractKey } from "./resource-contract";

const node = { id: "n", type: "workflow", position: { x: 0, y: 0 }, data: { label: "N", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" as const } };

describe("resource contract", () => {
  it("normalizes node/group/function/flow capabilities without conflating storage", () => {
    const saved = describeSavedNode({ id: "saved", name: "Saved", node, savedAt: "now" });
    const group = describeGroup({ id: "builtin", name: "Group", description: "", nodes: [node], edges: [], builtIn: true });
    const fn = describeFunction({ id: "fn", name: "Fn", version: 1, description: "", inputs: [], outputs: [], nodes: [node], edges: [] });
    const flow = describeFlow({ id: "flow", name: "Flow", savedAt: "", document: "{}", external: true });
    const locked = describeSavedNode({ id: "locked", name: "Locked", node, savedAt: "now", locked: true });
    expect(saved.capabilities.primaryAction).toBe("insert");
    expect(saved.capabilities.rename).toBe(true);
    expect(group.capabilities.remove).toBe(false);
    expect(fn.capabilities.primaryAction).toBe("call");
    expect(flow.capabilities.primaryAction).toBe("open");
    expect(locked.capabilities.rename).toBe(false);
    expect(locked.capabilities.remove).toBe(false);
    expect(locked.capabilities.lock).toBe(true);
    expect(resourceContractKey(saved)).toBe("saved-node:saved");
  });

  it("makes future and invalid resources non-actionable", () => {
    const future = describeSavedNode({ id: "future", name: "Future", node, savedAt: "now", compatibility: "future" });
    const invalid = describeGroup({ id: "invalid", name: "Invalid", description: "", nodes: [], edges: [], compatibility: "invalid" });
    const flow = describeFlow({ id: "future-flow", name: "Future Flow", savedAt: "now", document: "{}", compatibility: "future" });
    expect(future.capabilities).toMatchObject({ draggable: false, rename: false, remove: false, lock: false });
    expect(invalid.capabilities).toMatchObject({ draggable: false, rename: false, remove: false, lock: false });
    expect(flow.capabilities).toMatchObject({ draggable: false, rename: false, remove: false, lock: false });
  });

});
