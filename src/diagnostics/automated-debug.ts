import type { Edge } from "@xyflow/react";
import type { ExecutionResult, RuntimeId } from "../runtime";
import { clearWorkspaceVariableState, getWorkspaceVariableState, listWorkspaceVariableNames } from "../execution-workspace";
import type { WorkflowFunctionDefinition, WorkflowNode } from "../workflow";
import { createFunctionCallNode } from "../workflow-functions";
import { EditorSessionStore, resolveGesturePolicy } from "../editor-core";
import { emptyWorkflowSnapshot } from "../workflow-core";

export const AUTOMATED_DIAGNOSTICS_SCHEMA_VERSION = 1;

export type DiagnosticCase = {
  id: string;
  label: string;
  runtime?: RuntimeId;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  details: Record<string, unknown>;
  error?: string;
};

export type AutomatedDiagnosticReport = {
  kind: "pydroid-flow.automated-diagnostics";
  schemaVersion: 1;
  appVersion: string;
  createdAt: string;
  platform: {
    id: string;
    native: boolean;
    remote: boolean;
    userAgent: string;
    viewport: { width: number; height: number; devicePixelRatio: number };
  };
  activeWorkspace: {
    id: string;
    variableNames: string[];
    functionCount: number;
    nodeCount: number;
    edgeCount: number;
  };
  summary: { passed: number; failed: number; skipped: number; total: number };
  cases: DiagnosticCase[];
};

export type AutomatedDiagnosticsDependencies = {
  appVersion: string;
  platformId: string;
  native: boolean;
  remote: boolean;
  activeWorkspaceId: string;
  activeVariableNames: string[];
  activeFunctions: WorkflowFunctionDefinition[];
  activeNodeCount: number;
  activeEdgeCount: number;
  executeWithRuntime: (
    runtimeId: RuntimeId,
    nodes: WorkflowNode[],
    edges: Edge[],
    csvText: string,
    options: { workspaceId: string; workspaceLabel: string; functions?: WorkflowFunctionDefinition[] },
  ) => Promise<ExecutionResult>;
};

const node = (id: string, nodeType: string, parameters: Record<string, string | number | boolean | null> = {}, label = nodeType): WorkflowNode => ({
  id,
  type: "workflow",
  position: { x: 0, y: 0 },
  data: { label, nodeType, nodeVersion: 1, parameters, status: "idle" },
});

const absoluteFunction = (): WorkflowFunctionDefinition => ({
  id: "diagnostic-absolute",
  name: "诊断绝对值函数",
  version: 1,
  description: "Automated diagnostics fixture",
  inputs: [{ id: "table", label: "表格", valueType: "table", internalNodeId: "abs", internalHandle: "input" }],
  outputs: [{ id: "result", label: "结果", valueType: "table", internalNodeId: "abs", internalHandle: "output" }],
  nodes: [node("abs", "table.absolute", {}, "绝对值")],
  edges: [],
});

