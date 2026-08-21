import type { Edge } from "@xyflow/react";
import type { ExecutionResult, RuntimeId } from "../runtime";
import { clearWorkspaceVariableState, getWorkspaceVariableState, listWorkspaceVariableNames, setWorkspaceVariableState } from "../execution-workspace";
import { parseWorkflowWithReport, serializeWorkflow, WORKFLOW_SCHEMA_VERSION, type WorkflowFunctionDefinition, type WorkflowNode } from "../workflow";
import { createFunctionCallNode } from "../workflow-functions";
import { EditorSessionStore } from "../editor-core/session";
import { applyRuntimeNodeParameterOverride } from "../editor-core/runtime-interaction";
import { EditorResourceLibraryService } from "../editor-core/resource-library";
import { ExecutionManager } from "../execution-controller";
import { EditorWorkspaceLifecycleService } from "../editor-core/lifecycle";
import { resolveGesturePolicy } from "../editor-core/gesture-policy";
import { createWorkspaceSessionIdentity, matchesHostExecution } from "../editor-core/workspace-identity";
import { applyAgentOperationsToSession } from "../editor-core/agent-operations";
import { describeFlow, describeFunction, describeGroup, describeSavedNode, resourceContractKey } from "../editor-core/resource-contract";
import { getNodeSpec } from "../nodeCatalog";
import { emptyWorkflowSnapshot, type StorageLike } from "../workflow-core";
import { describeRemoteSecurityPolicy } from "../remote-security-policy";
import { DEFAULT_AGENT_SETTINGS, testAgentConnection } from "../agent";

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
  executionClientId: string;
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
  testRemoteHost?: () => Promise<Record<string, unknown>>;
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
  const identity = createWorkspaceSessionIdentity(workspaceId, deps.executionClientId, deps.remote ? "remote" : "local");
  clearWorkspaceVariableState(identity);
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
      const storedAfterWrite = getWorkspaceVariableState(identity);
      if (storedAfterWrite.phase8_rows !== 3) throw new Error(`写入后 phase8_rows=${JSON.stringify(storedAfterWrite.phase8_rows)}，预期 3`);
      if (!listWorkspaceVariableNames(identity).includes("phase8_rows")) throw new Error("资源状态中没有 phase8_rows");

      const readNodes = [
        node("get", "variable.get_workspace", { name: "phase8_rows" }, "读取 phase8_rows"),
        node("print", "python.print", { prefix: "phase8_rows = ", format: "pretty", includeType: false, maxRows: 20, maxChars: 4000, encoding: "utf-8", encodingErrors: "replace", bytesFormat: "decode", end: "\\n" }, "打印结果"),
      ];
      const readEdges: Edge[] = [{ id: "read-1", source: "get", target: "print", sourceHandle: "output", targetHandle: "input" }];
      const read = await deps.executeWithRuntime(runtime, readNodes, readEdges, "", { workspaceId, workspaceLabel: `自动诊断 ${runtime}` });
      const finalState = getWorkspaceVariableState(identity);
      if (finalState.phase8_rows !== 3) throw new Error("第二次运行没有保留 phase8_rows");

      const legacy = JSON.stringify({
        schemaVersion: 1,
        name: `legacy-runtime-${runtime}`,
        nodes: [
          { id: "legacy-read", type: "workflow", position: { x: 0, y: 0 }, data: { label: "读取 CSV", nodeType: "io.read_csv", nodeVersion: 1, parameters: { separator: ",", header: "infer" }, status: "idle" } },
          { id: "legacy-abs", type: "workflow", position: { x: 260, y: 0 }, data: { label: "绝对值", nodeType: "table.absolute", nodeVersion: 1, parameters: {}, status: "idle" } },
        ],
        edges: [{ id: "legacy-edge", source: "legacy-read", target: "legacy-abs", sourceHandle: "output", targetHandle: "input" }],
      });
      const migrated = parseWorkflowWithReport(legacy);
      const migratedRun = await deps.executeWithRuntime(runtime, migrated.document.nodes, migrated.document.edges, "value\n-2\n3\n-4", {
        workspaceId: `${workspaceId}-migration`,
        workspaceLabel: `自动诊断 ${runtime}`,
        functions: migrated.document.functions,
      });
      const migratedValueIndex = migratedRun.preview.columns.indexOf("value");
      const migratedValues = migratedValueIndex < 0 ? [] : migratedRun.preview.rows.map((row) => Number(row[migratedValueIndex]));
      if (migratedValues.length !== 3 || migratedValues.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`历史工作流迁移后执行异常：${JSON.stringify(migratedValues)}`);

      return {
        writeRuntime: written.runtimeId ?? runtime,
        readRuntime: read.runtimeId ?? runtime,
        workspaceState: finalState,
        variableNames: listWorkspaceVariableNames(identity),
        executionOrder: read.executionOrder ?? [],
        printResult: read.nodeResults.print ?? null,
        compatibility: { schemaFromVersion: migrated.report.schemaFromVersion, schemaToVersion: migrated.report.schemaToVersion, values: migratedValues },
      };
    } finally {
      clearWorkspaceVariableState(identity);
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

async function editorCommandTransactionCase(): Promise<DiagnosticCase> {
  return runCase("editor-command-transaction", "Editor Command 组合/函数事务与撤销重做", undefined, async () => {
    const source = node("source", "generate.random_table", { count: 3 }, "数据");
    const absolute = node("absolute", "table.absolute", {}, "绝对值");
    source.position = { x: 40, y: 40 };
    absolute.position = { x: 280, y: 40 };
    const store = new EditorSessionStore("command", {
      nodes: [source, absolute],
      edges: [{ id: "source-absolute", source: "source", target: "absolute", sourceHandle: "output", targetHandle: "input" }],
      functions: [],
      requirements: [],
    });
    const session = store.get("command")!;
    const grouped = session.applyGraphCommand({ type: "create-group", nodeIds: ["source", "absolute"], groupId: "diagnostic-group", label: "诊断组合", canvasId: null });
    if (!grouped.changed) throw new Error(grouped.meta?.blockedReason ?? "组合命令未执行");
    if (!session.history.canUndo) throw new Error("组合命令没有原子写入 history");
    if (session.getViewState().primaryNodeId !== "diagnostic-group") throw new Error("组合命令没有同步 Session selection");
    const group = session.getRuntimeState().snapshot.nodes.find((item) => item.id === "diagnostic-group");
    if (!group || group.data.nodeType !== "workflow.group") throw new Error("组合节点未创建");
    if (!session.undo() || session.getRuntimeState().snapshot.nodes.some((item) => item.id === "diagnostic-group")) throw new Error("Session undo 未恢复组合前状态");
    if (!session.redo() || !session.getRuntimeState().snapshot.nodes.some((item) => item.id === "diagnostic-group")) throw new Error("Session redo 未恢复组合状态");
    const savedFunction = session.applyGraphCommand({ type: "save-group-as-function", groupId: "diagnostic-group" });
    const definition = savedFunction.meta?.functionDefinition;
    if (!savedFunction.changed || !definition || session.getRuntimeState().snapshot.functions?.[0]?.id !== definition.id) throw new Error("组合保存为函数事务失败");
    const insertedCall = session.applyGraphCommand({ type: "insert-function-call", definition, position: { x: 560, y: 40 }, canvasId: null });
    const callId = insertedCall.meta?.createdNodeIds?.[0];
    const callNode = callId ? session.getRuntimeState().snapshot.nodes.find((item) => item.id === callId) : undefined;
    if (!insertedCall.changed || !callNode || callNode.data.nodeType !== "function.call") throw new Error("函数调用节点事务失败");
    const blockedDelete = session.applyGraphCommand({ type: "delete-function", functionId: definition.id });
    if (blockedDelete.changed || !blockedDelete.meta?.blockedReason) throw new Error("仍有调用节点时函数删除保护失效");
    if (!session.undo() || session.getRuntimeState().snapshot.nodes.some((item) => item.id === callId)) throw new Error("函数调用事务 undo 失败");
    const dissolved = session.applyGraphCommand({ type: "dissolve-group", groupId: "diagnostic-group" });
    if (!dissolved.changed || session.getRuntimeState().snapshot.nodes.some((item) => item.id === "diagnostic-group")) throw new Error("解除组合命令失败");
    return {
      historyCanUndo: session.history.canUndo,
      historyCanRedo: session.history.canRedo,
      functionId: definition.id,
      functionVersion: definition.version,
      functionCallUndoVerified: true,
      nodeCount: session.getRuntimeState().snapshot.nodes.length,
      edgeCount: session.getRuntimeState().snapshot.edges.length,
      view: session.getViewState(),
    };
  });
}

async function editorNodeMutationCase(): Promise<DiagnosticCase> {
  return runCase("editor-node-mutations", "Editor Core 节点新增/复制/参数/布局事务", undefined, async () => {
    const source = node("source", "python.print", { prefix: "" }, "源节点");
    source.position = { x: 40, y: 60 };
    const session = new EditorSessionStore("node-mutations", { nodes: [source], edges: [], functions: [], requirements: [] }).get("node-mutations")!;

    const insertedNode = node("inserted", "python.print", { prefix: "inserted" }, "新增节点");
    insertedNode.position = { x: 320, y: 60 };
    const inserted = session.applyGraphCommand({ type: "insert-node", node: insertedNode });
    if (!inserted.changed || session.getViewState().primaryNodeId !== "inserted") throw new Error("insert-node 没有原子更新图与选择状态");

    const duplicated = session.applyGraphCommand({ type: "duplicate-node", sourceNodeId: "inserted", duplicateId: "inserted-copy" });
    if (!duplicated.changed || !session.getRuntimeState().snapshot.nodes.some((item) => item.id === "inserted-copy")) throw new Error("duplicate-node 事务失败");

    const historyBeforeParameter = session.history.entries.length;
    session.applyGraphCommand(
      { type: "update-node-parameters", nodeId: "inserted-copy", patch: { prefix: "phase9-a" } },
      { historyGroup: "parameter:inserted-copy:prefix", historyWindowMs: 800, timestampMs: 1000 },
    );
    session.applyGraphCommand(
      { type: "update-node-parameters", nodeId: "inserted-copy", patch: { prefix: "phase9-ab" } },
      { historyGroup: "parameter:inserted-copy:prefix", historyWindowMs: 800, timestampMs: 1300 },
    );
    if (session.history.entries.length !== historyBeforeParameter + 1) throw new Error("连续参数编辑没有合并为一个 undo 事务");
    if (session.getRuntimeState().snapshot.nodes.find((item) => item.id === "inserted-copy")?.data.parameters.prefix !== "phase9-ab") throw new Error("参数事务最终值异常");

    const arranged = session.applyGraphCommand({ type: "arrange-canvas", canvasId: null, viewportWidth: 1000, direction: "horizontal" });
    if (!arranged.changed || arranged.affectedCount !== 3) throw new Error("画布布局事务没有覆盖当前画布节点");

    return {
      nodeCount: session.getRuntimeState().snapshot.nodes.length,
      historyEntries: session.history.entries.length,
      parameterHistoryCoalesced: true,
      selectedNodeId: session.getViewState().primaryNodeId,
      arrangedNodeCount: arranged.affectedCount,
    };
  });
}


async function editorConnectionAndMetadataCase(): Promise<DiagnosticCase> {
  return runCase("editor-connection-metadata", "Editor Core 连线/替换/标签/模板事务", undefined, async () => {
    const source = node("source", "generate.random_table", { count: 3, distribution: "uniform", min: -1, max: 1, mean: 0, std: 1, seed: 8, indexColumn: "index", valueColumn: "value" }, "数据源");
    source.position = { x: 40, y: 60 };
    const absolute = node("absolute", "table.absolute", {}, "绝对值");
    absolute.position = { x: 300, y: 60 };
    const printer = node("printer", "python.print", {}, "打印");
    printer.position = { x: 560, y: 60 };
    const custom = node("custom", "custom.python_function", { code: "def old_value(x):\n    return x" }, "自定义函数");
    custom.position = { x: 820, y: 60 };
    const group: WorkflowNode = {
      id: "group",
      type: "workflow",
      position: { x: 40, y: 300 },
      data: {
        label: "诊断组合",
        nodeType: "workflow.group",
        nodeVersion: 1,
        parameters: {},
        status: "idle",
        groupInputs: [{ id: "input-1", label: "旧输入", valueType: "table", internalNodeId: "absolute", internalHandle: "input" }],
        groupOutputs: [],
      },
    };
    const session = new EditorSessionStore("connection-metadata", { nodes: [source, absolute, printer, custom, group], edges: [], functions: [], requirements: [] }).get("connection-metadata")!;

    const connected = session.applyGraphCommand({ type: "connect-edge", connection: { source: "source", target: "absolute", sourceHandle: "output", targetHandle: "input" } });
    if (!connected.changed || session.getRuntimeState().snapshot.edges.length !== 1) throw new Error("connect-edge 事务失败");
    const edgeId = session.getRuntimeState().snapshot.edges[0]!.id;
    const reconnected = session.applyGraphCommand({ type: "reconnect-edge", edgeId, connection: { source: "source", target: "printer", sourceHandle: "output", targetHandle: "input" } });
    if (!reconnected.changed || session.getRuntimeState().snapshot.edges[0]?.target !== "printer") throw new Error("reconnect-edge 事务失败");

    session.applyGraphCommand({ type: "update-node-tags", nodeId: "absolute", tags: ["诊断", "关键"] });
    session.applyGraphCommand({ type: "update-node-label", nodeId: "group", label: "已重命名组合" });
    session.applyGraphCommand({ type: "update-group-port-label", groupId: "group", direction: "input", portId: "input-1", label: "表格输入" });
    const updatedGroup = session.getRuntimeState().snapshot.nodes.find((item) => item.id === "group");
    if (updatedGroup?.data.label !== "已重命名组合" || updatedGroup.data.groupInputs?.[0]?.label !== "表格输入") throw new Error("组合标签/端口事务失败");

    const replaced = session.applyGraphCommand({ type: "replace-node", nodeId: "printer", nextNodeType: "generate.random_table" });
    if (!replaced.changed || replaced.meta?.removedEdgeCount !== 1 || session.getRuntimeState().snapshot.edges.length !== 0) throw new Error("节点替换没有清理失效输入连线");

    session.applyGraphCommand({ type: "connect-edge", connection: { source: "source", target: "custom", sourceHandle: "output", targetHandle: "input" } });
    const templated = session.applyGraphCommand({ type: "apply-code-template", nodeId: "custom", code: "def next_value(x):\n    return x" });
    if (!templated.changed || session.getRuntimeState().snapshot.edges.some((edge) => edge.source === "custom" || edge.target === "custom")) throw new Error("模板事务没有断开旧签名连线");

    return {
      connectionCreated: true,
      reconnectionVerified: true,
      replacementRemovedEdges: replaced.meta?.removedEdgeCount ?? 0,
      tags: session.getRuntimeState().snapshot.nodes.find((item) => item.id === "absolute")?.data.tags ?? [],
      groupLabel: updatedGroup.data.label,
      groupInputLabel: updatedGroup.data.groupInputs?.[0]?.label,
      templateDisconnectedOldSignature: true,
      historyEntries: session.history.entries.length,
    };
  });
}

async function editorDragHistoryCase(): Promise<DiagnosticCase> {
  return runCase("editor-drag-history", "Editor Session 节点拖动/容器归属历史事务", undefined, async () => {
    const structure = node("structure", "logic.if_subflow", {}, "条件结构");
    structure.position = { x: 100, y: 100 };
    structure.style = { width: 520, height: 300 };
    const moved = node("moved", "python.print", {}, "待拖动节点");
    moved.position = { x: 20, y: 20 };
    const session = new EditorSessionStore("drag-history", { nodes: [structure, moved], edges: [], functions: [], requirements: [] }).get("drag-history")!;

    session.beginHistoryTransaction("node-drag:moved");
    session.updateSnapshot((snapshot) => ({
      ...snapshot,
      nodes: snapshot.nodes.map((item) => item.id === "moved" ? { ...item, position: { x: 200, y: 180 } } : item),
    }));
    session.updateSnapshot((snapshot) => ({
      ...snapshot,
      nodes: snapshot.nodes.map((item) => item.id === "moved" ? { ...item, position: { x: 240, y: 210 } } : item),
    }));
    const committed = session.applyGraphCommand({ type: "commit-node-drag", nodeId: "moved", position: { x: 240, y: 210 } }, { captureHistory: false });
    const historyCommitted = session.commitHistoryTransaction("node-drag:moved");
    const inside = session.getRuntimeState().snapshot.nodes.find((item) => item.id === "moved");
    if (!committed.changed || !historyCommitted || inside?.parentId !== "structure" || inside.data.branch !== "true") throw new Error("拖动结束没有作为一个事务写入结构容器归属");
    if (session.history.entries.length !== 1) throw new Error("一次拖动产生了多条 history");
    const restored = session.undo()?.nodes.find((item) => item.id === "moved");
    if (!restored || restored.parentId || restored.position.x !== 20 || restored.position.y !== 20) throw new Error("拖动 undo 没有恢复拖动前位置/归属");

    return {
      historyEntriesPerDrag: 1,
      enteredStructure: true,
      branch: inside.data.branch,
      relativePosition: inside.position,
      undoRestoredPosition: restored.position,
      undoRestoredParentId: restored.parentId ?? null,
    };
  });
}

async function editorLifecycleAutosaveCase(): Promise<DiagnosticCase> {
  return runCase("editor-lifecycle-autosave", "Workspace Lifecycle 自动保存与损坏隔离", undefined, async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const lifecycle = new EditorWorkspaceLifecycleService(storage, "diagnostic.autosave");
    const snapshot = { nodes: [node("saved", "python.print", { prefix: "phase9" }, "保存测试")], edges: [], functions: [], requirements: ["demo>=1"] };
    const written = lifecycle.writeAutosave("workspace-a", snapshot);
    if (written.ok === false) throw new Error(`自动保存写入失败：${written.message}`);
    const loaded = lifecycle.readAutosave("workspace-a");
    if (loaded.status !== "ok" || loaded.document.nodes[0]?.id !== "saved" || !loaded.document.requirements?.includes("demo>=1")) throw new Error("自动保存读取结果与写入快照不一致");
    storage.setItem(lifecycle.autosaveKey("broken"), "{bad-json");
    const broken = lifecycle.readAutosave("broken");
    if (broken.status !== "corrupt" || storage.getItem(lifecycle.autosaveKey("broken")) !== null) throw new Error("损坏 autosave 没有被隔离清理");
    return {
      autosaveKey: lifecycle.autosaveKey("workspace-a"),
      restoredNodeCount: loaded.document.nodes.length,
      requirements: loaded.document.requirements ?? [],
      corruptEntryRemoved: true,
    };
  });
}

