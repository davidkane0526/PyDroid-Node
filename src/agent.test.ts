import { describe, expect, it } from "vitest";
import { AGENT_SELF_CHALLENGES, DEFAULT_AGENT_SETTINGS, agentPlanningDiagnostic, buildAgentPlanningContext, parseAgentPlan, presetById, testAgentConnection, validateAgentPlan, type AgentCatalogEntry } from "./agent";
import { NODE_CATALOG } from "./nodeCatalog";

const catalog: AgentCatalogEntry[] = NODE_CATALOG.map((spec) => ({
  nodeType: spec.nodeType,
  label: spec.label,
  description: spec.description,
  parameters: spec.parameters.map((parameter) => ({ key: parameter.key, kind: parameter.kind, required: parameter.required })),
  inputPorts: spec.inputPorts.map((port) => ({ id: port.id, valueType: port.valueType, required: port.required })),
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


  it("supports a host Agent transport without exposing an API key to the browser", async () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, endpoint: "https://host.invalid/v1/responses", model: "host-model" };
    let calls = 0;
    const result = await testAgentConnection(settings, "", async (_settings, body) => {
      calls += 1;
      expect(body).toMatchObject({ model: "host-model" });
      return { model: "host-proxy-model" };
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ ok: true, message: "连接成功：host-proxy-model" });
  });

  it("uses DeepSeek Chat Completions and Anthropic-compatible presets", () => {
    const chatPreset = presetById("deepseek");
    expect(chatPreset.provider).toBe("openai-compatible");
    expect(chatPreset.endpoint).toBe("https://api.deepseek.com/chat/completions");
    expect(chatPreset.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);

    const anthropicPreset = presetById("deepseek-anthropic");
    expect(anthropicPreset.provider).toBe("anthropic-messages");
    expect(anthropicPreset.endpoint).toBe("https://api.deepseek.com/anthropic/v1/messages");
  });
});

describe("AI Agent capability planning", () => {
  it("recognizes the native no-input random generator", () => {
    const diagnostic = agentPlanningDiagnostic(AGENT_SELF_CHALLENGES[0]);
    expect(diagnostic.likelyGap).toBeNull();
    expect(diagnostic.nativeMatches).toContain("generate.random_table");
    expect(diagnostic.codeFallbackAvailable).toBe(true);
  });

  it("enriches the planning prompt with native sources, exact ports/defaults and constrained fallback", () => {
    const context = buildAgentPlanningContext(AGENT_SELF_CHALLENGES[0], catalog);
    const detailed = context.detailed as AgentCatalogEntry[];
    expect(detailed.some((entry) => entry.nodeType === "generate.random_table")).toBe(true);
    expect(detailed.some((entry) => entry.nodeType === "generate.empty_table")).toBe(true);
    expect(detailed.some((entry) => entry.nodeType === "generate.empty_list")).toBe(true);
    expect(detailed.some((entry) => entry.nodeType === "custom.python_function")).toBe(true);
    expect(detailed.some((entry) => entry.nodeType === "plot.line")).toBe(true);
    const line = detailed.find((entry) => entry.nodeType === "plot.line");
    expect(line?.parameters.length).toBeGreaterThan(0);
    expect(line?.parameters.some((parameter) => parameter.defaultValue !== undefined)).toBe(true);
  });

  it("accepts native random source connected directly to print", () => {
    const plan = parseAgentPlan(JSON.stringify({
      summary: "生成可复现随机数并打印",
      operations: [
        { type: "add_node", id: "random", nodeType: "generate.random_table", parameters: { count: 10, seed: 2024 } },
        { type: "add_node", id: "print", nodeType: "python.print" },
        { type: "connect", source: "random", target: "print", sourceHandle: "output", targetHandle: "input" },
        { type: "arrange", direction: "horizontal" },
      ],
    }));
    expect(validateAgentPlan(plan, { nodes: [], edges: [] })).toEqual([]);
  });

  it("rejects the previously observed random/print plan when required inputs have no connections", () => {
    const plan = parseAgentPlan(JSON.stringify({
      summary: "错误的随机数打印计划",
      operations: [
        {
          type: "add_node",
          id: "gen_rand",
          nodeType: "custom.python_function",
          parameters: {
            code: "def transform(table: 'table') -> 'table':\n    import numpy as np\n    return np.random.default_rng(2024).uniform(0, 100, size=10)",
          },
        },
        { type: "add_node", id: "print_rand", nodeType: "python.print" },
      ],
    }));
    const errors = validateAgentPlan(plan, { nodes: [], edges: [] });
    expect(errors.some((error) => error.includes("gen_rand") && error.includes("table") && error.includes("没有连线"))).toBe(true);
    expect(errors.some((error) => error.includes("print_rand") && error.includes("input") && error.includes("没有连线"))).toBe(true);
  });

  it("rejects Python custom-function fallback for a JavaScript workflow", () => {
    const plan = parseAgentPlan(JSON.stringify({
      summary: "JS 后端错误回退",
      operations: [
        {
          type: "add_node",
          id: "custom",
          nodeType: "custom.python_function",
          parameters: { code: "def source() -> 'table':\n    return []" },
        },
      ],
    }));
    const errors = validateAgentPlan(plan, { nodes: [], edges: [], runtimePreference: "javascript" });
    expect(errors.some((error) => error.includes("JavaScript 后端") && error.includes("custom.python_function"))).toBe(true);
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
    const errors = validateAgentPlan(plan, { nodes: [], edges: [] });
    expect(errors.some((error) => error.includes("inventedParameter"))).toBe(true);
    expect(errors.some((error) => error.includes("not-a-port"))).toBe(true);
  });
});
