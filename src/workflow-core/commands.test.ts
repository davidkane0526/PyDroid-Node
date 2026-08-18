import { describe, expect, it } from "vitest";
import { upstreamSubgraph } from "./commands";
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