async function editorDocumentLifecycleCase(): Promise<DiagnosticCase> {
  return runCase("editor-document-lifecycle", "Workspace save/open/close/autosave restore 生命周期", undefined, async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const lifecycle = new EditorWorkspaceLifecycleService(storage, "diagnostic.documents");
    const source = new EditorSessionStore("document", emptyWorkflowSnapshot()).get("document")!;
    source.updateSnapshot((snapshot) => ({ ...snapshot, nodes: [node("saved", "python.print", { prefix: "phase9" }, "保存节点")], requirements: ["demo>=1"] }));
    if (!lifecycle.needsSaveBeforeClose(source)) throw new Error("dirty workspace 没有触发关闭前保存判定");

    let serialized = "";
    lifecycle.saveSession(source, "诊断工作流", (text) => { serialized = text; });
    if (!serialized.includes("诊断工作流") || source.isDirty()) throw new Error("saveSession 没有在持久化成功后标记 saved");

    const opened = new EditorSessionStore("opened", emptyWorkflowSnapshot()).get("opened")!;
    const openedResult = lifecycle.openSerialized(opened, serialized);
    if (openedResult.document.name !== "诊断工作流" || opened.isDirty() || opened.getRuntimeState().snapshot.nodes[0]?.id !== "saved") throw new Error("openSerialized 没有原子恢复并建立 saved baseline");
    const openedInitiallyClean = !opened.isDirty();

    opened.updateSnapshot((snapshot) => ({ ...snapshot, requirements: ["recovered>=2"] }));
    const written = lifecycle.writeAutosave(opened.id, opened.getRuntimeState().snapshot, "恢复测试");
    if (written.ok === false) throw new Error(`autosave 写入失败：${written.message}`);
    const recovered = new EditorSessionStore("opened", emptyWorkflowSnapshot()).get("opened")!;
    const restore = lifecycle.restoreAutosave(recovered);
    if (restore.status !== "ok" || !recovered.isDirty() || recovered.getRuntimeState().snapshot.requirements?.[0] !== "recovered>=2") throw new Error("autosave restore 没有恢复为可继续编辑的 dirty session");

    const legacy = JSON.stringify({ schemaVersion: 1, name: "legacy", nodes: [], edges: [] });
    const migrated = parseWorkflowWithReport(legacy);
    if (migrated.report.schemaFromVersion !== 1 || migrated.document.schemaVersion !== WORKFLOW_SCHEMA_VERSION || migrated.report.schemaSteps.length !== 2) throw new Error("历史工作流 schema 迁移链不完整");
    const futureKey = lifecycle.autosaveKey("future");
    const future = JSON.stringify({ schemaVersion: WORKFLOW_SCHEMA_VERSION + 10, name: "future", nodes: [], edges: [], functions: [], requirements: [] });
    values.set(futureKey, future);
    const futureRead = lifecycle.readAutosave("future");
    if (futureRead.status !== "incompatible" || values.get(futureKey) !== future) throw new Error("未来版本 autosave 没有原样保留");
    if (lifecycle.writeAutosave("future", emptyWorkflowSnapshot()).ok !== false || values.get(futureKey) !== future) throw new Error("未来版本 autosave 被当前版本覆盖");
    const captureObservableSessionState = () => JSON.stringify({
      state: opened.getState(),
      dirty: opened.isDirty(),
      history: { canUndo: opened.history.canUndo, canRedo: opened.history.canRedo, entries: opened.history.entries },
    });
    const beforeFutureOpen = captureObservableSessionState();
    try { lifecycle.openSerialized(opened, future); throw new Error("未来版本工作流没有拒绝打开"); } catch (error) { if (error instanceof Error && error.message === "未来版本工作流没有拒绝打开") throw error; }
    const afterFutureOpen = captureObservableSessionState();
    if (afterFutureOpen !== beforeFutureOpen) throw new Error("拒绝未来工作流时污染了当前 Editor Session");

    return {
      saveMarkedClean: !source.isDirty(),
      openedMarkedClean: openedInitiallyClean,
      closeRequiresSaveAfterEdit: lifecycle.needsSaveBeforeClose(opened),
      autosaveRestoredDirty: recovered.isDirty(),
      restoredNodeCount: recovered.getRuntimeState().snapshot.nodes.length,
      compatibility: { schemaFromVersion: 1, schemaToVersion: WORKFLOW_SCHEMA_VERSION, futureAutosavePreserved: true, futureOpenAtomic: true },
    };
  });
}


