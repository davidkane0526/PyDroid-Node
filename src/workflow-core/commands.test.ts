import { describe, expect, it } from "vitest";
import { deleteNodesFromGraph, disconnectEdgesFromGraph, disconnectNodesFromGraph, upstreamSubgraph } from "./commands";
import type { WorkflowNode } from "../workflow";

const node = (id: string): WorkflowNode => ({ id, position: { x: 0, y: 0 }, data: { label: id, nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" } });

describe("upstreamSubgraph", () => {
  it("keeps only target ancestors and their connecting edges", () => {
    const nodes = [node("a"), node("b"), node("c"), node("unrelated")];
    const edges = [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
    ];
    const slice = upstreamSubgraph(nodes, edges, ["c"]);
    expect(slice.nodes.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(slice.edges.map((item) => item.id)).toEqual(["ab", "bc"]);
  });
});


it("deletes nested child nodes and their incident edges as one graph command", () => {
  const nodes = [
    node("group"),
    { ...node("child"), parentId: "group", data: { ...node("child").data, canvasParentId: "group" } },
    node("outside"),
  ];
  const edges = [
    { id: "inner", source: "group", target: "child" },
    { id: "out", source: "child", target: "outside" },
  ];
  const next = deleteNodesFromGraph(nodes, edges, ["group"]);
  expect([...next.removedIds].sort()).toEqual(["child", "group"]);
  expect(next.nodes.map((item) => item.id)).toEqual(["outside"]);
  expect(next.edges).toEqual([]);
});

it("disconnects graph edges by node or explicit edge id", () => {
  const edges = [
    { id: "a", source: "one", target: "two" },
    { id: "b", source: "two", target: "three" },
    { id: "c", source: "three", target: "four" },
  ];
  expect(disconnectNodesFromGraph(edges, ["two"]).map((edge) => edge.id)).toEqual(["c"]);
  expect(disconnectEdgesFromGraph(edges, ["b"]).map((edge) => edge.id)).toEqual(["a", "c"]);
});
