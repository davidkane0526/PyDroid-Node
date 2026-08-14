import { describe, expect, it } from "vitest";
import { parseAgentPlan } from "./agent";

describe("AI Agent plan parser", () => {
  it("accepts a structured node plan", () => {
    expect(parseAgentPlan(JSON.stringify({
      summary: "读取并绘图",
      operations: [{ type: "add_node", id: "read_sales", nodeType: "io.read_csv" }],
    }))).toEqual({
      summary: "读取并绘图",
      operations: [{ type: "add_node", id: "read_sales", nodeType: "io.read_csv" }],
    });
  });

  it("rejects incomplete responses", () => {
    expect(() => parseAgentPlan('{"summary":"missing operations"}')).toThrow("summary 和 operations");
    expect(() => parseAgentPlan("[]")).toThrow("JSON 对象");
  });

  it("accepts structural editing and layout operations", () => {
    const plan = parseAgentPlan(JSON.stringify({
      summary: "整理并组合流程",
      operations: [
        { type: "disconnect", source: "read", target: "plot" },
        { type: "group_nodes", id: "cleaning", label: "数据清洗", nodeIds: ["read", "dropna"] },
        { type: "arrange", direction: "vertical" },
      ],
    }));
    expect(plan.operations.map((operation) => operation.type)).toEqual(["disconnect", "group_nodes", "arrange"]);
  });

  it("rejects operations outside the node-only contract", () => {
    expect(() => parseAgentPlan(JSON.stringify({
      summary: "尝试执行任意代码",
      operations: [{ type: "run_python", source: "print('unsafe')" }],
    }))).toThrow("不支持的 AI 操作");
  });
});