async function resourceContractCase(): Promise<DiagnosticCase> {
  return runCase("editor-resource-contract", "统一 Resource Contract 节点/函数/组合/流程能力", undefined, async () => {
    const fixture = node("saved-node", "python.print", {}, "保存节点");
    const saved = describeSavedNode({ id: "saved", name: "保存节点", node: fixture, savedAt: "now" });
    const group = describeGroup({ id: "builtin-group", name: "内置组合", description: "fixture", nodes: [fixture], edges: [], builtIn: true });
    const fn = describeFunction({ id: "fn", name: "函数", version: 1, description: "fixture", inputs: [], outputs: [], nodes: [fixture], edges: [] });
    const flow = describeFlow({ id: "flow", name: "流程", savedAt: "", document: "{}", external: true });
    if (saved.capabilities.primaryAction !== "insert" || !saved.capabilities.rename) throw new Error("保存节点资源能力异常");
    if (group.capabilities.remove || group.capabilities.rename) throw new Error("内置组合资源不应允许删除/改名");
    if (fn.capabilities.primaryAction !== "call") throw new Error("函数资源主动作不是 call");
    if (flow.capabilities.primaryAction !== "open") throw new Error("流程资源主动作不是 open");
    return {
      keys: [saved, group, fn, flow].map(resourceContractKey),
      primaryActions: { savedNode: saved.capabilities.primaryAction, group: group.capabilities.primaryAction, function: fn.capabilities.primaryAction, flow: flow.capabilities.primaryAction },
      builtInGroupProtected: !group.capabilities.remove && !group.capabilities.rename,
    };
  });
}

