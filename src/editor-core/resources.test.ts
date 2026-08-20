import { describe, expect, it } from "vitest";
import { captureGroupResource, captureNodeResource, instantiateGroupResource, instantiateNodeResource } from "./resources";

const simpleNode = (id: string, label = id) => ({
  id,
  position: { x: 0, y: 0 },
  data: { label, nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "success" as const },
});

describe("editor resource contracts", () => {
  it("captures a node without transient editor state", () => {
    const source = { ...simpleNode("a"), selected: true, className: "node-entering", data: { ...simpleNode("a").data, canvasParentId: "group" } };
    const captured = captureNodeResource(source);
    expect(captured.node.selected).toBe(false);
    expect(captured.node.className).toBeUndefined();
    expect(captured.node.data.canvasParentId).toBeUndefined();
    expect(captured.node.data.status).toBe("idle");
    const instance = instantiateNodeResource(captured, { id: "copy", position: { x: 10, y: 20 }, canvasId: "canvas" });
    expect(instance.primaryNodeId).toBe("copy");
    expect(instance.nodes[0].data.canvasParentId).toBe("canvas");
  });

  it("captures and remaps a group resource with stable internal references", () => {
    const childA = { ...simpleNode("a"), data: { ...simpleNode("a").data, canvasParentId: "group" } };
    const childB = { ...simpleNode("b"), data: { ...simpleNode("b").data, canvasParentId: "group" } };
    const group = {
      id: "group",
      position: { x: 10, y: 20 },
      data: { label: "Group", nodeType: "workflow.group", nodeVersion: 1, parameters: { description: "demo" }, status: "idle" as const, groupInputs: [], groupOutputs: [] },
    };
    const captured = captureGroupResource("group", [childA, childB, group], [{ id: "ab", source: "a", target: "b" }]);
    let index = 0;
    const instance = instantiateGroupResource(captured, { position: { x: 100, y: 200 }, canvasId: null, idFactory: (id) => `${id}-${index++}` });
    expect(instance.nodes).toHaveLength(3);
    expect(instance.edges).toHaveLength(1);
    expect(instance.nodes.find((node) => node.id === instance.primaryNodeId)?.data.nodeType).toBe("workflow.group");
    expect(instance.edges[0].source).not.toBe("a");
    expect(instance.edges[0].target).not.toBe("b");
  });
});