async function runCase(id: string, label: string, runtime: RuntimeId | undefined, action: () => Promise<Record<string, unknown>>): Promise<DiagnosticCase> {
  const started = performance.now();
  try {
    const details = await action();
    return { id, label, runtime, status: "pass", durationMs: Math.round((performance.now() - started) * 100) / 100, details };
  } catch (error) {
    return { id, label, runtime, status: "fail", durationMs: Math.round((performance.now() - started) * 100) / 100, details: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

async function workspacePersistenceCase(runtime: RuntimeId, deps: AutomatedDiagnosticsDependencies): Promise<DiagnosticCase> {
  const workspaceId = `diagnostic-${runtime}-${Date.now().toString(36)}`;
  clearWorkspaceVariableState(workspaceId);
  return runCase(`workspace-persistence-${runtime}`, `工作区变量写入 → 跨运行读取（${runtime}）`, runtime, async () => {
    try {
      const writeNodes = [
        node("source", "generate.random_table", { count: 3, distribution: "uniform", min: -1, max: 1, mean: 0, std: 1, seed: 8, indexColumn: "index", valueColumn: "value" }, "诊断数据"),
        node("len", "python.len", {}, "计算长度"),
        node("set", "variable.set_workspace", { name: "phase8_rows" }, "写入 phase8_rows"),
      ];
      const writeEdges: Edge[] = [
        { id: "write-1", source: "source", target: "len", sourceHandle: "output", targetHandle: "input" },
        { id: "write-2", source: "len", target: "set", sourceHandle: "output", targetHandle: "input" },
      ];
      const written = await deps.executeWithRuntime(runtime, writeNodes, writeEdges, "", { workspaceId, workspaceLabel: `自动诊断 ${runtime}` });
      const storedAfterWrite = getWorkspaceVariableState(workspaceId);
      if (storedAfterWrite.phase8_rows !== 3) throw new Error(`写入后 phase8_rows=${JSON.stringify(storedAfterWrite.phase8_rows)}，预期 3`);
      if (!listWorkspaceVariableNames(workspaceId).includes("phase8_rows")) throw new Error("资源状态中没有 phase8_rows");

      const readNodes = [
        node("get", "variable.get_workspace", { name: "phase8_rows" }, "读取 phase8_rows"),
        node("print", "python.print", { prefix: "phase8_rows = ", format: "pretty", includeType: false, maxRows: 20, maxChars: 4000, encoding: "utf-8", encodingErrors: "replace", bytesFormat: "decode", end: "\\n" }, "打印结果"),
      ];
      const readEdges: Edge[] = [{ id: "read-1", source: "get", target: "print", sourceHandle: "output", targetHandle: "input" }];
      const read = await deps.executeWithRuntime(runtime, readNodes, readEdges, "", { workspaceId, workspaceLabel: `自动诊断 ${runtime}` });
      const finalState = getWorkspaceVariableState(workspaceId);
      if (finalState.phase8_rows !== 3) throw new Error("第二次运行没有保留 phase8_rows");
      return {
        writeRuntime: written.runtimeId ?? runtime,
        readRuntime: read.runtimeId ?? runtime,
        workspaceState: finalState,
        variableNames: listWorkspaceVariableNames(workspaceId),
        executionOrder: read.executionOrder ?? [],
        printResult: read.nodeResults.print ?? null,
      };
    } finally {
      clearWorkspaceVariableState(workspaceId);
    }
  });
}

async function reusableFunctionCase(runtime: RuntimeId, deps: AutomatedDiagnosticsDependencies): Promise<DiagnosticCase> {
  const workspaceId = `diagnostic-function-${runtime}-${Date.now().toString(36)}`;
  const definition = absoluteFunction();
  const call = createFunctionCallNode(definition, { x: 0, y: 0 });
  return runCase(`reusable-function-${runtime}`, `可复用函数签名、端口与执行（${runtime}）`, runtime, async () => {
    if (call.data.functionInputs?.[0]?.id !== "table" || call.data.functionOutputs?.[0]?.id !== "result") {
      throw new Error("function.call 没有从函数签名生成输入/输出端口");
    }
    const source = node("source", "generate.random_table", { count: 4, distribution: "uniform", min: -9, max: -1, mean: 0, std: 1, seed: 18, indexColumn: "index", valueColumn: "value" }, "负值表");
    const nodes = [source, call];
    const edges: Edge[] = [{ id: "function-edge", source: "source", target: call.id, sourceHandle: "output", targetHandle: "table" }];
    const result = await deps.executeWithRuntime(runtime, nodes, edges, "", { workspaceId, workspaceLabel: `函数自动诊断 ${runtime}`, functions: [definition] });
    const valueColumn = result.preview.columns.indexOf("value");
    if (valueColumn < 0) throw new Error(`函数结果缺少 value 列：${result.preview.columns.join(", ")}`);
    const numeric = result.preview.rows.map((row) => Number(row[valueColumn]));
    if (!numeric.length || numeric.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`绝对值函数输出异常：${JSON.stringify(numeric)}`);
    return {
      functionId: definition.id,
      functionVersion: definition.version,
      inputPorts: call.data.functionInputs,
      outputPorts: call.data.functionOutputs,
      preview: result.preview,
      executionOrder: result.executionOrder ?? [],
    };
  });
}


async function editorSessionIsolationCase(): Promise<DiagnosticCase> {
  return runCase("editor-session-isolation", "Editor Session 多标签状态隔离", undefined, async () => {
    const store = new EditorSessionStore("diagnostic-a", emptyWorkflowSnapshot());
    const a = store.get("diagnostic-a")!;
    const b = store.ensure("diagnostic-b", emptyWorkflowSnapshot());
    const aRuntime = a.getRuntimeState();
    a.replaceRuntimeState({
      ...aRuntime,
      snapshot: { ...aRuntime.snapshot, nodes: [node("node-a", "python.print", {}, "Session A")], requirements: ["phase9-a"] },
      input: { fileName: "phase9-a.csv", csvText: "value\n1", csvBytes: null, csvFiles: [] },
    });
    a.patchViewState({ primaryNodeId: "node-a", selectedNodeIds: ["node-a"], selectionMode: true, currentCanvasId: "group-a" });
    b.patchViewState({ primaryNodeId: "node-b", selectedNodeIds: ["node-b"] });
    a.history.push(emptyWorkflowSnapshot());
    if (!a.isDirty() || b.isDirty()) throw new Error("标签 dirty 状态发生串扰");
    if (b.getRuntimeState().snapshot.nodes.length || b.getRuntimeState().snapshot.requirements?.includes("phase9-a")) throw new Error("标签图状态发生串扰");
    if (b.getRuntimeState().input?.fileName) throw new Error("标签输入文件状态发生串扰");
    if (!a.history.canUndo || b.history.canUndo) throw new Error("标签历史记录发生串扰");
    if (a.getViewState().primaryNodeId !== "node-a" || b.getViewState().primaryNodeId !== "node-b") throw new Error("标签选择状态没有独立保存");
    return {
      workspaceA: { dirty: a.isDirty(), view: a.getViewState(), nodeCount: a.getRuntimeState().snapshot.nodes.length, inputFile: a.getRuntimeState().input?.fileName ?? null, historyCanUndo: a.history.canUndo },
      workspaceB: { dirty: b.isDirty(), view: b.getViewState(), nodeCount: b.getRuntimeState().snapshot.nodes.length, inputFile: b.getRuntimeState().input?.fileName ?? null, historyCanUndo: b.history.canUndo },
    };
  });
}

async function gestureContractCase(): Promise<DiagnosticCase> {
  return runCase("editor-gesture-contract", "桌面/移动端 × 节点/组合手势契约", undefined, async () => {
    const desktopNode = resolveGesturePolicy("desktop", "node");
    const desktopGroup = resolveGesturePolicy("desktop", "group");
    const mobileNode = resolveGesturePolicy("mobile", "node");
    const mobileGroup = resolveGesturePolicy("mobile", "group");
    const mobileCanvas = resolveGesturePolicy("mobile", "canvas");
    if (desktopNode.doubleTap === desktopGroup.doubleTap) throw new Error("桌面节点与组合双击行为未区分");
    if (mobileNode.doubleTap === mobileGroup.doubleTap) throw new Error("移动端节点与组合双击行为未区分");
    if (desktopNode.longPress === mobileNode.longPress) throw new Error("桌面端与移动端节点手势未区分");
    if (mobileCanvas.longPress !== "marquee-select" || mobileCanvas.drag !== "pan-canvas") throw new Error("移动端画布长按/拖动契约异常");
    return { desktop: { node: desktopNode, group: desktopGroup }, mobile: { node: mobileNode, group: mobileGroup, canvas: mobileCanvas } };
  });
}

export async function runAutomatedDiagnostics(deps: AutomatedDiagnosticsDependencies): Promise<AutomatedDiagnosticReport> {
  const cases: DiagnosticCase[] = [];
  cases.push(await editorSessionIsolationCase());
  cases.push(await gestureContractCase());
  cases.push(await workspacePersistenceCase("javascript", deps));
  cases.push(await reusableFunctionCase("javascript", deps));

  // A local plain browser has no Python host. Desktop, Android and paired Remote Web do.
  if (deps.platformId === "browser" && !deps.remote) {
    cases.push({ id: "workspace-persistence-python", label: "工作区变量写入 → 跨运行读取（python）", runtime: "python", status: "skip", durationMs: 0, details: { reason: "本地浏览器没有 Python 宿主" } });
    cases.push({ id: "reusable-function-python", label: "可复用函数签名、端口与执行（python）", runtime: "python", status: "skip", durationMs: 0, details: { reason: "本地浏览器没有 Python 宿主" } });
  } else {
    cases.push(await workspacePersistenceCase("python", deps));
    cases.push(await reusableFunctionCase("python", deps));
  }

  const passed = cases.filter((item) => item.status === "pass").length;
  const failed = cases.filter((item) => item.status === "fail").length;
  const skipped = cases.filter((item) => item.status === "skip").length;
  return {
    kind: "pydroid-flow.automated-diagnostics",
    schemaVersion: AUTOMATED_DIAGNOSTICS_SCHEMA_VERSION,
    appVersion: deps.appVersion,
    createdAt: new Date().toISOString(),
    platform: {
      id: deps.platformId,
      native: deps.native,
      remote: deps.remote,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
    },
    activeWorkspace: {
      id: deps.activeWorkspaceId,
      variableNames: [...deps.activeVariableNames],
      functionCount: deps.activeFunctions.length,
      nodeCount: deps.activeNodeCount,
      edgeCount: deps.activeEdgeCount,
    },
    summary: { passed, failed, skipped, total: cases.length },
    cases,
  };
}