async function workspaceSessionIdentityCase(deps: AutomatedDiagnosticsDependencies): Promise<DiagnosticCase> {
  return runCase("workspace-session-identity", "Remote/Local Workspace Session 身份边界", undefined, async () => {
    const local = createWorkspaceSessionIdentity("default", "diagnostic-local", "local");
    const remote = createWorkspaceSessionIdentity("default", "diagnostic-remote", "remote");
    setWorkspaceVariableState(local, { owner: "local" });
    setWorkspaceVariableState(remote, { owner: "remote" });
    try {
      if (local.key === remote.key) throw new Error("相同 workspaceId 的 local/remote session key 发生碰撞");
      if (getWorkspaceVariableState(local).owner !== "local" || getWorkspaceVariableState(remote).owner !== "remote") throw new Error("Workspace 变量跨 client/source 串扰");
      const remoteEntry = { workspaceId: "default", clientId: "diagnostic-remote", source: "remote" as const };
      if (!matchesHostExecution(remote, remoteEntry) || matchesHostExecution(local, remoteEntry)) throw new Error("Host execution 没有按 workspaceId + clientId + source 绑定");
      const active = createWorkspaceSessionIdentity(deps.activeWorkspaceId, deps.executionClientId, deps.remote ? "remote" : "local");
      return { localKey: local.key, remoteKey: remote.key, activeKey: active.key, hostMatchUsesClientAndWorkspace: true, isolatedVariableState: true };
    } finally {
      clearWorkspaceVariableState(local);
      clearWorkspaceVariableState(remote);
    }
  });
}


