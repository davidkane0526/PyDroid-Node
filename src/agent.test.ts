import { describe, expect, it } from "vitest";
import { AGENT_SELF_CHALLENGES, agentPlanningDiagnostic, buildAgentPlanningContext, parseAgentPlan, presetById, validateAgentPlan, type AgentCatalogEntry } from "./agent";
import { NODE_CATALOG } from "./nodeCatalog";

const catalog: AgentCatalogEntry[] = NODE_CATALOG.map((spec) => ({
  nodeType: spec.nodeType,
  label: spec.label,
  description: spec.description,
  parameters: spec.parameters.map((parameter) => ({ key: parameter.key, kind: parameter.kind, required: parameter.required })),
  inputPorts: spec.inputPorts.map((port) => ({ id: port.id, valueType: port.valueType })),
  outputPorts: spec.outputPorts.map((port) => ({ id: port.id, valueType: port.valueType })),
}));

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

  it("rejects operations outside the workflow contract", () => {
    expect(() => parseAgentPlan(JSON.stringify({
      summary: "尝试执行任意代码",
      operations: [{ type: "run_python", source: "print('unsafe')" }],
    }))).toThrow("不支持的 AI 操作");
  });

  it("uses the official DeepSeek V4 Chat Completions preset", () => {
    const preset = presetById("deepseek");
    expect(preset.provider).toBe("openai-compatible");
    expect(preset.endpoint).toBe("https://api.deepseek.com/chat/completions");
    expect(preset.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
  });
});

describe("AI Agent capability planning", () => {
  it("detects the native random-generator gap instead of confusing it with pandas.sample", () => {
    const diagnostic = agentPlanningDiagnostic(AGENT_SELF_CHALLENGES[0]);
    expect(diagnostic.likelyGap).toContain("随机数生成节点");
    expect(diagnostic.codeFallbackAvailable).toBe(true);
  });

  it("enriches the planning prompt with exact defaults/options and the constrained fallback", () => {
    const context = buildAgentPlanningContext(AGENT_SELF_CHALLENGES[0], catalog);
    const detailed = context.detailed as AgentCatalogEntry[];
    expect(detailed.some((entry) => entry.nodeType === "custom.python_function")).toBe(true);
    expect(detailed.some((entry) => entry.nodeType === "plot.line")).toBe(true);
    const line = detailed.find((entry) => entry.nodeType === "plot.line");
    expect(line?.parameters.length).toBeGreaterThan(0);
    expect(line?.parameters.some((parameter) => parameter.defaultValue !== undefined)).toBe(true);
  });

  it("accepts a safe random-series fallback connected to a native plot", () => {
    const plan = parseAgentPlan(JSON.stringify({
      summary: "生成可复现随机序列并绘图",
      operations: [
        {
          type: "add_node",
          id: "random_series",
          nodeType: "custom.python_function",
          parameters: {
            code: "def make_random(count: int = 100, seed: int = 0) -> 'table':\n    import random, pandas as pd\n    rng = random.Random(seed)\n    return pd.DataFrame({'x': range(count), 'random': [rng.random() for _ in range(count)]})",
          },
        },
        { type: "add_node", id: "random_plot", nodeType: "plot.line", parameters: { xColumn: "x", yColumns: "random" } },
        { type: "connect", source: "random_series", target: "random_plot" },
        { type: "arrange", direction: "vertical" },
      ],
    }));
    expect(validateAgentPlan(plan, { nodes: [] })).toEqual([]);
  });

  it("catches hallucinated parameters and ports before the plan reaches the canvas", () => {
    const plan = parseAgentPlan(JSON.stringify({
      summary: "错误计划",
      operations: [
        { type: "add_node", id: "plot", nodeType: "plot.line", parameters: { inventedParameter: 1 } },
        { type: "add_node", id: "read", nodeType: "io.read_csv" },
        { type: "connect", source: "read", target: "plot", sourceHandle: "not-a-port" },
      ],
    }));
    const errors = validateAgentPlan(plan, { nodes: [] });
    expect(errors.some((error) => error.includes("inventedParameter"))).toBe(true);
    expect(errors.some((error) => error.includes("not-a-port"))).toBe(true);
  });
});