async function resourceLibraryPersistenceCase(): Promise<DiagnosticCase> {
  return runCase("editor-resource-persistence", "Resource Service 保存/改名/锁定/删除持久化", undefined, async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } as StorageLike;
    const mirrored = new Map<string, string>();
    const builtInGroup = node("diagnostic-built-in", "workflow.group", {}, "内置诊断组合");
    const service = new EditorResourceLibraryService(storage, [{ id: "diagnostic-built-in", name: "内置诊断组合", description: "fixture", nodes: [builtInGroup], edges: [], builtIn: true }], (path, content) => mirrored.set(path, content));
    service.saveNode({ id: "diagnostic-node-a", name: "A", node: node("saved-a", "table.absolute"), savedAt: "now" });
    service.saveNode({ id: "diagnostic-node-b", name: "B", node: node("saved-b", "table.absolute"), savedAt: "now" });
    if (!service.renameNode("diagnostic-node-a", "A2") || !service.reorderNodes("diagnostic-node-a", "diagnostic-node-b")) throw new Error("保存节点资源改名/排序失败");
    if (service.renameGroup("diagnostic-built-in", "不应成功")) throw new Error("内置组合保护失效");
    const flow = service.addFlowDocument("诊断流程", JSON.stringify(serializeWorkflow("诊断流程", [], [])), { id: "diagnostic-flow", savedAt: "now" });
    if (!service.toggleFlowLock(flow.id)?.locked || service.removeFlow(flow.id)) throw new Error("流程锁定没有阻止删除");
    service.toggleFlowLock(flow.id);
    if (!service.removeFlow(flow.id)) throw new Error("解锁后的流程无法删除");
    if (!mirrored.has("nodes/saved-nodes.json") || !mirrored.has("workflows/library.json")) throw new Error("资源镜像没有经过 Resource Service");

    const legacyNode = node("legacy-resource", "table.absolute");
    delete (legacyNode.data as { nodeVersion?: number }).nodeVersion;
    const futureFlow = { id: "future-resource", name: "Future", savedAt: "future", resourceSchemaVersion: 99, futureMetadata: { keep: true }, document: JSON.stringify({ schemaVersion: 99, name: "future", nodes: [], edges: [] }) };
    values.set("pydroid-flow.saved-node-library.v1", JSON.stringify([{ id: "legacy-resource", name: "Legacy", node: legacyNode, savedAt: "old" }]));
    values.set("pydroid-flow.workflow-library.v1", JSON.stringify([futureFlow]));
    values.set("pydroid-flow.group-library.v1", JSON.stringify([]));
    const migratedResources = new EditorResourceLibraryService(storage);
    const migratedNode = migratedResources.getState().savedNodes.find((entry) => entry.id === "legacy-resource");
    const protectedFlow = migratedResources.getState().flows.find((entry) => entry.id === "future-resource");
    if (migratedNode?.resourceSchemaVersion !== 2 || migratedNode.node.data.nodeVersion !== 1) throw new Error("旧保存节点资源没有升级");
    if (protectedFlow?.compatibility !== "future" || migratedResources.removeFlow("future-resource")) throw new Error("未来资源没有进入只读保护");
    const persistedFuture = JSON.parse(values.get("pydroid-flow.workflow-library.v1") ?? "[]")[0];
    if (JSON.stringify(persistedFuture) !== JSON.stringify(futureFlow)) throw new Error("未来资源 payload 被当前版本改写");

    return {
      savedNodeCount: service.getState().savedNodes.length,
      builtInGroupProtected: service.getState().groups.some((entry) => entry.id === "diagnostic-built-in" && entry.builtIn),
      flowLockProtectedDelete: true,
      mirroredPaths: [...mirrored.keys()].sort(),
      compatibility: { legacyResourceMigrated: true, futureResourcePreserved: true },
    };
  });
}

async function executionSessionLifecycleCase(): Promise<DiagnosticCase> {
  return runCase("execution-session-lifecycle", "标签 Session 与本地执行控制器身份隔离", undefined, async () => {
    const localStore = new EditorSessionStore("shared", emptyWorkflowSnapshot(), { clientId: "diagnostic-local-client", source: "local" });
    const remoteStore = new EditorSessionStore("shared", emptyWorkflowSnapshot(), { clientId: "diagnostic-remote-client", source: "remote" });
    const local = localStore.get("shared")!;
    const remote = remoteStore.get("shared")!;
    if (local.identity.key === remote.identity.key) throw new Error("Editor Session identity 发生碰撞");
    const manager = new ExecutionManager();
    let releaseLocal!: () => void;
    let releaseRemote!: () => void;
    const localGate = new Promise<void>((resolve) => { releaseLocal = resolve; });
    const remoteGate = new Promise<void>((resolve) => { releaseRemote = resolve; });
    const localRun = manager.execute(local.identity.key, "javascript", async () => { await localGate; return "local"; });
    const remoteRun = manager.execute(remote.identity.key, "javascript", async () => { await remoteGate; return "remote"; });
    await Promise.resolve();
    if (!manager.isActive(local.identity.key) || !manager.isActive(remote.identity.key)) throw new Error("同 workspaceId 的不同 Session 不能并行拥有独立控制器");
    if (manager.activeWorkspaceIds().length !== 2) throw new Error("执行控制器没有按 Session key 隔离");
    releaseLocal();
    releaseRemote();
    const results = await Promise.all([localRun, remoteRun]);
    return { localKey: local.identity.key, remoteKey: remote.identity.key, simultaneousControllers: 2, results };
  });
}

async function agentEditorBatchCase(): Promise<DiagnosticCase> {
  return runCase("editor-agent-batch", "AI Agent 批量 Graph Surgery 单一 Session 事务", undefined, async () => {
    const session = new EditorSessionStore("agent-batch", emptyWorkflowSnapshot()).get("agent-batch")!;
    const createDiagnosticNode = (id: string, nodeType: string, x: number, y: number, parameters: Record<string, string | number | boolean | null>) => {
      const spec = getNodeSpec(nodeType);
      if (!spec) throw new Error(`未知诊断节点：${nodeType}`);
      const created = node(id, nodeType, { ...spec.defaults, ...parameters }, spec.label);
      created.position = { x, y };
      return created;
    };
    const result = applyAgentOperationsToSession(session, [
      { type: "add_node", id: "source", nodeType: "generate.random_table", parameters: { count: 4 } },
      { type: "add_node", id: "absolute", nodeType: "table.absolute" },
      { type: "connect", source: "source", target: "absolute", sourceHandle: "output", targetHandle: "input" },
      { type: "arrange", direction: "horizontal" },
    ], { canvasId: null, viewportWidth: 1000, createNode: createDiagnosticNode });
    if (!result.changed || result.snapshot.nodes.length !== 2 || result.snapshot.edges.length !== 1) throw new Error("AI 批量事务未生成预期图");
    if (session.history.entries.length !== 1) throw new Error(`AI 批量操作产生 ${session.history.entries.length} 条 history，预期 1 条`);
    const beforeRejected = session.getRuntimeState().snapshot;
    try {
      applyAgentOperationsToSession(session, [
        { type: "add_node", id: "temporary", nodeType: "table.absolute" },
        { type: "connect", source: "missing", target: "temporary" },
      ], { canvasId: null, viewportWidth: 1000, createNode: createDiagnosticNode });
      throw new Error("无效 AI 计划没有被拒绝");
    } catch (error) {
      if (error instanceof Error && error.message === "无效 AI 计划没有被拒绝") throw error;
    }
    if (session.getRuntimeState().snapshot.nodes.length !== beforeRejected.nodes.length) throw new Error("被拒绝的 AI 批量计划发生了部分写入");
    const undo = session.undo();
    if (!undo || undo.nodes.length !== 0 || undo.edges.length !== 0) throw new Error("AI 批量事务 undo 没有一次恢复基线");
    return { appliedOperations: result.appliedOperations, historyEntriesPerPlan: 1, atomicRejection: true, undoRestoredBaseline: true };
  });
}

async function editorRequirementOwnershipCase(): Promise<DiagnosticCase> {
  return runCase("editor-requirement-ownership", "工作流依赖清单 Editor Command 所有权", undefined, async () => {
    const session = new EditorSessionStore("requirements", emptyWorkflowSnapshot()).get("requirements")!;
    const added = session.applyGraphCommand({ type: "upsert-requirement", requirement: "scipy>=1.12" });
    const replaced = session.applyGraphCommand({ type: "upsert-requirement", requirement: "scipy==1.13.1" });
    const removed = session.applyGraphCommand({ type: "remove-requirement", requirement: "scipy==1.13.1" });
    if (!added.changed || !replaced.changed || !removed.changed) throw new Error("依赖清单事务没有全部进入 Editor Command");
    if ((session.getRuntimeState().snapshot.requirements ?? []).length !== 0) throw new Error("依赖删除事务没有提交");
    const restored = session.undo();
    if (restored?.requirements?.[0] !== "scipy==1.13.1") throw new Error("依赖清单 undo 没有恢复事务前状态");
    return { historyEntries: 3, replacementDeduplicatedByPackage: true, undoRestoredRequirement: restored.requirements?.[0] ?? null };
  });
}

async function runtimeInteractionIsolationCase(): Promise<DiagnosticCase> {
  return runCase("editor-runtime-interaction-isolation", "交互节点运行值不污染 Editor Session", undefined, async () => {
    const input = node("interactive-input", "ui.input_dialog", { inputKind: "text", value: "default" }, "交互输入");
    const alert = node("interactive-alert", "ui.alert", { title: "确认", message: "继续吗", response: null }, "交互确认");
    const store = new EditorSessionStore("interactive", { nodes: [input, alert], edges: [], functions: [], requirements: [] });
    const session = store.get("interactive")!;
    if (session.isDirty()) throw new Error("诊断 Session 初始状态不应为 dirty");
    const executionNodes = applyRuntimeNodeParameterOverride(session.getRuntimeState().snapshot.nodes, input.id, { value: "runtime-only" });
    const executionNodes2 = applyRuntimeNodeParameterOverride(executionNodes, alert.id, { response: true });
    const editorNodes = session.getRuntimeState().snapshot.nodes;
    if (editorNodes.find((item) => item.id === input.id)?.data.parameters.value !== "default") throw new Error("运行时输入回写了 Editor Snapshot");
    if (editorNodes.find((item) => item.id === alert.id)?.data.parameters.response !== null) throw new Error("运行时确认回写了 Editor Snapshot");
    if (executionNodes2.find((item) => item.id === input.id)?.data.parameters.value !== "runtime-only") throw new Error("运行时输入 override 未生效");
    if (executionNodes2.find((item) => item.id === alert.id)?.data.parameters.response !== true) throw new Error("运行时确认 override 未生效");
    if (session.isDirty()) throw new Error("仅响应运行时交互后工作区被错误标记为 dirty");
    return { editorInputValue: "default", runtimeInputValue: "runtime-only", runtimeAlertResponse: true, editorStayedClean: true };
  });
}


async function remoteHostE2ECase(deps: AutomatedDiagnosticsDependencies): Promise<DiagnosticCase> {
  const started = performance.now();
  const label = "Remote Web 宿主真实启动/HTTP/局域网发现";
  if (!deps.testRemoteHost) return { id: "remote-host-e2e", label, status: "skip", durationMs: 0, details: {} };
  try {
    const details = await deps.testRemoteHost();
    return { id: "remote-host-e2e", label, status: "skip", durationMs: Math.round((performance.now() - started) * 100) / 100, details };
  } catch (error) {
    return { id: "remote-host-e2e", label, status: "fail", durationMs: Math.round((performance.now() - started) * 100) / 100, details: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

async function remoteSecurityPolicyCase(): Promise<DiagnosticCase> {
  return runCase("remote-security-policy", "Remote Web 配对/Token/API 限流安全策略", undefined, async () => {
    const policy = describeRemoteSecurityPolicy();
    if (policy.pairLocksAtAttempt !== 5) throw new Error("PIN 失败锁定阈值不是 5 次");
    if (policy.pairRetryAfterSeconds < 60) throw new Error("PIN 冷却时间低于 60 秒");
    if (policy.generalLimit < 120 || policy.expensiveLimit >= policy.generalLimit) throw new Error("Remote API 分级限流策略异常");
    if (policy.tokenTtlHours !== 12) throw new Error("Remote Token TTL 不是 12 小时");
    return policy;
  });
}

async function remoteAgentProxyBoundaryCase(): Promise<DiagnosticCase> {
  return runCase("remote-agent-proxy-boundary", "Remote Agent 宿主代理不需要浏览器持有原始密钥", undefined, async () => {
    let transportCalls = 0;
    const settings = { ...DEFAULT_AGENT_SETTINGS, endpoint: "https://host-owned.invalid/v1/responses", model: "diagnostic-model" };
    const result = await testAgentConnection(settings, "", async (_settings, body) => {
      transportCalls += 1;
      if (!body || typeof body !== "object") throw new Error("宿主代理没有收到结构化 Agent 请求");
      return { model: "host-proxy-diagnostic" };
    });
    if (!result.ok || transportCalls !== 1) throw new Error("无浏览器 API key 的宿主代理路径没有生效");
    return { browserRawApiKeyRequired: false, transportCalls, model: "host-proxy-diagnostic" };
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
  cases.push(await editorCommandTransactionCase());
  cases.push(await editorNodeMutationCase());
  cases.push(await editorConnectionAndMetadataCase());
  cases.push(await editorDragHistoryCase());
  cases.push(await editorLifecycleAutosaveCase());
  cases.push(await editorDocumentLifecycleCase());
  cases.push(await resourceContractCase());
  cases.push(await resourceLibraryPersistenceCase());
  cases.push(await workspaceSessionIdentityCase(deps));
  cases.push(await executionSessionLifecycleCase());
  cases.push(await agentEditorBatchCase());
  cases.push(await editorRequirementOwnershipCase());
  cases.push(await runtimeInteractionIsolationCase());
  if (deps.testRemoteHost) {
    cases.push(await remoteHostE2ECase(deps));
  } else {
    cases.push({ id: "remote-host-e2e", label: "Remote Web 宿主真实启动/HTTP/局域网发现", status: "skip", durationMs: 0, details: { reason: "当前环境不是可启动局域网服务的宿主" } });
  }
  cases.push(await remoteSecurityPolicyCase());
  cases.push(await remoteAgentProxyBoundaryCase());
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
