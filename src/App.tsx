import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type CSSProperties, type DragEvent as ReactDragEvent, type ErrorInfo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionLineType,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeProps,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  areValueTypesCompatible,
  getNodeSpec,
  NODE_CATALOG,
  searchNodeCatalog,
  type NodeSpec,
  type ParameterSpec,
  type ValueType,
} from "./nodeCatalog";
import {
  CUSTOM_NODE_TEMPLATES,
  parseCustomNodeTemplate,
  parsePythonFunctionSignature,
  resolveNodeSpec,
  serializeCustomNodeTemplate,
  type CustomNodeTemplate,
} from "./customNode";
import {
  compactNodeLayout,
  flattenWorkflowGroups,
  normalizeNodePositions,
  parseWorkflow,
  serializeWorkflow,
  type WorkflowFunctionDefinition,
  type WorkflowNode,
} from "./workflow";
import { analyzedNotebookToWorkflow, joinNotebookCells, notebookCellsToWorkflow, parseJupyterNotebook, parseWorkflowNotebook, serializeJupyterNotebookCells, serializeWorkflowNotebook, splitWorkflowNotebookCells, workflowNotebookCells, workflowNotebookMetadata, type NotebookCell } from "./workflowNotebook";
import { analyzeNotebook, analyzePythonSignature, cancelActiveExecution, cancelHostExecution, executeWorkflow, executeWorkflowWithRuntime, ExecutionBusyError, ExecutionCancelledError, ExecutionTimeoutError, getExecutionStatus, getHostExecutionStatus, getPythonEnvironment, resolveExecutionRuntime, setExecutionRuntimePreference, subscribeExecutionStatus, warmUpExecutionRuntime, WorkflowExecutionError, type ExecutionResult, type HostExecutionStatus, type NodeExecutionPreview, type PythonEnvironment, type PythonSignatureAnalysis, type RuntimePreference, type TablePreview } from "./execution";
import { emptyHostExecutionStatus, type HostExecutionEntry } from "./execution-host";
import { clearWorkspaceExecutionResult, clearWorkspaceVariableState, getExecutionClientId, getWorkspaceExecutionResult, listWorkspaceVariableNames } from "./execution-workspace";
import { canSafelyPreExecuteNodes, getNodeContract } from "./nodeContract";
import { canHostRemoteServer, chooseWorkflowFolder, getPlatformAdapter, deleteWorkflowFile, exportTextFile, discoverSmbServers, getRemoteAccessPolicy, getRemoteAppConfiguration, proxyRemoteAgentRequest, getRuntimeStats, getUserProfileInfo, getWindowControls, isNativePlatform, isRemoteRuntime, listSmbDirectory, listWorkflowLibrary, loadAgentSecret, loadSmbSecret, openWorkflowFolder, pairRemoteRuntime, pickCsvFiles, readSmbCsvFiles, renameWorkflowFile, saveAgentSecret, saveSmbSecret, saveUserProfileFile, scanSmbShares, setSystemTheme, startRemoteServer, stopRemoteServer, type RemoteAccessPolicy, type RemoteServerInfo, type SmbConnection, type SmbEntry, type SmbServer, type UserProfileInfo, type WindowControls } from "./platform";
import { AGENT_PRESETS, DEFAULT_AGENT_SETTINGS, parseAgentPlan, presetById, requestAgentPlan, testAgentConnection, validateAgentPlan, type AgentOperation, type AgentPermission, type AgentPlan, type AgentSettings, type AgentTransport } from "./agent";
import { DataGrid, resultPreviewText } from "./components";
import { PlotPreview } from "./ui/PlotPreview";
import { AgentDialog, AlertDialog, AutomatedDiagnosticsDialog, CodeEditorModal, ConfirmDialog, DebugDialog, ErrorDetailDialog, HistoryDialog, InputDialog, NewWorkflowDialog, PackageManager, PlotLightbox, RemoteAccessDialog, RemotePairDialog, RenameFlowDialog, ReplacementPanel, ResultDetailDialog, SettingsDialog, SmbDialog, TextPromptDialog, UnsavedChangesDialog } from "./dialogs";
import { cloneWorkflowSnapshot, emptyWorkflowSnapshot, upstreamSubgraph, workflowHasContent, type WorkflowSnapshot } from "./workflow-core";
import { EditorSessionStore, EditorWorkspaceLifecycleService, applyAgentOperationsToSession, captureGroupResource, captureNodeResource, createWorkspaceSessionIdentity, describeCatalogNode, describeFlow, describeFunction, describeGroup, describeSavedNode, gestureTargetForNodeType, instantiateGroupResource, instantiateNodeResource, matchesHostExecution, nodeSpecForEditor, repairWorkflowGroupInterfaces, resolveGesturePolicy, resourceRef, useEditorWorkspaceSession, validateEditorConnection, applyRuntimeNodeParameterOverride, EditorResourceLibraryService, type EditorResourceRef, type EditorWorkspaceSession, type FlowLibraryEntry, type GroupLibraryEntry, type SavedNodeEntry } from "./editor-core";
import { functionCallCount } from "./workflow-functions";
import { runAutomatedDiagnostics, type AutomatedDiagnosticReport } from "./diagnostics/automated-debug";
import { APP_VERSION } from "./app-version";

const AUTOSAVE_KEY = "pydroid-flow.autosave.v1";
const PERSONAL_TEMPLATES_KEY = "pydroid-flow.custom-templates.v1";
const NODE_DEFAULTS_KEY = "pydroid-flow.node-defaults.v1";
const NODE_GROUPS_KEY = "pydroid-flow.node-groups.v1";
const LAYOUT_MODE_KEY = "pydroid-flow.layout-mode.v2";
const MINIMAP_MODE_KEY = "pydroid-flow.minimap-mode.v2";
const SETTINGS_KEY = "pydroid-flow.settings.v1";
const REMOTE_CONFIGURATION_OVERRIDE_KEY = "pydroid-flow.remote-configuration-override.v1";
const PALETTE_MIN_WIDTH = 216;
type PaletteResource = EditorResourceRef;

type ThemeMode = "system" | "dark" | "light";
const notebookCellRows = (source: string) => Math.max(3, source.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(Array.from(line).length / 96)), 0));
const VALUE_TYPE_COLORS: Record<ValueType, string> = { table: "#22c55e", plot: "#a855f7", csv: "#14b8a6", number: "#f59e0b", text: "#3b82f6", boolean: "#ef4444", list: "#06b6d4", object: "#8b5cf6", any: "#64748b" };
const bytesToBase64 = (bytes: Uint8Array) => { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); };

const EdgeActionsContext = createContext<{ disconnect: (ids: string[]) => void }>({ disconnect: () => undefined });

function TypedGradientEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data, selected }: EdgeProps) {
  const edgeActions = useContext(EdgeActionsContext);
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const gradientId = `edge-gradient-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const colors = data as { sourceColor?: string; targetColor?: string } | undefined;
  const centerX = (sourceX + targetX) / 2;
  const centerY = (sourceY + targetY) / 2;
  return <><defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}><stop offset="0%" stopColor={colors?.sourceColor ?? "#64748b"}/><stop offset="100%" stopColor={colors?.targetColor ?? "#64748b"}/></linearGradient></defs><BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={38} style={{ ...style, stroke: `url(#${gradientId})` }} /><path className="edge-disconnect-hit" d={path} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); edgeActions.disconnect([id]); }} />{selected && <foreignObject className="edge-disconnect-control" x={centerX - 14} y={centerY - 14} width="28" height="28"><button type="button" aria-label="断开连线" title="断开连线" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); edgeActions.disconnect([id]); }}>×</button></foreignObject>}</>;
}

function NotebookEditor({ value, rows, onChange }: { value: string; rows: number; onChange: (value: string) => void }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(1, value.split("\n").length);
  return <div className="notebook-editor"><div ref={gutter} className="notebook-editor__lines" aria-hidden="true">{Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}</div><textarea value={value} rows={rows} spellCheck={false} onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} onChange={(event) => onChange(event.target.value)} /></div>;
}
type SmbSettings = Omit<SmbConnection, "password"> & { rememberPassword: boolean; guest: boolean };
type AppSettings = { themeMode: ThemeMode; runtimePreference: RuntimePreference; paletteWidth: number; inspectorWidth: number; inspectorHeight: number; resultHeight: number; nodeScale: number; endpointScale: number; edgeWidth: number; showNodeInsights: boolean; debugMode: boolean; automatedDiagnosticsEnabled: boolean; miniMapMode: "auto" | "show" | "hide"; layoutMode: "auto" | "horizontal" | "vertical"; smb: SmbSettings; agent: AgentSettings };

function readableError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && error.message !== "[object Object]") return error.message;
  if (typeof error === "string" && error && error !== "[object Object]") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["message", "description", "code", "status"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim() && candidate !== "[object Object]") return candidate;
    }
    try { const serialized = JSON.stringify(error); if (serialized !== "{}") return serialized; } catch { /* ignored */ }
  }
  return fallback;
}

function loadAgentSettings(value: unknown): AgentSettings {
  const saved = value && typeof value === "object" ? value as Partial<AgentSettings> : {};
  const permissions = (saved.permissions && typeof saved.permissions === "object" ? saved.permissions : {}) as Partial<Record<AgentPermission, boolean>>;
  const permissionValue = (permission: AgentPermission) => typeof permissions[permission] === "boolean" ? permissions[permission] : DEFAULT_AGENT_SETTINGS.permissions[permission];
  // DeepSeek 预设迁移：旧模型名 → V4；把早期试验性的 /responses 配置迁回官方 Chat Completions。
  const rawModel = typeof saved.model === "string" ? saved.model : DEFAULT_AGENT_SETTINGS.model;
  const model = saved.presetId === "deepseek"
    ? rawModel === "deepseek-reasoner" ? "deepseek-v4-pro" : rawModel === "deepseek-chat" ? "deepseek-v4-flash" : rawModel
    : rawModel;
  const rawProvider = saved.provider === "anthropic-messages" || saved.provider === "openai-compatible" ? saved.provider : "openai-responses";
  const rawEndpoint = typeof saved.endpoint === "string" && saved.endpoint.trim() ? saved.endpoint : DEFAULT_AGENT_SETTINGS.endpoint;
  const migrateDeepSeekResponses = saved.presetId === "deepseek" && rawProvider === "openai-responses" && rawEndpoint === "https://api.deepseek.com/responses";
  const provider = migrateDeepSeekResponses ? "openai-compatible" : rawProvider;
  const endpoint = migrateDeepSeekResponses ? "https://api.deepseek.com/chat/completions" : rawEndpoint;
  return {
    presetId: typeof saved.presetId === "string" ? saved.presetId : DEFAULT_AGENT_SETTINGS.presetId,
    provider,
    endpoint,
    model,
    language: saved.language === "en" ? "en" : "zh-CN",
    permissions: {
      createNodes: permissionValue("createNodes"),
      // 旧存档没有 groupNodes 键时，沿用 createNodes 的值，避免权限静默放大
      groupNodes: typeof permissions.groupNodes === "boolean" ? permissions.groupNodes : permissionValue("createNodes"),
      updateParameters: permissionValue("updateParameters"),
      connectNodes: permissionValue("connectNodes"),
      disconnectNodes: permissionValue("disconnectNodes"),
      deleteNodes: permissionValue("deleteNodes"),
      arrangeLayout: permissionValue("arrangeLayout"),
      runWorkflow: permissionValue("runWorkflow"),
    },
  };
}

function loadAppSettings(): AppSettings {
  const defaults: AppSettings = { themeMode: "system", runtimePreference: "auto", paletteWidth: PALETTE_MIN_WIDTH, inspectorWidth: 320, inspectorHeight: 220, resultHeight: 280, nodeScale: 1, endpointScale: 1, edgeWidth: 2, showNodeInsights: true, debugMode: false, automatedDiagnosticsEnabled: true, miniMapMode: "hide", layoutMode: "vertical", smb: { server: "", share: "", domain: "", username: "", rememberPassword: true, guest: false }, agent: DEFAULT_AGENT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<AppSettings>;
    return {
      themeMode: saved.themeMode === "dark" || saved.themeMode === "light" ? saved.themeMode : "system",
      runtimePreference: saved.runtimePreference === "python" || saved.runtimePreference === "javascript" ? saved.runtimePreference : "auto",
      paletteWidth: Number.isFinite(saved.paletteWidth) ? Math.min(360, Math.max(PALETTE_MIN_WIDTH, Number(saved.paletteWidth))) : defaults.paletteWidth,
      inspectorWidth: Number.isFinite(saved.inspectorWidth) ? Math.min(560, Math.max(250, Number(saved.inspectorWidth))) : defaults.inspectorWidth,
      inspectorHeight: Number.isFinite(saved.inspectorHeight) ? Math.min(440, Math.max(140, Number(saved.inspectorHeight))) : defaults.inspectorHeight,
      resultHeight: Number.isFinite(saved.resultHeight) ? Math.min(520, Math.max(180, Number(saved.resultHeight))) : defaults.resultHeight,
      nodeScale: Number.isFinite(saved.nodeScale) ? Math.min(1.4, Math.max(0.75, Number(saved.nodeScale))) : defaults.nodeScale,
      endpointScale: Number.isFinite(saved.endpointScale) ? Math.min(1.8, Math.max(0.7, Number(saved.endpointScale))) : defaults.endpointScale,
      edgeWidth: Number.isFinite(saved.edgeWidth) ? Math.min(5, Math.max(1, Number(saved.edgeWidth))) : defaults.edgeWidth,
      showNodeInsights: typeof saved.showNodeInsights === "boolean" ? saved.showNodeInsights : defaults.showNodeInsights,
      debugMode: typeof saved.debugMode === "boolean" ? saved.debugMode : defaults.debugMode,
      automatedDiagnosticsEnabled: typeof saved.automatedDiagnosticsEnabled === "boolean" ? saved.automatedDiagnosticsEnabled : defaults.automatedDiagnosticsEnabled,
      miniMapMode: saved.miniMapMode === "show" || saved.miniMapMode === "auto" || saved.miniMapMode === "hide" ? saved.miniMapMode : defaults.miniMapMode,
      layoutMode: saved.layoutMode === "auto" || saved.layoutMode === "horizontal" || saved.layoutMode === "vertical" ? saved.layoutMode : defaults.layoutMode,
      smb: saved.smb && typeof saved.smb === "object" ? { server: String(saved.smb.server ?? ""), share: String(saved.smb.share ?? ""), domain: String(saved.smb.domain ?? ""), username: String(saved.smb.username ?? ""), rememberPassword: typeof saved.smb.rememberPassword === "boolean" ? saved.smb.rememberPassword : true, guest: Boolean(saved.smb.guest) } : defaults.smb,
      agent: loadAgentSettings(saved.agent),
    };
  } catch { return defaults; }
}

type ContextMenuState = { x: number; y: number; nodeId: string };
type SelectionMenuState = { x: number; y: number };
type FlowMenuState = { x: number; y: number; entryId: string };
type ResourceMenuState = { x: number; y: number; kind: "catalog-node" | "saved-node" | "group"; entryId: string };
const NodeInsightContext = createContext<{ visible: boolean; results: Record<string, NodeExecutionPreview> }>({ visible: true, results: {} });
const NodeLayoutContext = createContext<"horizontal" | "vertical">("horizontal");
const NodeAppearanceContext = createContext<{ nodeScale: number; endpointScale: number }>({ nodeScale: 1, endpointScale: 1 });
const NodeSelectionContext = createContext<{ active: boolean; toggle: (nodeId: string) => void; remove: (nodeId: string) => void }>({ active: false, toggle: () => undefined, remove: () => undefined });
const BUNDLED_PACKAGES = [
  { name: "pandas", version: "2.1.3", purpose: "表格处理与 CSV" },
  { name: "matplotlib", version: "3.8.2", purpose: "绘图与热图" },
];

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("PyDroid Flow render failure", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="startup-recovery" role="alert"><section><strong>PyDroid Flow 未能加载画布</strong><p>{this.state.error.message || "界面发生异常"}</p><p>可清除本机画布缓存后重新启动；不会影响已导出的工作流文件。</p><button onClick={() => { localStorage.removeItem(AUTOSAVE_KEY); localStorage.removeItem(SETTINGS_KEY); window.location.reload(); }}>清除画布缓存并重试</button></section></main>;
  }
}

const initialNodes: WorkflowNode[] = [];

const initialEdges: Edge[] = [];

function createNode(
  id: string,
  nodeType: string,
  x: number,
  y: number,
  parameterOverrides: Record<string, string | number | boolean | null> = {},
): WorkflowNode {
  const spec = getNodeSpec(nodeType);
  const remembered = loadRememberedNodeDefaults(nodeType);
  return {
    id,
    type: "workflow",
    position: { x, y },
    data: {
      label: spec?.label ?? nodeType,
      nodeType,
      nodeVersion: 1,
      parameters: { ...(spec?.defaults ?? {}), ...remembered, ...parameterOverrides },
      status: "idle",
    },
  };
}

function defaultGroupLibrary(): GroupLibraryEntry[] {
  const make = (id: string, name: string, description: string, childTypes: string[], edges: Array<[string, string]>, inputChild: string, outputChild: string): GroupLibraryEntry => {
    const groupId = `builtin-${id}`;
    const children = childTypes.map((nodeType, index) => {
      const child = createNode(`${groupId}-${index + 1}`, nodeType, 55 + index * 215, 80);
      child.data.canvasParentId = groupId;
      return child;
    });
    const input = children.find((node) => node.data.nodeType === inputChild)!;
    const output = children.find((node) => node.data.nodeType === outputChild)!;
    const group: WorkflowNode = { id: groupId, type: "workflow", position: { x: 40, y: 40 }, data: { label: name, nodeType: "workflow.group", nodeVersion: 1, status: "idle", parameters: { description }, groupInputs: [{ id: "input-1", label: "输入表", valueType: "table", internalNodeId: input.id, internalHandle: "input" }], groupOutputs: [{ id: "output-1", label: "结果", valueType: nodeSpecFor(output)?.outputPorts[0]?.valueType ?? "table", internalNodeId: output.id, internalHandle: "output" }] } };
    const byType = new Map(children.map((node) => [node.data.nodeType, node.id]));
    return { id: groupId, name, description, builtIn: true, nodes: [group, ...children], edges: edges.map(([source, target], index) => ({ id: `${groupId}-edge-${index + 1}`, source: byType.get(source)!, sourceHandle: "output", target: byType.get(target)!, targetHandle: "input" })) };
  };
  const groups: GroupLibraryEntry[] = [
    make("clean", "数据清洗", "删除缺失值后取绝对值，可直接接入读取和导出节点。", ["pandas.dropna", "table.absolute"], [["pandas.dropna", "table.absolute"]], "pandas.dropna", "table.absolute"),
    make("cycle", "周期采样与均值", "反复出现在脉冲、Set/Reset 与循环读取 Notebook 中的窗口抽取和末段均值。", ["table.periodic_window", "table.periodic_tail_mean"], [["table.periodic_window", "table.periodic_tail_mean"]], "table.periodic_window", "table.periodic_tail_mean"),
    make("curve", "实验曲线预处理", "切片、取绝对值并绘制折线图。", ["table.slice", "table.absolute", "plot.line"], [["table.slice", "table.absolute"], ["table.absolute", "plot.line"]], "table.slice", "plot.line"),
  ];
  const pulseGroupId = "builtin-pulse-analysis";
  const segment = createNode(`${pulseGroupId}-segment`, "pulse.segment_measurement", 55, 80);
  const pulseRows = createNode(`${pulseGroupId}-rows`, "pandas.query", 285, 80, { expression: "phase == 'pulse'" });
  const pulsePlot = createNode(`${pulseGroupId}-plot`, "plot.line", 515, 80, { xColumn: "voltage_V", yColumns: "mean_current_A", xLabel: "Pulse voltage (V)", yLabel: "Mean current (A)" });
  [segment, pulseRows, pulsePlot].forEach((node) => { node.data.canvasParentId = pulseGroupId; });
  groups.push({
    id: pulseGroupId, name: "脉冲测量分析", builtIn: true,
    description: "将连续电流记录按脉冲波形分段、筛选写入脉冲并绘制平均 I-V；测量数据与波形均由公开端口输入。",
    nodes: [
      { id: pulseGroupId, type: "workflow", position: { x: 40, y: 40 }, data: { label: "脉冲测量分析", nodeType: "workflow.group", nodeVersion: 1, status: "idle", parameters: { description: "连续测量数据 → 脉冲分段平均 → 脉冲 I-V" }, groupInputs: [{ id: "measurement", label: "测量数据", valueType: "table", internalNodeId: segment.id, internalHandle: "measurement" }, { id: "waveform", label: "脉冲波形", valueType: "table", internalNodeId: segment.id, internalHandle: "waveform" }], groupOutputs: [{ id: "output", label: "脉冲 I-V 图", valueType: "plot", internalNodeId: pulsePlot.id, internalHandle: "output" }] } },
      segment, pulseRows, pulsePlot,
    ],
    edges: [
      { id: `${pulseGroupId}-segment-rows`, source: segment.id, sourceHandle: "output", target: pulseRows.id, targetHandle: "input" },
      { id: `${pulseGroupId}-rows-plot`, source: pulseRows.id, sourceHandle: "output", target: pulsePlot.id, targetHandle: "input" },
    ],
  });
  return groups;
}


function loadRememberedNodeDefaults(nodeType: string): Record<string, string | number | boolean | null> {
  try {
    const all = JSON.parse(localStorage.getItem(NODE_DEFAULTS_KEY) ?? "{}") as Record<string, Record<string, unknown>>;
    const allowed = new Set(getNodeSpec(nodeType)?.parameters.filter((parameter) => parameter.rememberDefault).map((parameter) => parameter.key) ?? []);
    return Object.fromEntries(Object.entries(all[nodeType] ?? {}).filter(([key, value]) => allowed.has(key) && (["string", "number", "boolean"].includes(typeof value) || value === null))) as Record<string, string | number | boolean | null>;
  } catch {
    return {};
  }
}

function groupCatalog(specifications: NodeSpec[] = NODE_CATALOG): Map<NodeSpec["category"], NodeSpec[]> {
  const groups = new Map<NodeSpec["category"], NodeSpec[]>();
  for (const item of specifications) {
    const group = groups.get(item.category) ?? [];
    group.push(item);
    groups.set(item.category, group);
  }
  return groups;
}

function loadNodeGroups(): Record<string, string[]> {
  try {
    const value = JSON.parse(localStorage.getItem(NODE_GROUPS_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter(([, nodeTypes]) => Array.isArray(nodeTypes)).map(([name, nodeTypes]) => [name, (nodeTypes as unknown[]).filter((item): item is string => typeof item === "string")]));
  } catch {
    return {};
  }
}

function downloadTextFile(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeWorkflowFileName(name: string): string {
  const stem = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "pydroid-flow";
  return `${stem}.workflow.json`;
}

function persistSerializedWorkflow(resourceLibrary: EditorResourceLibraryService, json: string, name: string): FlowLibraryEntry {
  downloadTextFile(json, safeWorkflowFileName(name), "application/json");
  return resourceLibrary.addFlowDocument(name, json);
}

function nodesInExecutionOrder(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const ready = nodes.filter((node) => incoming.get(node.id) === 0);
  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();
  while (ready.length) {
    const node = ready.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    ordered.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      const remaining = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) ready.push(byId.get(target)!);
    }
  }
  return [...ordered, ...nodes.filter((node) => !visited.has(node.id))];
}

function hydrateNodeDefaults(node: WorkflowNode): WorkflowNode {
  const spec = getNodeSpec(node.data.nodeType);
  const isStructure = ["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(node.data.nodeType);
  const corruptedLabel = /(?:锟斤拷|�{1,}|\?{3,})/.test(node.data.label);
  return {
    ...node,
    ...(isStructure && !node.style ? { style: { width: 520, height: 300 } } : {}),
    data: {
      ...node.data,
      label: corruptedLabel && spec ? spec.label : node.data.label,
      parameters: { ...(spec?.defaults ?? {}), ...node.data.parameters },
    },
  };
}

const nodeSpecFor = nodeSpecForEditor;

function loadPersonalTemplates(): CustomNodeTemplate[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PERSONAL_TEMPLATES_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CustomNodeTemplate => Boolean(
      item && typeof item.id === "string" && typeof item.label === "string" && typeof item.description === "string" && typeof item.code === "string",
    ));
  } catch {
    return [];
  }
}

function WorkflowNodeCard({ id, data, selected }: NodeProps<WorkflowNode>) {
  const spec = data.nodeType === "workflow.group"
    ? { nodeType: "workflow.group", label: data.label, category: "逻辑控制" as const, defaults: {}, parameters: [], inputPorts: data.groupInputs ?? [], outputPorts: data.groupOutputs ?? [] }
    : data.nodeType === "function.call"
      ? { nodeType: "function.call", label: data.label, category: "自定义" as const, defaults: {}, parameters: [], inputPorts: data.functionInputs ?? [], outputPorts: data.functionOutputs ?? [] }
      : resolveNodeSpec(getNodeSpec(data.nodeType), data.parameters);
  const insight = useContext(NodeInsightContext);
  const nodeResult = insight.results[id];
  const direction = useContext(NodeLayoutContext);
  const { nodeScale, endpointScale } = useContext(NodeAppearanceContext);
  const selection = useContext(NodeSelectionContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const labelLength = Array.from(data.label).length;
  const nodeWidth = (data.nodeType === "workflow.group"
    ? 230
    : direction === "vertical"
      ? Math.min(220, Math.max(154, 96 + labelLength * 12))
      : Math.min(270, Math.max(168, 112 + labelLength * 16))) * nodeScale;
  const isStructure = ["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(data.nodeType);
  useEffect(() => {
    const refresh = () => updateNodeInternals(id);
    refresh();
    const element = document.querySelector<HTMLElement>(`[data-workflow-node-id="${CSS.escape(id)}"]`);
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(refresh);
    observer.observe(element);
    return () => observer.disconnect();
  }, [direction, endpointScale, id, nodeScale, nodeWidth, updateNodeInternals]);
  const inputPorts = spec?.inputPorts ?? [];
  const outputPorts = spec?.outputPorts ?? [];
  return (
    <div style={{ "--node-width": `${isStructure ? 520 : nodeWidth}px`, "--node-scale": nodeScale, "--endpoint-scale": endpointScale } as CSSProperties} data-workflow-node-id={id} className={`workflow-node direction-${direction} ${isStructure ? "workflow-structure" : ""} ${data.nodeType === "logic.if_subflow" ? "workflow-structure--if" : ""} ${inputPorts.length ? "has-inputs" : ""} ${outputPorts.length ? "has-outputs" : ""} status-${data.status ?? "idle"} ${selected ? "selected" : ""}`}>
      {selection.active && <button className={`node-selection-check nodrag nopan ${selected ? "checked" : ""}`} type="button" aria-label={`${selected ? "取消选择" : "选择"}${data.label}`} aria-pressed={selected} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); selection.toggle(id); }}>{selected ? "✓" : ""}</button>}
      {isStructure && <NodeResizer minWidth={360} minHeight={220} isVisible={selected} />}
      {inputPorts.map((port, index) => (
        <div className="input-port" style={Object.assign(direction === "horizontal" ? { top: `${((index + 1) * 100) / (inputPorts.length + 1)}%` } : { left: `${((index + 1) * 100) / (inputPorts.length + 1)}%` }, { "--port-color": VALUE_TYPE_COLORS[port.valueType] }) as CSSProperties} key={port.id}>
          <Handle id={port.id} type="target" position={direction === "horizontal" ? Position.Left : Position.Top} />
          {port.label && <span title={`${port.label} · ${port.valueType}`}>{port.label}<small>{port.valueType}</small></span>}
        </div>
      ))}
      <div className="workflow-node__body">
        <div className="workflow-node__type" title={data.nodeType}>{data.nodeType}</div>
        <div className="workflow-node__label" title={data.label}>{data.label}</div>
        <div className="workflow-node__meta">{data.nodeType === "workflow.group" ? `${data.groupInputs?.length ?? 0} 输入 · ${data.groupOutputs?.length ?? 0} 输出 · 双击操作` : `${spec?.parameters.length ?? 0} 参数${data.tags?.length ? ` · ${data.tags.join(" · ")}` : ""}`}</div>
      </div>
      {isStructure && <div className="workflow-structure__interior">
        {data.nodeType === "logic.if_subflow" ? <><div className="workflow-structure__lane workflow-structure__lane--true"><span>TRUE</span></div><div className="workflow-structure__lane workflow-structure__lane--false"><span>FALSE</span></div></> : <div className="workflow-structure__lane workflow-structure__lane--body"><span>循环体 · 每次迭代的数据由左侧隧道进入</span></div>}
      </div>}
      {outputPorts.map((port, index) => (
        <div className="output-port" style={Object.assign(direction === "horizontal" ? { top: `${((index + 1) * 100) / (outputPorts.length + 1)}%` } : { left: `${((index + 1) * 100) / (outputPorts.length + 1)}%` }, { "--port-color": VALUE_TYPE_COLORS[port.valueType] }) as CSSProperties} key={port.id}>
          {port.label && <span title={`${port.label} · ${port.valueType}`}>{port.label}<small>{port.valueType}</small></span>}
          <Handle id={port.id} type="source" position={direction === "horizontal" ? Position.Right : Position.Bottom} />
        </div>
      ))}
      {insight.visible && nodeResult && <div className={`node-insight node-insight--${nodeResult.kind} ${data.nodeType === "python.print" ? "node-insight--print" : ""}`}>
        {nodeResult.kind === "plot" && <PlotPreview preview={nodeResult} alt={`${data.label} 中间结果`} />}
        {nodeResult.kind === "table" && <><strong>{nodeResult.preview.totalRows}×{nodeResult.preview.totalColumns}</strong><span>{nodeResult.preview.columns.slice(0, 3).join(" · ")}</span></>}
        {nodeResult.kind === "value" && <><strong>{data.nodeType === "python.print" ? "打印结果" : "结果"}</strong><span>{nodeResult.text}</span></>}
      </div>}
    </div>
  );
}

function ParameterField({
  spec,
  value,
  onChange,
  onExpand,
}: {
  spec: ParameterSpec;
  value: string | number | boolean | null | undefined;
  onChange: (value: string | number | boolean | null) => void;
  onExpand?: () => void;
}) {
  const displayValue = value === undefined ? spec.defaultValue : value;
  if (spec.kind === "boolean") {
    return (
      <label className="field field--checkbox">
        <span>{spec.label}</span>
        <span className="switch"><input type="checkbox" checked={Boolean(displayValue)} onChange={(event) => onChange(event.target.checked)} /><i /></span>
      </label>
    );
  }
  if (spec.kind === "select") {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <select
          value={String(displayValue ?? "")}
          onChange={(event) => {
            const option = spec.options?.find((item) => String(item.value) === event.target.value);
            onChange(option?.value ?? event.target.value);
          }}
        >
          {spec.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  if (spec.kind === "textarea") {
    return (
      <label className="field">
        <span className="field__heading">{spec.label}{onExpand && <button type="button" onClick={onExpand}>全屏编辑</button>}</span>
        <textarea
          value={String(displayValue ?? "")}
          placeholder={spec.placeholder}
          required={spec.required}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            const input = event.currentTarget;
            const start = input.selectionStart;
            const next = `${input.value.slice(0, start)}    ${input.value.slice(input.selectionEnd)}`;
            onChange(next);
            window.requestAnimationFrame(() => input.setSelectionRange(start + 4, start + 4));
          }}
          spellCheck={false}
        />
        {spec.description && <small>{spec.description}</small>}
      </label>
    );
  }
  if (spec.kind === "list") {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <input
          type="text"
          value={String(displayValue ?? "")}
          placeholder={spec.placeholder ?? (spec.itemType === "text" ? "a,b,c" : "0,1,2")}
          required={spec.required}
          onChange={(event) => onChange(event.target.value)}
        />
        <small>{spec.description ? `${spec.description} · ` : ""}可输入 JSON 数组或用英文逗号分隔。</small>
      </label>
    );
  }
  if (spec.kind === "number" && spec.control === "slider" && spec.min !== undefined && spec.max !== undefined) {
    const numericValue = Number(displayValue ?? spec.min);
    return (
      <label className="field field--range">
        <span>{spec.label}<output>{numericValue}</output></span>
        <input
          type="range"
          value={numericValue}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {spec.description && <small>{spec.description}</small>}
      </label>
    );
  }
  return (
    <label className="field">
      <span>{spec.label}</span>
      <input
        type={spec.kind === "number" ? "number" : "text"}
        value={String(displayValue ?? "")}
        placeholder={spec.placeholder}
        required={spec.required}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(event) => onChange(spec.kind === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)}
      />
      {spec.description && <small>{spec.description}</small>}
    </label>
  );
}


function agentPermissionFor(operation: AgentOperation): AgentPermission {
  switch (operation.type) {
    case "add_node": return "createNodes";
    case "set_parameter": return "updateParameters";
    case "connect": return "connectNodes";
    case "disconnect": return "disconnectNodes";
    case "group_nodes": return "groupNodes";
    case "arrange": return "arrangeLayout";
    case "delete_node": return "deleteNodes";
    case "run_workflow": return "runWorkflow";
  }
}


function FlowEditor({ session, lifecycle, resourceLibrary, tabName = "工作流 1", onAddTab, themeMode, resolvedTheme, onThemeModeChange }: { session: EditorWorkspaceSession; lifecycle: EditorWorkspaceLifecycleService; resourceLibrary: EditorResourceLibraryService; tabName?: string; onAddTab: () => void; themeMode: ThemeMode; resolvedTheme: "dark" | "light"; onThemeModeChange: (mode: ThemeMode) => void }) {
  const tabId = session.id;
  const workspaceIdentity = session.identity;
  const executionClientId = workspaceIdentity.clientId;
  const remoteBrowser = workspaceIdentity.source === "remote";
  const initialRuntimeState = session.getRuntimeState();
  const startingSnapshot = initialRuntimeState.snapshot ?? { nodes: initialNodes, edges: initialEdges, functions: [], requirements: [] };
  const restoredExecutionStatus = getExecutionStatus(workspaceIdentity);
  const restoredExecutionResult = getWorkspaceExecutionResult(workspaceIdentity);
  const restoredCompletedNodes = new Set(restoredExecutionResult?.executionOrder ?? (restoredExecutionResult ? startingSnapshot.nodes.map((node) => node.id) : []));
  const reactFlow = useReactFlow<WorkflowNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const {
    nodes, setNodes, onNodesChange, edges, setEdges, onEdgesChange, functions, requirements,
    input, setFileName, setCsvText, setCsvBytes, setCsvFiles,
    primaryNodeId: selectedId, setPrimaryNodeId: setSelectedId,
    selectedNodeIds: selectedIds, setSelectedNodeIds: setSelectedIds,
    selectionMode, setSelectionMode, currentCanvasId, setCurrentCanvasId,
  } = useEditorWorkspaceSession(session);
  const { fileName, csvText, csvBytes, csvFiles } = input;
  const [touchMarquee, setTouchMarquee] = useState<{ pointerId: number; startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [pointerMode, setPointerMode] = useState<"mouse" | "touch">(() => window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse");
  const [paletteDragPreview, setPaletteDragPreview] = useState<{ kind: PaletteResource["kind"]; label: string; x: number; y: number; overCanvas: boolean } | null>(null);
  const [message, setMessage] = useState(() => ["queued", "running", "cancelling"].includes(restoredExecutionStatus.phase) ? "当前工作区正在后台执行" : restoredExecutionResult ? `执行完成 · ${restoredExecutionResult.runtimeId === "javascript" ? "JS" : "Python"}：${restoredExecutionResult.preview.totalRows} 行 × ${restoredExecutionResult.preview.totalColumns} 列` : "尚未执行");
  const [result, setResult] = useState<ExecutionResult | null>(restoredExecutionResult);
  const clearExecutionResult = () => { setResult(null); clearWorkspaceExecutionResult(workspaceIdentity); };
  const restoredStatusApplied = useRef(false);
  useEffect(() => {
    if (restoredStatusApplied.current) return;
    restoredStatusApplied.current = true;
    setNodes((current) => current.map((node) => ({
      ...node,
      data: {
        ...node.data,
        status: ["queued", "running", "cancelling"].includes(restoredExecutionStatus.phase)
          ? "running"
          : restoredExecutionResult && restoredCompletedNodes.has(node.id)
            ? "success"
            : node.data.status === "error" ? "error" : "idle",
      },
    })));
  }, [restoredExecutionResult, restoredExecutionStatus.phase, setNodes]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null);
  const [flowMenu, setFlowMenu] = useState<FlowMenuState | null>(null);
  const [resourceMenu, setResourceMenu] = useState<ResourceMenuState | null>(null);
  const [renameFlow, setRenameFlow] = useState<FlowLibraryEntry | null>(null);
  const [renameFlowValue, setRenameFlowValue] = useState("");
  const [personalTemplates, setPersonalTemplates] = useState<CustomNodeTemplate[]>(loadPersonalTemplates);
  const [templateName, setTemplateName] = useState("");
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [runtimePreference, setRuntimePreference] = useState<RuntimePreference>(() => loadAppSettings().runtimePreference);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(() => loadAppSettings().agent);
  const [agentApiKey, setAgentApiKey] = useState("");
  const [remoteAgentProxyAvailable, setRemoteAgentProxyAvailable] = useState(false);
  const [agentSecretReady, setAgentSecretReady] = useState(() => !isNativePlatform() && !isRemoteRuntime());
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentRequesting, setAgentRequesting] = useState(false);
  const [agentConnectionStatus, setAgentConnectionStatus] = useState<string | null>(null);
  const [agentTesting, setAgentTesting] = useState(false);
  const [language, setLanguage] = useState<"zh-CN" | "en">(() => loadAppSettings().agent.language);
  const ui = (zh: string, en: string) => language === "en" ? en : zh;
  const [agentPlanText, setAgentPlanText] = useState("");
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentPlanError, setAgentPlanError] = useState<string | null>(null);
  const [agentAudit, setAgentAudit] = useState<Array<{ at: string; summary: string; result: string }>>([]);
  const setThemeMode = onThemeModeChange;
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [hostTaskMenuOpen, setHostTaskMenuOpen] = useState(false);
  const [newWorkflowDialogOpen, setNewWorkflowDialogOpen] = useState(false);
  const [replaceCurrentUnsavedOpen, setReplaceCurrentUnsavedOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; danger?: boolean; resolve: (confirmed: boolean) => void } | null>(null);
  const [textPromptDialog, setTextPromptDialog] = useState<{ title: string; label: string; value: string; confirmLabel?: string; resolve: (value: string | null) => void } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  const [inspectorDock, setInspectorDock] = useState<"right" | "bottom">(() =>
    isNativePlatform() && window.matchMedia("(orientation: portrait)").matches ? "bottom" : "right",
  );
  const previousPortrait = useRef(isPortrait);
  const [plotExpandedPreview, setPlotExpandedPreview] = useState<Extract<NodeExecutionPreview, { kind: "plot" }> | null>(null);
  const [plotZoom, setPlotZoom] = useState(1);
  const [livePreview, setLivePreview] = useState(false);
  const [executionLifecycle, setExecutionLifecycle] = useState(() => restoredExecutionStatus);
  const [hostExecutionLifecycle, setHostExecutionLifecycle] = useState<HostExecutionStatus>(() => emptyHostExecutionStatus(isNativePlatform() ? 1 : 4));
  const localExecutionActive = ["queued", "running", "cancelling"].includes(executionLifecycle.phase);
  const currentHostExecution = hostExecutionLifecycle.executions.find((entry) => matchesHostExecution(workspaceIdentity, entry)) ?? null;
  const otherHostExecutions = hostExecutionLifecycle.executions.filter((entry) => entry.executionId !== currentHostExecution?.executionId);
  const isRunning = localExecutionActive || Boolean(currentHostExecution);
  const visibleExecutionId = executionLifecycle.executionId ?? currentHostExecution?.executionId ?? null;
  useEffect(() => subscribeExecutionStatus(workspaceIdentity, setExecutionLifecycle), [workspaceIdentity.key]);
  const [resultDock, setResultDock] = useState<"right" | "bottom">("right");
  const [inspectorWidth, setInspectorWidth] = useState(() => loadAppSettings().inspectorWidth);
  const [inspectorHeight, setInspectorHeight] = useState(() => loadAppSettings().inspectorHeight);
  const [paletteWidth, setPaletteWidth] = useState(() => loadAppSettings().paletteWidth);
  const [resultHeight, setResultHeight] = useState(() => loadAppSettings().resultHeight);
  const [nodeScale, setNodeScale] = useState(() => loadAppSettings().nodeScale);
  const [endpointScale, setEndpointScale] = useState(() => loadAppSettings().endpointScale);
  const [edgeWidth, setEdgeWidth] = useState(() => loadAppSettings().edgeWidth);
  const [nodeSearch, setNodeSearch] = useState("");
  const [paletteTab, setPaletteTab] = useState<"nodes" | "groups" | "functions" | "flows">("nodes");
  const resourceLibraryState = useSyncExternalStore(resourceLibrary.subscribe, resourceLibrary.getState, resourceLibrary.getState);
  const groupLibrary = resourceLibraryState.groups;
  const savedNodeLibrary = resourceLibraryState.savedNodes;
  const flowLibrary = resourceLibraryState.flows;
  const [savedNodeDragOverId, setSavedNodeDragOverId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileInfo | null>(null);
  const [showNodeInsights, setShowNodeInsights] = useState(() => loadAppSettings().showNodeInsights);
  const [debugMode, setDebugMode] = useState(() => loadAppSettings().debugMode);
  const [automatedDiagnosticsEnabled, setAutomatedDiagnosticsEnabled] = useState(() => loadAppSettings().automatedDiagnosticsEnabled);
  const [automatedDiagnosticsOpen, setAutomatedDiagnosticsOpen] = useState(false);
  const [automatedDiagnosticsRunning, setAutomatedDiagnosticsRunning] = useState(false);
  const [automatedDiagnosticsReport, setAutomatedDiagnosticsReport] = useState<AutomatedDiagnosticReport | null>(null);
  const [automatedDiagnosticsExportStatus, setAutomatedDiagnosticsExportStatus] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugBreakpoints, setDebugBreakpoints] = useState<Set<string>>(() => new Set());
  const [debugPausedAt, setDebugPausedAt] = useState<string | null>(null);
  const [customGroups, setCustomGroups] = useState<Record<string, string[]>>(loadNodeGroups);
  const [groupName, setGroupName] = useState("");
  const [viewMode, setViewMode] = useState<"nodes" | "notebook">("nodes");
  const [notebookCells, setNotebookCells] = useState<NotebookCell[]>([]);
  const [notebookMetadata, setNotebookMetadata] = useState<Record<string, unknown>>({});
  const [notebookError, setNotebookError] = useState<string | null>(null);
  const [resultDetail, setResultDetail] = useState<{ title: string; text: string; preview?: TablePreview } | null>(null);
  const [executionError, setExecutionError] = useState<{ title: string; message: string; nodeId?: string; nodeType?: string; traceback?: string | null } | null>(null);
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);
  const [notebookCellResults, setNotebookCellResults] = useState<Record<string, NodeExecutionPreview>>({});
  const [notebookRunningCell, setNotebookRunningCell] = useState<number | "all" | null>(null);
  const [packageManagerOpen, setPackageManagerOpen] = useState(false);
  const [packageRequirement, setPackageRequirement] = useState("");
  const [workspaceVariableRevision, setWorkspaceVariableRevision] = useState(0);
  const [pythonEnvironment, setPythonEnvironment] = useState<PythonEnvironment | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"auto" | "horizontal" | "vertical">(() => {
    const saved = localStorage.getItem(LAYOUT_MODE_KEY);
    return saved === "horizontal" || saved === "vertical" || saved === "auto" ? saved : loadAppSettings().layoutMode;
  });
  const [miniMapMode, setMiniMapMode] = useState<"auto" | "show" | "hide">(() => {
    const saved = localStorage.getItem(MINIMAP_MODE_KEY);
    return saved === "show" || saved === "hide" ? saved : loadAppSettings().miniMapMode;
  });
  const [replacementOpen, setReplacementOpen] = useState(false);
  const [replacementShowAll, setReplacementShowAll] = useState(false);
  const [replacementSearch, setReplacementSearch] = useState("");
  const [remoteServer, setRemoteServer] = useState<RemoteServerInfo | null>(null);
  const [remoteBannerVisible, setRemoteBannerVisible] = useState(false);
  const [remoteAccessDialog, setRemoteAccessDialog] = useState(false);
  const [remoteRequirePin, setRemoteRequirePin] = useState(true);
  const [remoteAccessPolicy, setRemoteAccessPolicy] = useState<RemoteAccessPolicy | null>(null);
  const [remotePaired, setRemotePaired] = useState(false);
  const [remoteAccessError, setRemoteAccessError] = useState<string | null>(null);
  useEffect(() => {
    if (remoteBrowser && !remotePaired) {
      setHostExecutionLifecycle(emptyHostExecutionStatus());
      return;
    }
    let stopped = false;
    const refresh = async () => {
      const status = await getHostExecutionStatus().catch(() => emptyHostExecutionStatus(isNativePlatform() ? 1 : 4));
      if (!stopped) setHostExecutionLifecycle(status);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 400);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [remoteBrowser, remotePaired]);
  const [remotePinInput, setRemotePinInput] = useState("");
  const [lastRunDurationMs, setLastRunDurationMs] = useState<number | null>(null);
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [smbOpen, setSmbOpen] = useState(false);
  const [smbConnection, setSmbConnection] = useState<SmbConnection>(() => ({ ...loadAppSettings().smb, password: "" }));
  const [smbRememberPassword, setSmbRememberPassword] = useState(() => loadAppSettings().smb.rememberPassword);
  const [smbGuest, setSmbGuest] = useState(() => loadAppSettings().smb.guest);
  const [smbPasswordVisible, setSmbPasswordVisible] = useState(false);
  const [smbScannedShares, setSmbScannedShares] = useState<string[]>([]);
  const [smbServers, setSmbServers] = useState<SmbServer[]>([]);
  const [smbPath, setSmbPath] = useState("");
  const [smbEntries, setSmbEntries] = useState<SmbEntry[]>([]);
  const [smbSelected, setSmbSelected] = useState<string[]>([]);
  const [smbLoading, setSmbLoading] = useState(false);
  const [smbError, setSmbError] = useState<string | null>(null);
  const [inputDialogNode, setInputDialogNode] = useState<WorkflowNode | null>(null);
  const [inputDialogValue, setInputDialogValue] = useState("");
  const [alertDialogNode, setAlertDialogNode] = useState<WorkflowNode | null>(null);
  const [alertDialogPreview, setAlertDialogPreview] = useState<NodeExecutionPreview | undefined>(undefined);
  const interactiveRunContext = useRef<{ nodes: WorkflowNode[]; edges: Edge[]; completed: Set<string> } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const workflowInput = useRef<HTMLInputElement>(null);
  const notebookInput = useRef<HTMLInputElement>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const settingsInput = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number; thresholdPx: number } | null>(null);
  const touchMarqueeTimer = useRef<number | null>(null);
  const touchMarqueeCandidate = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    panning: boolean;
    marquee: boolean;
    viewport: { x: number; y: number; zoom: number };
  } | null>(null);
  const activeCanvasTouches = useRef(new Map<number, { x: number; y: number }>());
  const touchPinch = useRef<{
    pointerIds: [number, number];
    startDistance: number;
    startZoom: number;
    anchorFlowX: number;
    anchorFlowY: number;
  } | null>(null);
  const canvasPanelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const releaseTouch = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      activeCanvasTouches.current.delete(event.pointerId);
      if (touchPinch.current?.pointerIds.includes(event.pointerId)) {
        touchPinch.current = null;
        if (touchMarqueeTimer.current !== null) window.clearTimeout(touchMarqueeTimer.current);
        touchMarqueeTimer.current = null;
        touchMarqueeCandidate.current = null;
        setTouchMarquee(null);
      }
    };
    const clearTouches = () => {
      activeCanvasTouches.current.clear();
      touchPinch.current = null;
      touchMarqueeCandidate.current = null;
    };
    window.addEventListener("pointerup", releaseTouch);
    window.addEventListener("pointercancel", releaseTouch);
    window.addEventListener("blur", clearTouches);
    return () => {
      window.removeEventListener("pointerup", releaseTouch);
      window.removeEventListener("pointercancel", releaseTouch);
      window.removeEventListener("blur", clearTouches);
    };
  }, []);
  const livePreviewTimer = useRef<number | null>(null);
  const applyingRemoteConfiguration = useRef(false);
  const touchPaletteDrag = useRef<{ resource: PaletteResource; pointerId: number; startX: number; startY: number; element: HTMLButtonElement; armed: boolean; moved: boolean; pointerType: string } | null>(null);
  const paletteResourceMenuTimer = useRef<number | null>(null);
  const paletteResourceClickTimer = useRef<number | null>(null);
  const paletteResourceMenuHold = useRef<{ pointerId: number; resource: PaletteResource; startX: number; startY: number; moved: boolean } | null>(null);
  const paletteTouchTap = useRef<{ key: string; at: number; x: number; y: number } | null>(null);
  const nodeTouchDragSuppressMenuUntil = useRef(0);
  const reconnectSucceeded = useRef(false);
  const paletteDragTimer = useRef<number | null>(null);
  const desktopPaletteDragElement = useRef<HTMLButtonElement | null>(null);
  const desktopDragImageElement = useRef<HTMLImageElement | null>(null);
  const palettePointerDragHandled = useRef(false);
  const suppressNextNodeClick = useRef(false);
  const nextNodeNumber = useRef(1);
  const nodeTypes = useMemo(() => ({ workflow: WorkflowNodeCard }), []);
  const edgeTypes = useMemo(() => ({ typed: TypedGradientEdge }), []);
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const selectedFunctionDefinition = selectedNode?.data.nodeType === "function.call"
    ? functions.find((definition) => definition.id === String(selectedNode.data.parameters.functionId ?? "")) ?? null
    : selectedNode?.data.nodeType === "workflow.group" && selectedNode.data.functionSourceId
      ? functions.find((definition) => definition.id === selectedNode.data.functionSourceId) ?? null
      : null;
  const workspaceVariableNames = useMemo(() => listWorkspaceVariableNames(workspaceIdentity), [tabId, workspaceVariableRevision, result]);
  const selectedSpec = nodeSpecFor(selectedNode ?? undefined);
  const selectedContract = selectedNode ? getNodeContract(selectedNode.data.nodeType) : undefined;
  const selectedNodeResult = selectedNode ? result?.nodeResults[selectedNode.id] ?? (selectedNode.data.nodeType === "workflow.group" ? result?.nodeResults[selectedNode.data.groupOutputs?.[0]?.internalNodeId ?? ""] : undefined) : undefined;
  const alertInputSourceId = alertDialogNode ? edges.find((edge) => edge.target === alertDialogNode.id && edge.targetHandle === "content")?.source : undefined;
  const alertInputSource = alertInputSourceId ? nodes.find((node) => node.id === alertInputSourceId) : undefined;
  const alertInputValue = alertInputSource?.data.nodeType === "ui.input_dialog" ? String(alertInputSource.data.parameters.value ?? "") : "";
  const alertInputPreview: NodeExecutionPreview | undefined = alertDialogPreview ?? (alertInputValue ? alertInputValue.startsWith("data:image/") ? { kind: "plot", plotPngBase64: alertInputValue.split(",", 2)[1] ?? "" } : { kind: "value", text: alertInputValue } : undefined);
  const selectedSignature = selectedNode?.data.nodeType === "custom.python_function"
    ? parsePythonFunctionSignature(String(selectedNode.data.parameters.code ?? ""))
    : undefined;
  const selectedSignatureError = selectedSignature?.error;
  const [remoteSignature, setRemoteSignature] = useState<PythonSignatureAnalysis | null>(null);
  const customNodeCode = selectedNode?.data.nodeType === "custom.python_function" ? String(selectedNode.data.parameters.code ?? "") : null;
  useEffect(() => {
    if (!customNodeCode) { setRemoteSignature(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      analyzePythonSignature(customNodeCode)
        .then((analysis) => { if (!cancelled) setRemoteSignature(analysis); })
        .catch(() => { if (!cancelled) setRemoteSignature({ inputPorts: [], outputPorts: [], parameters: [], error: "unavailable" }); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [customNodeCode]);
  const remoteSignatureError = remoteSignature?.error;
  const authoritativeSignatureError = remoteSignature && remoteSignatureError !== "unavailable" ? (remoteSignatureError ?? undefined) : selectedSignatureError;
  const signatureSummary = remoteSignature && remoteSignatureError !== "unavailable" && !remoteSignatureError
    ? `${remoteSignature.inputPorts.length} 输入 · ${remoteSignature.outputPorts.length} 输出 · 后端已校验`
    : `${selectedSignature?.inputPorts.length ?? 0} 输入 · ${selectedSignature?.outputPorts.length ?? 0} 输出`;
  const matchedCatalog = useMemo(() => searchNodeCatalog(nodeSearch).filter((spec) => !spec.nodeType.startsWith("notebook.")), [nodeSearch]);
  const catalogGroups = useMemo(() => groupCatalog(matchedCatalog), [matchedCatalog]);
  const customTemplates = useMemo(() => [...CUSTOM_NODE_TEMPLATES, ...personalTemplates], [personalTemplates]);
  const autoShowMiniMap = viewportWidth >= 900 && nodes.length >= 6 && !inspectorCollapsed;
  const showMiniMap = miniMapMode === "show" || (miniMapMode === "auto" && autoShowMiniMap);
  const finePointer = useMemo(() => window.matchMedia("(any-pointer: fine)").matches, []);
  const resolvedLayoutDirection: "horizontal" | "vertical" = layoutMode === "auto" ? (viewportWidth < 760 ? "vertical" : "horizontal") : layoutMode;
  const previousAutoDirection = useRef(resolvedLayoutDirection);
  const initialLayoutPending = useRef(true);
  const visibleNodes = useMemo(() => nodes.filter((node) => (node.data.canvasParentId ?? null) === currentCanvasId), [currentCanvasId, nodes]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const refreshVisibleNodeGeometry = useCallback(() => {
    const ids = visibleNodes.map((node) => node.id);
    if (!ids.length) return;
    window.requestAnimationFrame(() => {
      updateNodeInternals(ids);
      window.setTimeout(() => updateNodeInternals(ids), 80);
    });
  }, [updateNodeInternals, visibleNodes]);
  useEffect(() => refreshVisibleNodeGeometry(), [refreshVisibleNodeGeometry, resolvedLayoutDirection, nodeScale]);
  // Always render saved and newly-created edges with the same continuous route.
  // Older workflows may carry a persisted smoothstep type, which creates a
  // conspicuous sideways dogleg when vertically stacked node centres differ by
  // only a few pixels.
  // 框选/多选期间保留连线（1.4.8 曾整体隐藏导致"点击组合后连线消失"的困惑）。
  const visibleEdges = useMemo(() => edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .map((edge) => {
      const source = nodes.find((node) => node.id === edge.source);
      const target = nodes.find((node) => node.id === edge.target);
      const output = nodeSpecFor(source)?.outputPorts.find((port) => port.id === (edge.sourceHandle ?? "output"));
      const input = nodeSpecFor(target)?.inputPorts.find((port) => port.id === (edge.targetHandle ?? "input"));
      return { ...edge, type: "typed", data: { ...edge.data, sourceColor: VALUE_TYPE_COLORS[output?.valueType ?? "any"], targetColor: VALUE_TYPE_COLORS[input?.valueType ?? "any"] } };
    }), [edges, nodes, selectionMode, visibleNodeIds]);
  const toggleNodeSelection = useCallback((nodeId: string) => {
    const nextIds = new Set(selectedIds);
    if (nextIds.has(nodeId)) nextIds.delete(nodeId); else nextIds.add(nodeId);
    const nextIdList = [...nextIds];
    setSelectedIds(nextIdList);
    setSelectedId(nextIdList.length === 1 ? nextIdList[0] : null);
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, selected: nextIds.has(nodeId) } : node));
  }, [selectedIds, setNodes]);

  const deleteNodes = useCallback((initialIds: Iterable<string>) => {
    const nodeIds = [...new Set(initialIds)];
    const result = session.applyGraphCommand({ type: "delete-nodes", nodeIds });
    if (!result.changed) return;
    const remaining = new Set(result.snapshot.nodes.map((node) => node.id));
    setSelectedId(null);
    setSelectedIds((current) => current.filter((id) => remaining.has(id)));
    clearExecutionResult();
    setMessage(`已删除 ${result.affectedCount} 个节点及其连线`);
  }, [session, setSelectedId, setSelectedIds]);
  const disconnectNodes = useCallback((nodeIds: Iterable<string>) => {
    const ids = [...new Set(nodeIds)];
    if (!ids.length) return;
    const result = session.applyGraphCommand({ type: "disconnect-nodes", nodeIds: ids });
    if (!result.changed) return;
    clearExecutionResult();
    setMessage(`已断开 ${ids.length} 个选中节点的连线`);
  }, [session]);
  const disconnectEdges = useCallback((edgeIds: Iterable<string>) => {
    const ids = [...new Set(edgeIds)];
    if (!ids.length) return;
    const result = session.applyGraphCommand({ type: "disconnect-edges", edgeIds: ids });
    if (!result.changed) return;
    clearExecutionResult();
    setMessage(`已断开 ${result.affectedCount} 条连线`);
  }, [session]);
  const canvasTrail = useMemo(() => {
    const trail: WorkflowNode[] = [];
    let cursor = currentCanvasId;
    while (cursor) {
      const group = nodes.find((node) => node.id === cursor);
      if (!group) break;
      trail.unshift(group);
      cursor = group.data.canvasParentId ?? null;
    }
    return trail;
  }, [currentCanvasId, nodes]);

  const undo = () => {
    if (!session.undo()) return;
    clearExecutionResult();
    setMessage("已撤销上一步");
  };

  const redo = () => {
    if (!session.redo()) return;
    clearExecutionResult();
    setMessage("已重做上一步");
  };

  const restoreHistoryAt = (index: number) => {
    if (!session.restoreHistoryAt(index)) return;
    clearExecutionResult();
    setHistoryOpen(false);
    setMessage("已恢复所选历史版本；可使用重做返回恢复前状态");
  };

  const clearHistory = () => {
    session.clearHistory();
    setMessage("历史记录已清空");
  };

  const replaceWorkflowContent = (snapshot: WorkflowSnapshot, options: { captureHistory?: boolean; markSaved?: boolean } = {}) => {
    session.replaceSnapshot(snapshot, { captureHistory: options.captureHistory ?? true, resetView: true, markSaved: options.markSaved ?? false });
    clearExecutionResult();
  };

  const prepareImportedWorkflow = (document: WorkflowSnapshot): WorkflowSnapshot => {
    const repairedNodes = repairWorkflowGroupInterfaces(normalizeNodePositions(document.nodes).map((node) => {
      const hydrated = hydrateNodeDefaults(node);
      return { ...hydrated, type: "workflow", data: { ...hydrated.data, status: "idle" as const } };
    }), document.edges);
    return {
      nodes: compactNodeLayout(repairedNodes, viewportWidth, resolvedLayoutDirection, document.edges),
      edges: document.edges,
      functions: document.functions ?? [],
      requirements: document.requirements ?? [],
    };
  };

  const autosaveErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = lifecycle.writeAutosave(tabId, session.getRuntimeState().snapshot);
      if (saved.ok === false) {
        const message = saved.reason === "quota" ? "自动保存空间不足，请导出工作流后清理浏览器存储" : `自动保存失败：${saved.message}`;
        if (autosaveErrorRef.current !== message) { autosaveErrorRef.current = message; setMessage(message); }
      } else {
        autosaveErrorRef.current = null;
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [lifecycle, session, tabId, nodes, edges, functions, requirements]);


  useEffect(() => {
    localStorage.setItem(LAYOUT_MODE_KEY, layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    localStorage.setItem(MINIMAP_MODE_KEY, miniMapMode);
  }, [miniMapMode]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    setExecutionRuntimePreference(runtimePreference);
  }, [runtimePreference]);

  useEffect(() => {
    const settings = { themeMode, runtimePreference, paletteWidth, inspectorWidth, inspectorHeight, resultHeight, nodeScale, endpointScale, edgeWidth, showNodeInsights, debugMode, automatedDiagnosticsEnabled, miniMapMode, layoutMode, smb: { server: smbConnection.server, share: smbConnection.share, domain: smbConnection.domain, username: smbConnection.username, rememberPassword: smbRememberPassword, guest: smbGuest }, agent: agentSettings } satisfies AppSettings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (remoteBrowser && agentSecretReady) {
      if (applyingRemoteConfiguration.current) applyingRemoteConfiguration.current = false;
      else localStorage.setItem(REMOTE_CONFIGURATION_OVERRIDE_KEY, "1");
    }
    void saveUserProfileFile("settings/app-settings.json", JSON.stringify(settings, null, 2));
    void saveUserProfileFile("settings/agent.json", JSON.stringify(agentSettings, null, 2));
  }, [themeMode, runtimePreference, paletteWidth, inspectorWidth, inspectorHeight, resultHeight, nodeScale, endpointScale, edgeWidth, showNodeInsights, debugMode, automatedDiagnosticsEnabled, miniMapMode, layoutMode, smbConnection.server, smbConnection.share, smbConnection.domain, smbConnection.username, smbRememberPassword, smbGuest, agentSettings, agentSecretReady, remoteBrowser]);

  useEffect(() => {
    if (remoteBrowser) return;
    let active = true;
    void loadSmbSecret().then((password) => { if (active && loadAppSettings().smb.rememberPassword) setSmbConnection((current) => ({ ...current, password })); }).catch(() => undefined);
    return () => { active = false; };
  }, [remoteBrowser]);

  useEffect(() => {
    if (remoteBrowser) return;
    void saveSmbSecret(smbRememberPassword && !smbGuest ? smbConnection.password : "");
  }, [smbConnection.password, smbRememberPassword, smbGuest, remoteBrowser]);

  useEffect(() => {
    if (!isNativePlatform() || remoteBrowser) return;
    let active = true;
    void loadAgentSecret().then((secret) => {
      if (active) setAgentApiKey(secret);
    }).catch(() => {
      if (active) setMessage("无法读取已加密的 AI 密钥");
    }).finally(() => { if (active) setAgentSecretReady(true); });
    return () => { active = false; };
  }, [remoteBrowser]);

  useEffect(() => {
    if (!agentSecretReady || !isNativePlatform() || remoteBrowser) return;
    void saveAgentSecret(agentApiKey).catch(() => setMessage("无法保存已加密的 AI 密钥"));
  }, [agentApiKey, agentSecretReady, remoteBrowser]);

  useEffect(() => {
    if (!agentAudit.length) return;
    void saveUserProfileFile("logs/agent-audit.json", JSON.stringify(agentAudit, null, 2));
  }, [agentAudit]);

  useEffect(() => {
    if (layoutMode !== "auto" || previousAutoDirection.current === resolvedLayoutDirection) return;
    previousAutoDirection.current = resolvedLayoutDirection;
    session.applyGraphCommand(
      { type: "arrange-canvas", canvasId: currentCanvasId, viewportWidth, direction: resolvedLayoutDirection },
      { captureHistory: false },
    );
    setMessage(`画布已自动切换为${resolvedLayoutDirection === "vertical" ? "纵向" : "横向"}布局`);
  }, [currentCanvasId, layoutMode, resolvedLayoutDirection, session, viewportWidth]);

  useEffect(() => {
    localStorage.setItem(PERSONAL_TEMPLATES_KEY, JSON.stringify(personalTemplates));
    void saveUserProfileFile("user-code/templates.json", JSON.stringify(personalTemplates, null, 2));
  }, [personalTemplates]);

  useEffect(() => {
    localStorage.setItem(NODE_GROUPS_KEY, JSON.stringify(customGroups));
  }, [customGroups]);

  const refreshExternalWorkflowLibrary = useCallback(async () => {
    try {
      const [profile, entries] = await Promise.all([getUserProfileInfo(), listWorkflowLibrary()]);
      setUserProfile(profile);
      resourceLibrary.mergeExternalFlows(entries);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取用户流程文件夹"); }
  }, [resourceLibrary]);

  useEffect(() => { void refreshExternalWorkflowLibrary(); }, [refreshExternalWorkflowLibrary]);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (previousPortrait.current === isPortrait) return;
    previousPortrait.current = isPortrait;
    if (isNativePlatform()) setInspectorDock(isPortrait ? "bottom" : "right");
  }, [isPortrait]);

  useEffect(() => {
    if (!initialLayoutPending.current) return;
    // Let React Flow measure the first cards, then lay out the starter graph in its
    // vertical default. fitView subsequently chooses a readable zoom for the screen.
    const timer = window.setTimeout(() => {
      initialLayoutPending.current = false;
      session.applyGraphCommand({ type: "arrange-canvas", canvasId: currentCanvasId, viewportWidth, direction: "vertical" }, { captureHistory: false });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [currentCanvasId, session, viewportWidth]);

  useEffect(() => () => {
    if (livePreviewTimer.current !== null) window.clearTimeout(livePreviewTimer.current);
  }, []);

  useEffect(() => {
    if (remoteBrowser && !remotePaired) { setMemoryMb(null); return; }
    let active = true;
    warmUpExecutionRuntime(runtimePreference, nodes, functions)
      .then((runtime) => {
        if (active) setMessage((current) => current === "尚未执行" ? `${runtime.label} 已就绪` : current);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? `运行时初始化失败：${error.message}` : "运行时初始化失败");
      });
    return () => { active = false; };
  }, [remoteBrowser, remotePaired, runtimePreference]);

  useEffect(() => {
    if (!remoteBrowser) return;
    let active = true;
    getRemoteAccessPolicy()
      .then(async (policy) => {
        if (!active) return;
        setRemoteAccessPolicy(policy);
        if (!policy.requiresPin) {
          await pairRemoteRuntime();
          if (active) { setRemotePaired(true); setMessage("已连接 Android 计算服务"); }
        }
      })
      .catch((error) => { if (active) setRemoteAccessError(error instanceof Error ? error.message : "无法连接 Android 计算服务"); });
    return () => { active = false; };
  }, [remoteBrowser, remotePaired]);

  useEffect(() => {
    if (!remoteBrowser || !remotePaired || localStorage.getItem(REMOTE_CONFIGURATION_OVERRIDE_KEY) === "1") return;
    let active = true;
    void getRemoteAppConfiguration().then((configuration) => {
      if (!active) return;
      const remote = configuration.settings as Partial<AppSettings>;
      applyingRemoteConfiguration.current = true;
      if (remote.themeMode === "system" || remote.themeMode === "dark" || remote.themeMode === "light") setThemeMode(remote.themeMode);
      if (remote.runtimePreference === "auto" || remote.runtimePreference === "python" || remote.runtimePreference === "javascript") setRuntimePreference(remote.runtimePreference);
      if (Number.isFinite(remote.paletteWidth)) setPaletteWidth(Math.min(360, Math.max(PALETTE_MIN_WIDTH, Number(remote.paletteWidth))));
      if (Number.isFinite(remote.inspectorWidth)) setInspectorWidth(Math.min(560, Math.max(250, Number(remote.inspectorWidth))));
      if (Number.isFinite(remote.inspectorHeight)) setInspectorHeight(Math.min(440, Math.max(140, Number(remote.inspectorHeight))));
      if (Number.isFinite(remote.resultHeight)) setResultHeight(Math.min(520, Math.max(180, Number(remote.resultHeight))));
      if (Number.isFinite(remote.nodeScale)) setNodeScale(Math.min(1.4, Math.max(0.75, Number(remote.nodeScale))));
      if (Number.isFinite(remote.endpointScale)) setEndpointScale(Math.min(1.8, Math.max(0.7, Number(remote.endpointScale))));
      if (Number.isFinite(remote.edgeWidth)) setEdgeWidth(Math.min(5, Math.max(1, Number(remote.edgeWidth))));
      if (typeof remote.showNodeInsights === "boolean") setShowNodeInsights(remote.showNodeInsights);
      if (remote.miniMapMode === "auto" || remote.miniMapMode === "show" || remote.miniMapMode === "hide") setMiniMapMode(remote.miniMapMode);
      if (remote.layoutMode === "auto" || remote.layoutMode === "horizontal" || remote.layoutMode === "vertical") setLayoutMode(remote.layoutMode);
      if (remote.agent) setAgentSettings(loadAgentSettings(remote.agent));
      setRemoteAgentProxyAvailable(Boolean(configuration.agentProxyAvailable));
      if (configuration.agentProxyAvailable) setAgentApiKey("");
      setAgentSecretReady(true);
      setMessage(configuration.agentProxyAvailable ? "已采用宿主配置；AI 密钥由宿主安全代理持有" : "已采用宿主配置；网页修改后将仅保存到此浏览器");
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "无法同步 Android 配置"); });
    return () => { active = false; };
  }, [remoteBrowser, remotePaired]);

  useEffect(() => {
    let active = true;
    const refresh = () => { void getRuntimeStats().then((stats) => { if (active) setMemoryMb(stats.memoryBytes === null ? null : stats.memoryBytes / 1024 / 1024); }).catch(() => { if (active) setMemoryMb(null); }); };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [remoteBrowser]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        setContextMenu(null);
        setSelectionMenu(null);
        setFlowMenu(null);
        setResourceMenu(null);
        setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
        setSelectedId(null);
        setSelectedIds([]);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.length) {
          event.preventDefault();
          deleteNodes(selectedIds);
          return;
        }
        const selectedEdgeIds = edges.filter((edge) => edge.selected).map((edge) => edge.id);
        if (selectedEdgeIds.length) {
          event.preventDefault();
          disconnectEdges(selectedEdgeIds);
          return;
        }
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "a" && viewMode === "nodes") {
        event.preventDefault();
        const ids = visibleNodes.map((node) => node.id);
        setNodes((current) => current.map((node) => ({ ...node, selected: ids.includes(node.id) })));
        setSelectedIds(ids);
        setSelectedId(ids.length === 1 ? ids[0] : null);
      } else if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteNodes, disconnectEdges, edges, selectedIds, setNodes, viewMode, visibleNodes]);

  useEffect(() => {
    if (!contextMenu && !selectionMenu && !flowMenu && !resourceMenu) return;
    const close = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".context-menu")) return;
      setContextMenu(null);
      setSelectionMenu(null);
      setFlowMenu(null);
      setResourceMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [contextMenu, selectionMenu, flowMenu, resourceMenu]);

  const requestConfirm = useCallback((options: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((resolve) => {
    setConfirmDialog({ ...options, resolve });
  }), []);


  useEffect(() => {
    if (!mobileToolsOpen) return;
    const close = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".mobile-tools-overflow")) return;
      setMobileToolsOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [mobileToolsOpen]);

  const requestTextPrompt = useCallback((options: { title: string; label: string; value: string; confirmLabel?: string }) => new Promise<string | null>((resolve) => {
    setTextPromptDialog({ ...options, resolve });
  }), []);

  const resetExecution = useCallback(() => {
    clearExecutionResult();
    setMessage("流程已修改，等待运行");
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: node.data.status === "error" ? "error" : "idle" } })));
  }, [setNodes]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    try {
      return validateEditorConnection(nodes, edges, connection).valid;
    } catch {
      return false;
    }
  }, [edges, nodes]);

  const onConnect = useCallback((connection: Connection) => {
    try {
      const validation = validateEditorConnection(nodes, edges, connection);
      if (!validation.valid || !validation.normalized) {
        setMessage(`无法连线：${validation.message ?? "节点端口信息无效"}`);
        return;
      }
      const result = session.applyGraphCommand({ type: "connect-edge", connection: validation.normalized });
      if (!result.changed) {
        setMessage(`无法连线：${result.meta?.blockedReason ?? "连接没有生效"}`);
        return;
      }
      resetExecution();
    } catch {
      setMessage("连线失败：节点端口信息无效，请重新选择节点后再试");
    }
  }, [edges, nodes, resetExecution, session]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    try {
      const validation = validateEditorConnection(nodes, edges, connection, { excludeEdgeId: oldEdge.id });
      if (!validation.valid || !validation.normalized) {
        setMessage(`无法移动连线端点：${validation.message ?? "节点端口信息无效"}`);
        return;
      }
      const result = session.applyGraphCommand({ type: "reconnect-edge", edgeId: oldEdge.id, connection: validation.normalized });
      if (!result.changed) {
        setMessage(`无法移动连线端点：${result.meta?.blockedReason ?? "连接没有生效"}`);
        return;
      }
      reconnectSucceeded.current = true;
      resetExecution();
      setMessage("已移动连线端点；拖到画布空白处可断开");
    } catch (error) { setMessage(readableError(error, "移动连线端点失败")); }
  }, [edges, nodes, resetExecution, session]);

  const openNodeMenu = useCallback((nodeId: string, x: number, y: number) => {
    const menuHeight = 300;
    const opensAbove = y > window.innerHeight - menuHeight - 12;
    setSelectedId(nodeId);
    setContextMenu({
      nodeId,
      x: Math.min(x, window.innerWidth - 190),
      y: Math.max(8, opensAbove ? y - menuHeight : Math.min(y, window.innerHeight - menuHeight)),
    });
  }, []);

  const openSelectionMenu = useCallback((x: number, y: number) => {
    if (!finePointer) return;
    setContextMenu(null);
    setSelectionMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 210)),
      y: Math.max(8, Math.min(y, window.innerHeight - 220)),
    });
  }, [finePointer]);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressOrigin.current = null;
  };

  const cancelTouchMarqueeHold = () => {
    if (touchMarqueeTimer.current !== null) window.clearTimeout(touchMarqueeTimer.current);
    touchMarqueeTimer.current = null;
  };

  const clearTouchMarqueeCandidate = (releaseCapture = false) => {
    cancelTouchMarqueeHold();
    const candidate = touchMarqueeCandidate.current;
    touchMarqueeCandidate.current = null;
    if (releaseCapture && candidate && canvasPanelRef.current) {
      try {
        if (canvasPanelRef.current.hasPointerCapture(candidate.pointerId)) canvasPanelRef.current.releasePointerCapture(candidate.pointerId);
      } catch { /* best effort */ }
    }
  };

  const nodeIdsInsideScreenRect = (startX: number, startY: number, currentX: number, currentY: number) => {
    const left = Math.min(startX, currentX);
    const right = Math.max(startX, currentX);
    const top = Math.min(startY, currentY);
    const bottom = Math.max(startY, currentY);
    const ids: string[] = [];
    document.querySelectorAll<HTMLElement>(".canvas-panel [data-workflow-node-id]").forEach((element) => {
      const id = element.dataset.workflowNodeId;
      if (!id) return;
      const bounds = element.getBoundingClientRect();
      if (bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom) ids.push(id);
    });
    return [...new Set(ids)];
  };

  const applyTouchMarqueeSelection = (marquee: { startX: number; startY: number; currentX: number; currentY: number }) => {
    const ids = nodeIdsInsideScreenRect(marquee.startX, marquee.startY, marquee.currentX, marquee.currentY);
    const selected = new Set(ids);
    setNodes((current) => current.map((node) => ({ ...node, selected: selected.has(node.id) })));
    setSelectedIds(ids);
    setSelectedId(ids.length === 1 ? ids[0] : null);
    return ids;
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    setPointerMode(event.pointerType === "mouse" ? "mouse" : "touch");
    if (event.pointerType !== "touch") return;

    const target = event.target as HTMLElement;
    const insideFlow = Boolean(target.closest(".react-flow"));
    if (!insideFlow) return;

    activeCanvasTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Two active fingers always win over the single-finger pan / long-hold marquee state machine.
    // React Flow's native touch pan is disabled on Android, so pinch is implemented here as a stable
    // viewport transform around the midpoint between both fingers.
    if (activeCanvasTouches.current.size >= 2) {
      event.preventDefault();
      event.stopPropagation();
      clearLongPress();
      clearTouchMarqueeCandidate(true);
      setTouchMarquee(null);

      const firstTwo = [...activeCanvasTouches.current.entries()].slice(0, 2) as Array<[number, { x: number; y: number }]>;
      const [first, second] = firstTwo;
      const panel = canvasPanelRef.current;
      if (!first || !second || !panel) return;
      const [firstId, firstPoint] = first;
      const [secondId, secondPoint] = second;
      const distance = Math.max(1, Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y));
      const midpointX = (firstPoint.x + secondPoint.x) / 2;
      const midpointY = (firstPoint.y + secondPoint.y) / 2;
      const bounds = panel.getBoundingClientRect();
      const viewport = reactFlow.getViewport();
      const localX = midpointX - bounds.left;
      const localY = midpointY - bounds.top;
      touchPinch.current = {
        pointerIds: [firstId, secondId],
        startDistance: distance,
        startZoom: viewport.zoom,
        anchorFlowX: (localX - viewport.x) / viewport.zoom,
        anchorFlowY: (localY - viewport.y) / viewport.zoom,
      };
      try { panel.setPointerCapture(firstId); } catch { /* best effort */ }
      try { panel.setPointerCapture(secondId); } catch { /* best effort */ }
      setMessage("双指缩放画布；松开一指后结束本次缩放");
      return;
    }

    const card = target.closest<HTMLElement>("[data-workflow-node-id]");
    const nodeId = card?.dataset.workflowNodeId;

    // Node and group touch gestures intentionally use different policies. A normal node hold enters
    // multi-select, while a group hold opens group actions. Both remain distinct from drag.
    if (nodeId) {
      const touchedNode = nodes.find((node) => node.id === nodeId);
      if (!touchedNode) return;
      const targetKind = gestureTargetForNodeType(touchedNode.data.nodeType);
      const policy = resolveGesturePolicy("mobile", targetKind);
      if (selectionMode && policy.longPress === "enter-multi-select") return;
      clearLongPress();
      clearTouchMarqueeCandidate(true);
      longPressOrigin.current = { x: event.clientX, y: event.clientY, thresholdPx: policy.dragThresholdPx };
      if (policy.longPressMs === null || policy.longPress === "none") return;
      longPressTimer.current = window.setTimeout(() => {
        suppressNextNodeClick.current = true;
        if (policy.longPress === "enter-multi-select") {
          setSelectionMode(true);
          setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
          setSelectedId(nodeId);
          setSelectedIds([nodeId]);
          setContextMenu(null);
          setMessage("已进入多选：点按节点勾选，完成后点击“组合”");
          navigator.vibrate?.(30);
        } else if (policy.longPress === "open-context-menu") {
          setSelectionMode(false);
          openNodeMenu(nodeId, event.clientX, event.clientY);
          setMessage("组合操作已打开；拖动组合仍用于移动");
          navigator.vibrate?.(22);
        }
        clearLongPress();
      }, policy.longPressMs);
      return;
    }

    // Blank-canvas touch is owned here instead of by React Flow. Quick movement pans; a 520 ms hold
    // enters marquee selection. A second finger cancels both paths and switches to pinch zoom above.
    if (target.closest(".react-flow__controls, .react-flow__minimap, .canvas-toolbar, .canvas-breadcrumb, button, input, select, textarea, a")) return;

    event.preventDefault();
    event.stopPropagation();
    clearLongPress();
    clearTouchMarqueeCandidate(true);
    try { canvasPanelRef.current?.setPointerCapture(event.pointerId); } catch { /* best effort */ }
    const candidate = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      panning: false,
      marquee: false,
      viewport: reactFlow.getViewport(),
    };
    touchMarqueeCandidate.current = candidate;
    const canvasGesture = resolveGesturePolicy("mobile", "canvas");
    touchMarqueeTimer.current = window.setTimeout(() => {
      const current = touchMarqueeCandidate.current;
      if (!current || current.pointerId !== event.pointerId || current.moved || current.panning || touchPinch.current) return;
      current.marquee = true;
      setSelectionMode(true);
      setNodes((nodesNow) => nodesNow.map((node) => ({ ...node, selected: false })));
      setSelectedId(null);
      setSelectedIds([]);
      setContextMenu(null);
      setSelectionMenu(null);
      setTouchMarquee({ pointerId: event.pointerId, startX: current.startX, startY: current.startY, currentX: current.startX, currentY: current.startY });
      setMessage("框选已启动：拖动手指框选节点；快速拖动画布仍用于平移");
      navigator.vibrate?.(22);
      touchMarqueeTimer.current = null;
    }, canvasGesture.longPressMs ?? 520);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" && pointerMode !== "touch") setPointerMode("touch");
    if (event.pointerType === "touch" && activeCanvasTouches.current.has(event.pointerId)) {
      activeCanvasTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinch = touchPinch.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      event.preventDefault();
      event.stopPropagation();
      const first = activeCanvasTouches.current.get(pinch.pointerIds[0]);
      const second = activeCanvasTouches.current.get(pinch.pointerIds[1]);
      const panel = canvasPanelRef.current;
      if (!first || !second || !panel) return;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      const bounds = panel.getBoundingClientRect();
      const nextZoom = Math.max(0.25, Math.min(2, pinch.startZoom * (distance / pinch.startDistance)));
      const localX = midpointX - bounds.left;
      const localY = midpointY - bounds.top;
      void reactFlow.setViewport({
        x: localX - pinch.anchorFlowX * nextZoom,
        y: localY - pinch.anchorFlowY * nextZoom,
        zoom: nextZoom,
      }, { duration: 0 });
      return;
    }

    const origin = longPressOrigin.current;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > origin.thresholdPx) clearLongPress();

    const active = touchMarquee;
    if (active && active.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const next = { ...active, currentX: event.clientX, currentY: event.clientY };
      setTouchMarquee(next);
      applyTouchMarqueeSelection(next);
      return;
    }

    const candidate = touchMarqueeCandidate.current;
    if (candidate && candidate.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - candidate.startX;
      const dy = event.clientY - candidate.startY;
      const distance = Math.hypot(dx, dy);

      if (candidate.marquee) {
        const next = { pointerId: event.pointerId, startX: candidate.startX, startY: candidate.startY, currentX: event.clientX, currentY: event.clientY };
        setTouchMarquee(next);
        applyTouchMarqueeSelection(next);
        return;
      }

      if (!candidate.panning && distance > resolveGesturePolicy("mobile", "canvas").dragThresholdPx) {
        candidate.moved = true;
        candidate.panning = true;
        cancelTouchMarqueeHold();
      }
      if (candidate.panning) {
        void reactFlow.setViewport({
          x: candidate.viewport.x + dx,
          y: candidate.viewport.y + dy,
          zoom: candidate.viewport.zoom,
        }, { duration: 0 });
      }
    }
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    clearLongPress();

    const pinch = touchPinch.current;
    if (pinch && pinch.pointerIds.includes(event.pointerId)) {
      event.preventDefault();
      event.stopPropagation();
      activeCanvasTouches.current.delete(event.pointerId);
      touchPinch.current = null;
      cancelTouchMarqueeHold();
      setTouchMarquee(null);
      clearTouchMarqueeCandidate(true);
      try {
        if (canvasPanelRef.current?.hasPointerCapture(event.pointerId)) canvasPanelRef.current.releasePointerCapture(event.pointerId);
      } catch { /* best effort */ }
      return;
    }

    activeCanvasTouches.current.delete(event.pointerId);
    if (touchMarquee && touchMarquee.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const finalMarquee = { ...touchMarquee, currentX: event.clientX, currentY: event.clientY };
      const ids = applyTouchMarqueeSelection(finalMarquee);
      setTouchMarquee(null);
      clearTouchMarqueeCandidate(true);
      if (ids.length) {
        setSelectionMode(true);
        setMessage(`已框选 ${ids.length} 个节点；可继续点按增减选择，完成后点击“组合”`);
      } else {
        setSelectionMode(false);
        setMessage("框选区域内没有节点");
      }
      return;
    }

    const candidate = touchMarqueeCandidate.current;
    if (candidate?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      if (candidate.marquee) {
        const finalMarquee = { pointerId: event.pointerId, startX: candidate.startX, startY: candidate.startY, currentX: event.clientX, currentY: event.clientY };
        const ids = applyTouchMarqueeSelection(finalMarquee);
        setTouchMarquee(null);
        clearTouchMarqueeCandidate(true);
        if (ids.length) {
          setSelectionMode(true);
          setMessage(`已框选 ${ids.length} 个节点；可继续点按增减选择，完成后点击“组合”`);
        } else {
          setSelectionMode(false);
          setMessage("框选区域内没有节点");
        }
        return;
      }
      clearTouchMarqueeCandidate(true);
      return;
    }
    clearTouchMarqueeCandidate(true);
  };

  const onCanvasPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    clearLongPress();
    activeCanvasTouches.current.delete(event.pointerId);
    if (touchPinch.current?.pointerIds.includes(event.pointerId)) touchPinch.current = null;
    if (touchMarquee?.pointerId === event.pointerId) setTouchMarquee(null);
    const candidate = touchMarqueeCandidate.current;
    if (candidate?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
    }
    clearTouchMarqueeCandidate(true);
  };

  const onWorkflowNodesChange = useCallback((changes: NodeChange<WorkflowNode>[]) => {
    onNodesChange(changes);
  }, [onNodesChange]);

  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: WorkflowNode[] }) => {
    const nextIds = selected.map((node) => node.id);
    setSelectedIds((current) => current.length === nextIds.length && current.every((id, index) => id === nextIds[index]) ? current : nextIds);
    const nextId = nextIds.length === 1 ? nextIds[0] : null;
    setSelectedId((current) => current === nextId ? current : nextId);
  }, []);

  const addNodeFromCatalog = (nodeType: string, position?: { x: number; y: number }) => {
    const number = nextNodeNumber.current++;
    const id = `${nodeType.replaceAll(".", "-")}-${Date.now()}-${number}`;
    const layer = nodes.filter((item) => (item.data.canvasParentId ?? null) === currentCanvasId);
    const fallback = resolvedLayoutDirection === "vertical"
      ? { x: layer.length ? Math.min(...layer.map((item) => item.position.x)) : Math.max(70, viewportWidth / 2 - 110), y: layer.length ? Math.max(...layer.map((item) => item.position.y)) + 150 : 70 }
      : { x: layer.length ? Math.max(...layer.map((item) => item.position.x)) + 285 : 70, y: layer.length ? Math.min(...layer.map((item) => item.position.y)) : 70 };
    const node = createNode(id, nodeType, position?.x ?? fallback.x, position?.y ?? fallback.y);
    node.className = "node-entering";
    node.data.canvasParentId = currentCanvasId ?? undefined;
    const isStructure = ["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(nodeType);
    if (isStructure) {
      node.style = { width: 520, height: 300 };
    } else if (position) {
      const container = nodes.find((candidate) => {
        if ((candidate.data.canvasParentId ?? null) !== currentCanvasId || !["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(candidate.data.nodeType)) return false;
        const width = Number(candidate.measured?.width ?? candidate.width ?? candidate.style?.width ?? 520);
        const height = Number(candidate.measured?.height ?? candidate.height ?? candidate.style?.height ?? 300);
        return position.x > candidate.position.x + 12 && position.x < candidate.position.x + width - 80 && position.y > candidate.position.y + 58 && position.y < candidate.position.y + height - 24;
      });
      if (container) {
        const relative = { x: Math.max(26, position.x - container.position.x), y: Math.max(104, position.y - container.position.y) };
        node.parentId = container.id;
        node.extent = "parent";
        node.expandParent = true;
        node.position = relative;
        node.data.branch = container.data.nodeType === "logic.if_subflow" && relative.x >= Number(container.measured?.width ?? container.style?.width ?? 520) / 2 ? "false" : container.data.nodeType === "logic.if_subflow" ? "true" : "body";
      }
    }
    const inserted = session.applyGraphCommand({ type: "insert-node", node });
    if (!inserted.changed) {
      setMessage(inserted.meta?.blockedReason ?? "节点添加失败");
      return;
    }
    window.setTimeout(() => setNodes((current) => current.map((item) => item.id === id ? { ...item, className: undefined } : item)), 360);
    clearExecutionResult();
    setMessage(`已添加“${node.data.label}”节点`);
  };

  const updatePaletteDragPreviewAt = (clientX: number, clientY: number) => {
    if (!clientX && !clientY) return;
    const bounds = document.querySelector<HTMLElement>(".canvas-panel")?.getBoundingClientRect();
    setPaletteDragPreview((current) => current ? { ...current, x: clientX, y: clientY, overCanvas: Boolean(bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) } : null);
  };

  const onPaletteDragStart = (event: ReactDragEvent<HTMLButtonElement>, resource: PaletteResource) => {
    event.dataTransfer.setData("application/pydroid-resource", JSON.stringify(resource));
    event.dataTransfer.effectAllowed = "copy";
    // Chromium only reliably suppresses its native drag bitmap when setDragImage() receives
    // an already-rendered DOM image. A detached canvas is ignored on some desktop builds.
    if (desktopDragImageElement.current) event.dataTransfer.setDragImage(desktopDragImageElement.current, 0, 0);
    desktopPaletteDragElement.current?.classList.remove("is-dragging");
    desktopPaletteDragElement.current = event.currentTarget;
    event.currentTarget.classList.add("is-dragging");
    setPaletteDragPreview({ kind: resource.kind, label: resource.label, x: event.clientX, y: event.clientY, overCanvas: false });
  };

  const updatePaletteDragPreview = (event: ReactDragEvent<HTMLButtonElement>) => {
    updatePaletteDragPreviewAt(event.clientX, event.clientY);
  };

  const clearPaletteResourceMenuHold = () => {
    if (paletteResourceMenuTimer.current !== null) window.clearTimeout(paletteResourceMenuTimer.current);
    paletteResourceMenuTimer.current = null;
    paletteResourceMenuHold.current = null;
  };

  const openPaletteResourceMenu = (resource: PaletteResource, x: number, y: number) => {
    if (resource.kind === "function") return;
    if (resource.kind === "flow") {
      const flow = flowLibrary.find((entry) => entry.id === resource.id);
      if (flow) openFlowMenu(flow, Math.max(8, Math.min(x, window.innerWidth - 210)), Math.max(8, Math.min(y, window.innerHeight - 250)));
      return;
    }
    setResourceMenu({
      kind: resource.kind === "node" ? "catalog-node" : resource.kind,
      entryId: resource.id,
      x: Math.max(8, Math.min(x, window.innerWidth - 210)),
      y: Math.max(8, Math.min(y, window.innerHeight - 240)),
    });
  };

  const startPaletteResourceMenuHold = (event: ReactPointerEvent<HTMLButtonElement>, resource: PaletteResource) => {
    if (event.pointerType === "mouse") return;
    clearPaletteResourceMenuHold();
    paletteResourceMenuHold.current = { pointerId: event.pointerId, resource, startX: event.clientX, startY: event.clientY, moved: false };
    const policy = resolveGesturePolicy("mobile", "resource");
    paletteResourceMenuTimer.current = window.setTimeout(() => {
      const hold = paletteResourceMenuHold.current;
      const drag = touchPaletteDrag.current;
      if (!hold || hold.pointerId !== event.pointerId || hold.moved || !drag || drag.pointerId !== event.pointerId || drag.moved) return;
      if (paletteDragTimer.current !== null) window.clearTimeout(paletteDragTimer.current);
      paletteDragTimer.current = null;
      drag.element.classList.remove("is-dragging");
      try { if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId); } catch { /* best effort */ }
      touchPaletteDrag.current = null;
      setPaletteDragPreview(null);
      palettePointerDragHandled.current = true;
      openPaletteResourceMenu(hold.resource, hold.startX, hold.startY);
      paletteResourceMenuTimer.current = null;
      paletteResourceMenuHold.current = null;
      navigator.vibrate?.(12);
    }, policy.longPressMs ?? 710);
  };

  const onPaletteResourceContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, resource: PaletteResource) => {
    event.preventDefault();
    // Android/WebView synthesizes contextmenu from a long touch. Touch menus are opened by our own
    // stationary-hold timer so dragging and menu invocation remain separate gestures.
    if (pointerMode !== "mouse") return;
    openPaletteResourceMenu(resource, event.clientX, event.clientY);
  };

  const clearPaletteResourceClick = () => {
    if (paletteResourceClickTimer.current !== null) window.clearTimeout(paletteResourceClickTimer.current);
    paletteResourceClickTimer.current = null;
  };

  const openPaletteMenuFromElement = (resource: PaletteResource, element: HTMLElement) => {
    clearPaletteResourceClick();
    const rect = element.getBoundingClientRect();
    openPaletteResourceMenu(resource, rect.left + Math.min(rect.width * .55, 72), rect.bottom + 4);
  };

  const schedulePaletteSingleClick = (action: () => void) => {
    clearPaletteResourceClick();
    paletteResourceClickTimer.current = window.setTimeout(() => {
      paletteResourceClickTimer.current = null;
      action();
    }, 470);
  };

  const clearPaletteDrag = () => {
    clearPaletteResourceMenuHold();
    if (paletteDragTimer.current !== null) window.clearTimeout(paletteDragTimer.current);
    paletteDragTimer.current = null;
    const pointerDrag = touchPaletteDrag.current;
    if (pointerDrag) {
      pointerDrag.element.classList.remove("is-dragging");
      try { if (pointerDrag.element.hasPointerCapture(pointerDrag.pointerId)) pointerDrag.element.releasePointerCapture(pointerDrag.pointerId); } catch { /* ignore */ }
    }
    touchPaletteDrag.current = null;
    desktopPaletteDragElement.current?.classList.remove("is-dragging");
    desktopPaletteDragElement.current = null;
    setPaletteDragPreview(null);
  };

  const onPalettePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, resource: PaletteResource) => {
    if (event.pointerType === "mouse") setPointerMode("mouse"); else setPointerMode("touch");
    if (event.button !== 0) return;
    clearPaletteDrag();
    palettePointerDragHandled.current = false;
    const element = event.currentTarget;
    touchPaletteDrag.current = { resource, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, element, armed: false, moved: false, pointerType: event.pointerType };
    startPaletteResourceMenuHold(event, resource);
    // Desktop palette dragging intentionally avoids native HTML5 drag-and-drop. Pointer capture
    // keeps our animated preview reliable and prevents Chromium/Electron from painting a ghost rectangle.
    if (event.pointerType === "mouse") {
      try { element.setPointerCapture(event.pointerId); } catch { /* best effort */ }
      return;
    }
  };

  const onPalettePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = touchPaletteDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const policy = resolveGesturePolicy(drag.pointerType === "mouse" ? "desktop" : "mobile", "resource");
    if (distance > policy.dragThresholdPx) {
      drag.moved = true;
      const hold = paletteResourceMenuHold.current;
      if (hold?.pointerId === event.pointerId) hold.moved = true;
      clearPaletteResourceMenuHold();
    }
    if (!drag.armed) {
      if (distance < policy.dragThresholdPx) return;
      // A deliberate move wins immediately over the menu hold. Touch users no longer have to
      // keep perfectly still until the drag-arm timer expires before they can start dragging.
      if (paletteDragTimer.current !== null) window.clearTimeout(paletteDragTimer.current);
      paletteDragTimer.current = null;
      drag.armed = true;
      palettePointerDragHandled.current = true;
      try { drag.element.setPointerCapture(drag.pointerId); } catch { /* best effort */ }
      drag.element.classList.add("is-dragging");
      setPaletteDragPreview({ kind: drag.resource.kind, label: drag.resource.label, x: event.clientX, y: event.clientY, overCanvas: false });
    }
    event.preventDefault();
    const bounds = document.querySelector<HTMLElement>(".canvas-panel")?.getBoundingClientRect();
    setPaletteDragPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY, overCanvas: Boolean(bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) } : null);
  };

  const paletteDropPosition = (nodeType: string, clientX: number, clientY: number) => {
    const point = reactFlow.screenToFlowPosition({ x: clientX, y: clientY });
    const spec = getNodeSpec(nodeType);
    const structure = ["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(nodeType);
    const width = structure ? 520 : Math.min(270, Math.max(168, 112 + Array.from(spec?.label ?? nodeType).length * 16)) * nodeScale;
    const height = structure ? 300 : (resolvedLayoutDirection === "vertical" ? 74 : 58) * nodeScale;
    return { x: point.x - width / 2, y: point.y - height / 2 };
  };

  const onPalettePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = touchPaletteDrag.current;
    clearPaletteResourceMenuHold();
    if (paletteDragTimer.current !== null) window.clearTimeout(paletteDragTimer.current);
    paletteDragTimer.current = null;
    touchPaletteDrag.current = null;
    if (drag) {
      drag.element.classList.remove("is-dragging");
      try { if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    setPaletteDragPreview(null);
    if (drag && !drag.armed && !drag.moved && drag.pointerId === event.pointerId && drag.pointerType !== "mouse") {
      const now = performance.now();
      const key = `${drag.resource.kind}:${drag.resource.id}`;
      const previous = paletteTouchTap.current;
      const isDoubleTap = Boolean(previous && previous.key === key && now - previous.at <= 430 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 30);
      if (isDoubleTap) {
        paletteTouchTap.current = null;
        clearPaletteResourceClick();
        palettePointerDragHandled.current = true;
        openPaletteMenuFromElement(drag.resource, drag.element);
        navigator.vibrate?.(12);
        event.preventDefault();
        window.setTimeout(() => { palettePointerDragHandled.current = false; }, 420);
        return;
      }
      paletteTouchTap.current = { key, at: now, x: event.clientX, y: event.clientY };
    }
    if (!drag || !drag.armed || drag.pointerId !== event.pointerId) return;
    paletteTouchTap.current = null;
    palettePointerDragHandled.current = true;
    event.preventDefault();
    const bounds = document.querySelector<HTMLElement>(".canvas-panel")?.getBoundingClientRect();
    if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
      dropPaletteResource(drag.resource, event.clientX, event.clientY);
      if (drag.pointerType !== "mouse") navigator.vibrate?.(20);
    }
    window.setTimeout(() => { palettePointerDragHandled.current = false; }, 0);
  };

  const onCanvasDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    let resource: PaletteResource;
    try { resource = JSON.parse(event.dataTransfer.getData("application/pydroid-resource")) as PaletteResource; }
    catch { return; }
    setPaletteDragPreview(null);
    dropPaletteResource(resource, event.clientX, event.clientY);
  };

  const onNodeDragStart = (_event: MouseEvent | TouchEvent, movedNode: WorkflowNode) => {
    session.beginHistoryTransaction(`node-drag:${movedNode.id}`);
    if (pointerMode === "touch") {
      const targetKind = gestureTargetForNodeType(movedNode.data.nodeType);
      nodeTouchDragSuppressMenuUntil.current = Date.now() + resolveGesturePolicy("mobile", targetKind).suppressContextAfterDragMs;
    }
    clearLongPress();
    setContextMenu(null);
    setSelectionMenu(null);
    setFlowMenu(null);
    setResourceMenu(null);
  };

  const onNodeDragStop = (_event: MouseEvent | TouchEvent, movedNode: WorkflowNode) => {
    const transactionKey = `node-drag:${movedNode.id}`;
    session.applyGraphCommand({
      type: "commit-node-drag",
      nodeId: movedNode.id,
      position: { ...movedNode.position },
      parentId: movedNode.parentId,
    }, { captureHistory: false });
    session.commitHistoryTransaction(transactionKey);
  };

  const replacementCandidates = useMemo(() => {
    if (!selectedNode) return [];
    const current = resolveNodeSpec(getNodeSpec(selectedNode.data.nodeType), selectedNode.data.parameters);
    const compatible = (candidate: NodeSpec) => current
      && candidate.inputPorts.length === current.inputPorts.length
      && candidate.outputPorts.length === current.outputPorts.length
      && candidate.inputPorts.every((port, index) => areValueTypesCompatible(current.inputPorts[index]?.valueType ?? "any", port.valueType))
      && candidate.outputPorts.every((port, index) => areValueTypesCompatible(port.valueType, current.outputPorts[index]?.valueType ?? "any"));
    const filtered = replacementShowAll ? NODE_CATALOG : NODE_CATALOG.filter(compatible);
    const query = replacementSearch.trim().toLocaleLowerCase();
    return filtered.filter((candidate) => candidate.nodeType !== selectedNode.data.nodeType && (!query || `${candidate.label} ${candidate.nodeType} ${candidate.tags?.join(" ") ?? ""}`.toLocaleLowerCase().includes(query)));
  }, [replacementSearch, replacementShowAll, selectedNode]);

  const replaceSelectedNode = (nextType: string) => {
    if (!selectedNode) return;
    const oldSpec = resolveNodeSpec(getNodeSpec(selectedNode.data.nodeType), selectedNode.data.parameters);
    const nextSpec = getNodeSpec(nextType);
    if (!nextSpec) return;
    const result = session.applyGraphCommand({ type: "replace-node", nodeId: selectedNode.id, nextNodeType: nextType });
    if (!result.changed) {
      setMessage(result.meta?.blockedReason ?? "节点替换失败");
      return;
    }
    setReplacementOpen(false);
    setContextMenu(null);
    clearExecutionResult();
    const removed = result.meta?.removedEdgeCount ?? 0;
    setMessage(`已将“${oldSpec?.label ?? selectedNode.data.label}”替换为“${nextSpec.label}”${removed ? `，移除 ${removed} 条不兼容连线` : "，兼容连线已保留"}`);
  };

  const deleteSelectedNode = () => {
    if (selectedId) deleteNodes([selectedId]);
  };

  const duplicateSelectedNode = () => {
    if (!selectedNode) return;
    const id = `${selectedNode.data.nodeType.replaceAll(".", "-")}-${Date.now()}-copy`;
    const duplicated = session.applyGraphCommand({ type: "duplicate-node", sourceNodeId: selectedNode.id, duplicateId: id });
    if (!duplicated.changed) { setMessage(duplicated.meta?.blockedReason ?? "节点复制失败"); return; }
    clearExecutionResult();
    setMessage("节点已复制；连线不会自动复制");
  };

  const createSubflowGroup = () => {
    const selectedSet = new Set([...selectedIds, ...nodes.filter((node) => node.selected).map((node) => node.id)]);
    const members = nodes.filter((node) => selectedSet.has(node.id) && (node.data.canvasParentId ?? null) === currentCanvasId);
    if (members.length < 2) {
      setSelectionMode(true);
      setMessage(finePointer ? "请在画布空白处拖出选框，或按住 Ctrl 点击，选择至少两个节点" : "已进入多选：点按节点勾选，选择至少两个后再次点击“组合”");
      return;
    }
    const id = `workflow-group-${Date.now()}`;
    const label = `子流程 ${nodes.filter((node) => node.data.nodeType === "workflow.group").length + 1}`;
    const result = session.applyGraphCommand({
      type: "create-group",
      nodeIds: members.map((node) => node.id),
      groupId: id,
      label,
      canvasId: currentCanvasId,
    });
    if (!result.changed) {
      setMessage(result.meta?.blockedReason ?? "无法创建组合");
      return;
    }
    clearExecutionResult();
    window.setTimeout(() => updateNodeInternals(id), 0);
    setMessage(`已将 ${members.length} 个节点组合为“${label}”`);
  };

  const saveSelectedGroupToLibrary = () => {
    if (!selectedNode || selectedNode.data.nodeType !== "workflow.group") { setMessage("请先选择一个组合"); return; }
    try {
      const captured = captureGroupResource(selectedNode.id, nodes, edges);
      const entry: GroupLibraryEntry = { id: `group-template-${Date.now()}`, ...captured };
      resourceLibrary.saveGroup(entry);
      setMessage(`已将“${entry.name}”保存到组合资源`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存组合资源失败");
    }
  };

  const saveSelectedGroupAsFunction = () => {
    if (!selectedNode || selectedNode.data.nodeType !== "workflow.group") { setMessage("请先选择一个组合"); return; }
    try {
      const result = session.applyGraphCommand({ type: "save-group-as-function", groupId: selectedNode.id });
      if (!result.changed) { setMessage(result.meta?.blockedReason ?? "保存函数失败"); return; }
      const definition = result.meta?.functionDefinition;
      if (!definition) { setMessage("保存函数失败：Editor Core 未返回函数定义"); return; }
      clearExecutionResult();
      const previousVersion = definition.version - 1;
      setMessage(previousVersion > 0 ? `已更新函数“${definition.name}”至 v${definition.version}，调用节点已同步` : `已创建函数“${definition.name}” v1`);
      setPaletteTab("functions");
    } catch (error) {
      setMessage(error instanceof Error ? `保存函数失败：${error.message}` : "保存函数失败");
    }
  };

  const insertFunctionCall = (definition: WorkflowFunctionDefinition, requestedPosition?: { x: number; y: number }) => {
    const layer = nodes.filter((item) => (item.data.canvasParentId ?? null) === currentCanvasId);
    const fallbackPosition = resolvedLayoutDirection === "vertical"
      ? { x: layer.length ? Math.min(...layer.map((item) => item.position.x)) : 80, y: layer.length ? Math.max(...layer.map((item) => item.position.y)) + 150 : 80 }
      : { x: layer.length ? Math.max(...layer.map((item) => item.position.x)) + 285 : 80, y: layer.length ? Math.min(...layer.map((item) => item.position.y)) : 80 };
    const position = requestedPosition ?? fallbackPosition;
    const result = session.applyGraphCommand({ type: "insert-function-call", definition, position, canvasId: currentCanvasId });
    if (!result.changed) return;
    clearExecutionResult();
    const callId = result.meta?.createdNodeIds?.[0];
    if (callId) window.setTimeout(() => updateNodeInternals(callId), 0);
    setMessage(`已添加函数调用“${definition.name}” v${definition.version}`);
  };

  const insertFunctionEditableGroup = (definition: WorkflowFunctionDefinition) => {
    const layer = nodes.filter((item) => (item.data.canvasParentId ?? null) === currentCanvasId);
    const position = { x: layer.length ? Math.max(...layer.map((item) => item.position.x)) + 260 : 80, y: layer.length ? Math.min(...layer.map((item) => item.position.y)) : 80 };
    const result = session.applyGraphCommand({ type: "materialize-function", definition, position, canvasId: currentCanvasId });
    if (!result.changed) return;
    clearExecutionResult();
    const groupId = result.meta?.primaryNodeId;
    if (groupId) window.setTimeout(() => updateNodeInternals(groupId), 0);
    setMessage(`已将“${definition.name}”展开为可编辑组合；修改后可更新函数版本`);
  };

  const deleteWorkflowFunction = async (definition: WorkflowFunctionDefinition) => {
    const calls = functionCallCount(nodes, definition.id);
    if (calls > 0) { setMessage(`“${definition.name}”仍有 ${calls} 个调用节点，请先删除或展开这些调用`); return; }
    const nestedCalls = functions.reduce((count, item) => count + functionCallCount(item.nodes, definition.id), 0);
    if (nestedCalls > 0) { setMessage(`“${definition.name}”仍被其他函数调用 ${nestedCalls} 次，无法删除`); return; }
    if (!(await requestConfirm({ title: "删除函数", message: `确定删除函数“${definition.name}” v${definition.version}？`, confirmLabel: "删除", danger: true }))) return;
    const result = session.applyGraphCommand({ type: "delete-function", functionId: definition.id });
    if (!result.changed) { setMessage(result.meta?.blockedReason ?? "无法删除函数"); return; }
    clearExecutionResult();
    setMessage(`已删除函数“${definition.name}”`);
  };

  const clearWorkspaceVariables = () => {
    clearWorkspaceVariableState(workspaceIdentity);
    setWorkspaceVariableRevision((value) => value + 1);
    setMessage("已清空当前标签页的工作区变量；其他标签页不受影响");
  };

  const saveSelectedNodeToLibrary = () => {
    if (!selectedNode || selectedNode.data.nodeType === "workflow.group") { setMessage("请先选择一个普通节点"); return; }
    const captured = captureNodeResource(selectedNode);
    const entry: SavedNodeEntry = { id: `saved-node-${Date.now()}`, name: selectedNode.data.label, node: captured.node, savedAt: new Date().toISOString() };
    resourceLibrary.saveNode(entry);
    setMessage(`已将“${entry.name}”保存到我的节点`);
  };

  const reorderSavedNodes = (dragId: string, overId: string) => {
    resourceLibrary.reorderNodes(dragId, overId);
  };

  const insertSavedNode = (template: SavedNodeEntry) => {
    const id = `${template.node.data.nodeType.replaceAll(".", "-")}-${Date.now()}-${nextNodeNumber.current++}`;
    const layer = nodes.filter((item) => (item.data.canvasParentId ?? null) === currentCanvasId);
    const position = resolvedLayoutDirection === "vertical"
      ? { x: layer.length ? Math.min(...layer.map((item) => item.position.x)) : 80, y: layer.length ? Math.max(...layer.map((item) => item.position.y)) + 150 : 80 }
      : { x: layer.length ? Math.max(...layer.map((item) => item.position.x)) + 285 : 80, y: layer.length ? Math.min(...layer.map((item) => item.position.y)) : 80 };
    const instance = instantiateNodeResource({ node: template.node }, { id, position, canvasId: currentCanvasId });
    instance.nodes[0].className = "node-entering";
    const result = session.applyGraphCommand({ type: "insert-resource", ...instance });
    if (!result.changed) { setMessage(result.meta?.blockedReason ?? "无法添加节点资源"); return; }
    window.setTimeout(() => setNodes((current) => current.map((item) => item.id === id ? { ...item, className: undefined } : item)), 360);
    clearExecutionResult();
    setMessage(`已添加我的节点“${template.name}”`);
  };

  const insertGroupTemplate = (template: GroupLibraryEntry, dropPosition?: { x: number; y: number }) => {
    try {
      const sourceGroup = template.nodes.find((node) => node.data.nodeType === "workflow.group");
      if (!sourceGroup) { setMessage("该组合资源已损坏"); return; }
      const position = dropPosition ?? { x: sourceGroup.position.x + 90 + (nodes.length % 4) * 28, y: sourceGroup.position.y + 90 + (nodes.length % 3) * 35 };
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      let sequence = 0;
      const instance = instantiateGroupResource(template, {
        position,
        canvasId: currentCanvasId,
        name: template.name,
        idFactory: (sourceId) => `${sourceId}-${stamp}-${sequence++}`,
      });
      const groupNode = instance.nodes.find((node) => node.id === instance.primaryNodeId);
      if (groupNode) groupNode.className = "node-entering node-entering--group";
      const result = session.applyGraphCommand({ type: "insert-resource", ...instance });
      if (!result.changed) { setMessage(result.meta?.blockedReason ?? "无法添加组合资源"); return; }
      window.setTimeout(() => setNodes((current) => current.map((node) => node.id === instance.primaryNodeId ? { ...node, className: undefined } : node)), 420);
      clearExecutionResult();
      setMessage(`已添加组合“${template.name}”，双击或右键可进入编辑`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法添加组合资源");
    }
  };

  const openSubflowGroup = (groupId: string) => {
    const group = nodes.find((node) => node.id === groupId && node.data.nodeType === "workflow.group");
    if (!group) return;
    setCurrentCanvasId(groupId);
    setSelectedId(null);
    setSelectedIds([]);
    setSelectionMode(false);
    setContextMenu(null);
    window.setTimeout(() => reactFlow.fitView({ padding: 0.18, duration: 250 }), 0);
  };

  const leaveSubflowGroup = (canvasId: string | null) => {
    setCurrentCanvasId(canvasId);
    setSelectedId(null);
    setSelectedIds([]);
    setSelectionMode(false);
    window.setTimeout(() => reactFlow.fitView({ padding: 0.18, duration: 250 }), 0);
  };

  const dissolveSelectedGroup = () => {
    if (!selectedNode || selectedNode.data.nodeType !== "workflow.group") return;
    const result = session.applyGraphCommand({ type: "dissolve-group", groupId: selectedNode.id });
    if (!result.changed) { setMessage(result.meta?.blockedReason ?? "无法解除组合"); return; }
    clearExecutionResult();
    setMessage("子流程组已解除，内部节点已返回当前画布");
  };

  const disconnectSelectedNode = () => {
    if (!selectedId) return;
    const connectionCount = edges.filter((edge) => edge.source === selectedId || edge.target === selectedId).length;
    if (connectionCount === 0) {
      setMessage("该节点没有连线");
      return;
    }
    const result = session.applyGraphCommand({ type: "disconnect-nodes", nodeIds: [selectedId] });
    if (!result.changed) return;
    resetExecution();
    setMessage(`已断开 ${connectionCount} 条连线`);
  };

  const updateParameter = (key: string, value: string | number | boolean | null) => {
    if (!selectedId) return;
    const updated = session.applyGraphCommand(
      { type: "update-node-parameters", nodeId: selectedId, patch: { [key]: value } },
      { historyGroup: `parameter:${selectedId}:${key}`, historyWindowMs: 800 },
    );
    if (!updated.changed) return;
    if (livePreview && (csvText || csvBytes)) {
      if (livePreviewTimer.current !== null) window.clearTimeout(livePreviewTimer.current);
      livePreviewTimer.current = window.setTimeout(() => void runPrototype(updated.snapshot.nodes), 450);
    }
    clearExecutionResult();
    setMessage("参数已修改，等待运行");
  };

  const applyNodeLayout = (direction: "horizontal" | "vertical", announce = true) => {
    session.applyGraphCommand({ type: "arrange-canvas", canvasId: currentCanvasId, viewportWidth, direction });
    refreshVisibleNodeGeometry();
    window.setTimeout(() => {
      const ids = nodes.filter((node) => (node.data.canvasParentId ?? null) === currentCanvasId).map((node) => ({ id: node.id }));
      if (ids.length) void reactFlow.fitView({ nodes: ids, padding: 0.16, duration: 260 });
    }, 100);
    if (announce) setMessage(`已按${direction === "vertical" ? "纵向" : "横向"}方式整理节点`);
  };

  const arrangeNodes = () => {
    applyNodeLayout(resolvedLayoutDirection);
  };

  const locateNode = (nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) { setMessage(`无法定位节点：${nodeId}`); return; }
    setViewMode("nodes");
    setCurrentCanvasId(target.data.canvasParentId ?? null);
    setInspectorCollapsed(false);
    setSelectedId(nodeId);
    setSelectedIds([nodeId]);
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    setErrorDetailOpen(false);
    window.setTimeout(() => {
      updateNodeInternals(nodeId);
      void reactFlow.fitView({ nodes: [{ id: nodeId }], padding: .55, duration: 320, maxZoom: 1.15 });
      document.querySelector<HTMLElement>(`[data-workflow-node-id="${CSS.escape(nodeId)}"]`)?.focus?.();
    }, 120);
    setMessage(`已定位到：${target.data.label}`);
  };

  const cycleLayoutMode = () => {
    const next = layoutMode === "auto" ? "horizontal" : layoutMode === "horizontal" ? "vertical" : "auto";
    const nextDirection = next === "auto" ? (viewportWidth < 760 ? "vertical" : "horizontal") : next;
    setLayoutMode(next);
    previousAutoDirection.current = nextDirection;
    applyNodeLayout(nextDirection, false);
    setMessage(next === "auto" ? `已切换为自动方向，并按${nextDirection === "vertical" ? "纵向" : "横向"}整理` : `已切换为${nextDirection === "vertical" ? "纵向" : "横向"}方向，并完成整理`);
  };

  const startSidebarResize = (side: "palette" | "inspector", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = side === "palette" ? paletteWidth : inspectorWidth;
    const startHeight = inspectorHeight;
    const resize = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "palette") setPaletteWidth(Math.min(360, Math.max(PALETTE_MIN_WIDTH, startWidth + delta)));
      else if (inspectorDock === "bottom") setInspectorHeight(Math.min(440, Math.max(140, startHeight - (moveEvent.clientY - startY))));
      else setInspectorWidth(Math.min(560, Math.max(250, startWidth - delta)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const startResultResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startY = event.clientY;
    const startHeight = resultHeight;
    const resize = (moveEvent: PointerEvent) => setResultHeight(Math.min(520, Math.max(180, startHeight - (moveEvent.clientY - startY))));
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const updateSelectedGroupLabel = (label: string) => {
    if (!selectedNode || selectedNode.data.nodeType !== "workflow.group") return;
    session.applyGraphCommand(
      { type: "update-node-label", nodeId: selectedNode.id, label },
      { historyGroup: `group-label:${selectedNode.id}`, historyWindowMs: 800 },
    );
  };

  const updateSelectedGroupPort = (direction: "input" | "output", id: string, label: string) => {
    if (!selectedNode || selectedNode.data.nodeType !== "workflow.group") return;
    session.applyGraphCommand(
      { type: "update-group-port-label", groupId: selectedNode.id, direction, portId: id, label },
      { historyGroup: `group-port:${selectedNode.id}:${direction}:${id}`, historyWindowMs: 800 },
    );
  };

  const updateSelectedTags = (raw: string) => {
    if (!selectedId) return;
    const tags = raw.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 6);
    session.applyGraphCommand(
      { type: "update-node-tags", nodeId: selectedId, tags },
      { historyGroup: `node-tags:${selectedId}`, historyWindowMs: 800 },
    );
  };

  const addSelectedToGroup = () => {
    if (!selectedNode || !groupName.trim()) return;
    const name = groupName.trim();
    setCustomGroups((current) => ({ ...current, [name]: [...new Set([...(current[name] ?? []), selectedNode.data.nodeType])] }));
    setGroupName("");
    setMessage(`已将“${selectedNode.data.label}”加入自定义组“${name}”`);
  };

  const saveSelectedDefaults = () => {
    if (!selectedNode || !selectedSpec) return;
    const preferred = selectedSpec.parameters.filter((parameter) => parameter.rememberDefault);
    if (!preferred.length) return;
    const values = Object.fromEntries(preferred.map((parameter) => [
      parameter.key,
      selectedNode.data.parameters[parameter.key] ?? selectedSpec.defaults[parameter.key] ?? null,
    ]));
    try {
      const all = JSON.parse(localStorage.getItem(NODE_DEFAULTS_KEY) ?? "{}") as Record<string, unknown>;
      all[selectedNode.data.nodeType] = values;
      localStorage.setItem(NODE_DEFAULTS_KEY, JSON.stringify(all));
      setMessage(`已保存 ${preferred.length} 项偏好默认值；仅应用于以后新建的“${selectedSpec.label}”节点`);
    } catch {
      setMessage("默认值保存失败：本地存储不可用");
    }
  };

  const clearSelectedDefaults = () => {
    if (!selectedNode || !selectedSpec) return;
    try {
      const all = JSON.parse(localStorage.getItem(NODE_DEFAULTS_KEY) ?? "{}") as Record<string, unknown>;
      delete all[selectedNode.data.nodeType];
      localStorage.setItem(NODE_DEFAULTS_KEY, JSON.stringify(all));
      setMessage(`已恢复“${selectedSpec.label}”的新建节点内置默认值`);
    } catch {
      setMessage("默认值恢复失败：本地存储不可用");
    }
  };

  const applyCustomTemplate = (code: string, label: string) => {
    if (!selectedId) return;
    const result = session.applyGraphCommand({ type: "apply-code-template", nodeId: selectedId, code });
    if (!result.changed) {
      setMessage(result.meta?.blockedReason ?? "模板没有产生修改");
      return;
    }
    clearExecutionResult();
    setMessage(`已应用“${label}”模板；原连线已断开，请按新签名重新连接`);
  };

  const savePersonalTemplate = () => {
    if (!selectedNode || selectedNode.data.nodeType !== "custom.python_function") return;
    const code = String(selectedNode.data.parameters.code ?? "");
    const signature = parsePythonFunctionSignature(code);
    if (signature.error) {
      setMessage(`模板保存失败：${signature.error}`);
      return;
    }
    const label = templateName.trim() || signature.functionName;
    const existing = personalTemplates.find((template) => template.label === label);
    const template: CustomNodeTemplate = {
      id: existing?.id ?? `personal-${Date.now()}`,
      label,
      description: `个人模板 · ${signature.inputPorts.length} 输入 / ${signature.outputPorts.length} 输出`,
      code,
    };
    setPersonalTemplates((current) => [...current.filter((item) => item.id !== template.id), template]);
    setTemplateName("");
    setMessage(`已保存个人模板“${label}”`);
  };

  const deletePersonalTemplate = (id: string, label: string) => {
    setPersonalTemplates((current) => current.filter((template) => template.id !== id));
    setMessage(`已删除个人模板“${label}”`);
  };

  const downloadText = (text: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportSettings = () => {
    const settings = { themeMode, runtimePreference, paletteWidth, inspectorWidth, inspectorHeight, resultHeight, nodeScale, endpointScale, edgeWidth, showNodeInsights, debugMode, automatedDiagnosticsEnabled, miniMapMode, layoutMode, smb: { server: smbConnection.server, share: smbConnection.share, domain: smbConnection.domain, username: smbConnection.username, rememberPassword: smbRememberPassword, guest: smbGuest }, agent: agentSettings } satisfies AppSettings;
    downloadText(JSON.stringify({ kind: "pydroid-flow.settings", schemaVersion: 1, settings }, null, 2), "pydroid-flow.settings.json", "application/json");
    setMessage("设置已导出；为安全起见不包含 AI API Key");
  };

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as { kind?: string; schemaVersion?: number; settings?: unknown };
      if (payload.kind !== "pydroid-flow.settings" || payload.schemaVersion !== 1 || !payload.settings || typeof payload.settings !== "object") throw new Error("不是受支持的 PyDroid Flow 设置文件");
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload.settings));
      const imported = loadAppSettings();
      setThemeMode(imported.themeMode);
      setRuntimePreference(imported.runtimePreference);
      setPaletteWidth(Math.min(360, Math.max(PALETTE_MIN_WIDTH, imported.paletteWidth)));
      setInspectorWidth(imported.inspectorWidth);
      setInspectorHeight(imported.inspectorHeight);
      setResultHeight(imported.resultHeight);
      setNodeScale(imported.nodeScale);
      setEndpointScale(imported.endpointScale);
      setEdgeWidth(imported.edgeWidth);
      setShowNodeInsights(imported.showNodeInsights);
      setDebugMode(imported.debugMode);
      setAutomatedDiagnosticsEnabled(imported.automatedDiagnosticsEnabled);
      setMiniMapMode(imported.miniMapMode);
      setLayoutMode(imported.layoutMode);
      setSmbConnection((current) => ({ ...current, server: imported.smb.server, share: imported.smb.share, domain: imported.smb.domain, username: imported.smb.username }));
      setSmbRememberPassword(imported.smb.rememberPassword);
      setSmbGuest(imported.smb.guest);
      setAgentSettings(imported.agent);
      setLanguage(imported.agent.language);
      refreshVisibleNodeGeometry();
      setMessage("设置已导入并应用；AI API Key 保留当前设备中的加密值");
    } catch (error) {
      setMessage(error instanceof Error ? `设置导入失败：${error.message}` : "设置导入失败");
    } finally {
      event.target.value = "";
    }
  };

  const exportCurrentTemplate = () => {
    if (!selectedNode || selectedNode.data.nodeType !== "custom.python_function") return;
    const code = String(selectedNode.data.parameters.code ?? "");
    const signature = parsePythonFunctionSignature(code);
    if (signature.error) {
      setMessage(`模板导出失败：${signature.error}`);
      return;
    }
    const label = templateName.trim() || signature.functionName;
    const template: CustomNodeTemplate = {
      id: `shared-${signature.functionName}`,
      label,
      description: `PyDroid Flow 自定义节点 · ${signature.inputPorts.length} 输入 / ${signature.outputPorts.length} 输出`,
      code,
    };
    downloadText(JSON.stringify(serializeCustomNodeTemplate(template), null, 2), `${signature.functionName}.pydroid-node.json`, "application/json");
    setMessage(`已导出模板“${label}”`);
  };

  const importCustomTemplate = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseCustomNodeTemplate(await file.text());
      const template = {
        ...imported,
        id: `personal-${Date.now()}`,
      };
      setPersonalTemplates((current) => [...current.filter((item) => item.id !== template.id), template]);
      setMessage(`已导入个人模板“${template.label}”`);
    } catch (error) {
      setMessage(error instanceof Error ? `模板导入失败：${error.message}` : "模板导入失败");
    } finally {
      event.target.value = "";
    }
  };

  const openNotebookView = () => {
    if (!nodes.length) {
      setNotebookCells([]);
      setNotebookMetadata({});
      setNotebookError(null);
      setViewMode("notebook");
      setMessage("当前是空白流程，Notebook 中没有残留单元格");
      return;
    }
    const expanded = flattenWorkflowGroups(nodes, edges);
    setNotebookCells(workflowNotebookCells(expanded.nodes, expanded.edges, requirements));
    setNotebookCellResults({});
    setNotebookMetadata(workflowNotebookMetadata(nodes));
    setNotebookError(null);
    setViewMode("notebook");
    setMessage("已按 setup、节点和连线拆分为 Jupyter 单元格；每个节点可独立编辑");
  };

  const applyNotebook = () => {
    try {
      const source = joinNotebookCells(notebookCells);
      const document = source.includes("# %% [node]")
        ? parseWorkflowNotebook(source)
        : notebookCellsToWorkflow("Jupyter 单元格工作流", notebookCells, notebookMetadata);
      replaceWorkflowContent(prepareImportedWorkflow(document));
      setNotebookError(null);
      setMessage(`已从 Notebook 应用 ${document.nodes.length} 个节点和 ${document.edges.length} 条连线；未识别代码以无损单元格节点保留`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notebook 解析失败";
      setNotebookError(message);
      setMessage(`Notebook 应用失败：${message}`);
    }
  };

  const runNotebook = async (throughIndex?: number) => {
    if (notebookRunningCell !== null || ["queued", "running", "cancelling"].includes(getExecutionStatus(workspaceIdentity).phase)) return;
    const lastIndex = throughIndex ?? notebookCells.length - 1;
    const cells = notebookCells.slice(0, lastIndex + 1);
    if (!cells.some((cell) => cell.cellType === "code" && cell.source.trim())) { setNotebookError("没有可运行的代码单元格"); return; }
    setNotebookRunningCell(throughIndex ?? "all");
    setNotebookError(null);
    setExecutionError(null);
    setErrorDetailOpen(false);
    try {
      const document = notebookCellsToWorkflow("Notebook 交互运行", cells, notebookMetadata);
      const inputFiles = csvFiles.map((file) => ({ name: file.name, text: new TextDecoder("utf-8").decode(file.bytes) }));
      const nextResult = await executeWorkflow(document.nodes, document.edges, csvText, inputFiles, runtimePreference, { workspaceId: tabId, workspaceLabel: tabName, clientId: executionClientId, workspaceIdentity, functions });
      setResult(nextResult);
      setNotebookCellResults((current) => ({ ...current, ...Object.fromEntries(cells.map((cell, index) => [cell.id, nextResult.nodeResults[`notebook-cell-${index + 1}`]]).filter((entry): entry is [string, NodeExecutionPreview] => Boolean(entry[1]))) }));
      setNotebookCells((current) => current.map((cell, index) => index <= lastIndex && cell.cellType === "code" ? { ...cell, executionCount: (cell.executionCount ?? 0) + 1 } : cell));
      setMessage(throughIndex === undefined ? `Notebook 已运行 ${cells.filter((cell) => cell.cellType === "code").length} 个代码单元格` : `已运行到第 ${throughIndex + 1} 个单元格`);
    } catch (error) {
      if (error instanceof ExecutionBusyError) {
        setMessage(`上一次执行仍在退出（${error.executionId}），请等待宿主释放后再运行`);
        setExecutionError(null);
        return;
      } else if (error instanceof ExecutionCancelledError) {
        setNotebookError(null);
        setMessage("Notebook 执行已取消");
        return;
      }
      if (error instanceof ExecutionTimeoutError) {
        setNotebookError(error.message);
        setExecutionError({ title: "Notebook 执行超时", message: error.message });
        setMessage(error.message);
        return;
      }
      const detail = error instanceof Error ? error.message : "Notebook 运行失败";
      const nodeId = error instanceof WorkflowExecutionError ? error.nodeId : undefined;
      const cellNumber = nodeId?.match(/notebook-cell-(\d+)/)?.[1];
      const message = `${cellNumber ? `第 ${cellNumber} 个单元格：` : ""}${detail}`;
      setNotebookError(message);
      setExecutionError({ title: "Notebook 运行失败", message, nodeId, nodeType: error instanceof WorkflowExecutionError ? error.nodeType : undefined });
    } finally { setNotebookRunningCell(null); }
  };

  const importNotebook = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseJupyterNotebook(await file.text());
      setNotebookCells(imported.cells);
      setNotebookCellResults({});
      setNotebookMetadata(imported.metadata);
      const source = joinNotebookCells(imported.cells);
      const analyses = source.includes("# %% [node]") ? [] : await analyzeNotebook(serializeJupyterNotebookCells(imported.name, imported.cells, imported.metadata));
      const document = source.includes("# %% [node]") ? parseWorkflowNotebook(source, imported.name)
        : analyses.some((analysis) => analysis.recognized)
          ? analyzedNotebookToWorkflow(imported.name, imported.cells, analyses, imported.metadata)
          : notebookCellsToWorkflow(imported.name, imported.cells, imported.metadata);
      replaceWorkflowContent(prepareImportedWorkflow(document));
      setNotebookError(null);
      setViewMode("nodes");
      const recognizedCount = analyses.filter((analysis) => analysis.recognized).length;
      setMessage(source.includes("# %% [node]")
        ? `已自动识别并恢复 ${document.nodes.length} 个功能节点`
        : `已转换 ${imported.cells.length} 个 Jupyter 单元格：识别 ${recognizedCount} 个功能节点，其余以无损代码/Markdown 节点保留`);
    } catch (error) {
      setMessage(error instanceof Error ? `Jupyter 导入失败：${error.message}` : "Jupyter 导入失败");
    } finally {
      event.target.value = "";
    }
  };

  const hasUnsavedWorkflowChanges = () => session.isDirty();

  const clearCurrentWorkflow = () => {
    lifecycle.resetWorkspace(session, true);
    clearExecutionResult();
    clearWorkspaceVariableState(workspaceIdentity);
    setWorkspaceVariableRevision((value) => value + 1);
    setViewMode("nodes");
    setNotebookCells([]);
    setNotebookCellResults({});
    setNotebookMetadata({});
    setNotebookError(null);
    setExecutionError(null);
    setErrorDetailOpen(false);
    setMessage("已在当前标签页新建空白流程");
  };

  const requestNewWorkflow = () => setNewWorkflowDialogOpen(true);

  const chooseNewInCurrentTab = () => {
    setNewWorkflowDialogOpen(false);
    if (hasUnsavedWorkflowChanges()) {
      setReplaceCurrentUnsavedOpen(true);
      return;
    }
    clearCurrentWorkflow();
  };

  const chooseNewTab = () => {
    setNewWorkflowDialogOpen(false);
    onAddTab();
  };

  const addPackageRequirement = () => {
    const requirement = packageRequirement.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:(?:==|>=|<=|~=|>|<)[A-Za-z0-9.*+!_-]+)?$/.test(requirement)) {
      setMessage("依赖格式无效；例如 scipy==1.12.0 或 openpyxl>=3.1");
      return;
    }
    const packageName = requirement.split(/[<>=~![]/, 1)[0].toLocaleLowerCase();
    if (BUNDLED_PACKAGES.some((item) => item.name === packageName)) {
      setMessage(`${packageName} 已由应用内置，无需重复添加`);
      return;
    }
    const result = session.applyGraphCommand({ type: "upsert-requirement", requirement });
    if (!result.changed) {
      setMessage(result.meta?.blockedReason ?? "工作流依赖没有变化");
      return;
    }
    clearExecutionResult();
    setPackageRequirement("");
    setMessage(`已将 ${requirement} 加入工作流依赖清单`);
  };

  const removePackageRequirement = (requirement: string) => {
    const result = session.applyGraphCommand({ type: "remove-requirement", requirement });
    if (!result.changed) return;
    clearExecutionResult();
    setMessage(`已从工作流依赖清单移除 ${requirement}`);
  };

  const openPackageManager = async () => {
    setPackageManagerOpen(true);
    setEnvironmentLoading(true);
    try {
      setPythonEnvironment(await getPythonEnvironment());
    } catch (error) {
      setMessage(error instanceof Error ? `读取 Python 环境失败：${error.message}` : "读取 Python 环境失败");
    } finally {
      setEnvironmentLoading(false);
    }
  };

  const copyPipCommand = async () => {
    const command = requirements.length ? `python -m pip install ${requirements.join(" ")}` : "# 当前没有额外依赖";
    try {
      await navigator.clipboard.writeText(command);
      setMessage("pip 命令已复制");
    } catch {
      setMessage(command);
    }
  };

  const saveWorkflow = () => {
    lifecycle.saveSession(session, tabName, (json) => persistSerializedWorkflow(resourceLibrary, json, tabName));
    setMessage(`工作流“${tabName}”已保存`);
  };

  const saveThenReplaceCurrentWorkflow = () => {
    saveWorkflow();
    setReplaceCurrentUnsavedOpen(false);
    clearCurrentWorkflow();
  };

  const discardThenReplaceCurrentWorkflow = () => {
    setReplaceCurrentUnsavedOpen(false);
    clearCurrentWorkflow();
  };

  const openLibraryFlow = (entry: FlowLibraryEntry) => {
    try {
      lifecycle.openSerialized(session, entry.document, (document) => {
        const nextNodes = repairWorkflowGroupInterfaces(normalizeNodePositions(document.nodes).map((node) => {
          const hydrated = hydrateNodeDefaults(node);
          return { ...hydrated, type: "workflow", className: "node-entering node-entering--flow", data: { ...hydrated.data, status: "idle" as const } };
        }), document.edges);
        return { nodes: nextNodes, edges: document.edges, functions: document.functions ?? [], requirements: document.requirements ?? [] };
      });
      clearExecutionResult();
      window.setTimeout(() => setNodes((current) => current.map((node) => ({ ...node, className: undefined }))), 480);
      setMessage(`已打开流程“${entry.name}”`);
    } catch { setMessage("流程库条目已损坏，无法打开"); }
  };

  const dropPaletteResource = (resource: PaletteResource, clientX: number, clientY: number) => {
    if (resource.kind === "node") {
      if (getNodeSpec(resource.id)) addNodeFromCatalog(resource.id, paletteDropPosition(resource.id, clientX, clientY));
      return;
    }
    if (resource.kind === "saved-node") {
      const template = savedNodeLibrary.find((entry) => entry.id === resource.id);
      if (template) insertSavedNode(template);
      return;
    }
    if (resource.kind === "group") {
      const template = groupLibrary.find((entry) => entry.id === resource.id);
      if (template) insertGroupTemplate(template, reactFlow.screenToFlowPosition({ x: clientX, y: clientY }));
      return;
    }
    if (resource.kind === "function") {
      const definition = functions.find((entry) => entry.id === resource.id);
      if (definition) insertFunctionCall(definition, reactFlow.screenToFlowPosition({ x: clientX, y: clientY }));
      return;
    }
    const flow = flowLibrary.find((entry) => entry.id === resource.id);
    if (flow) openLibraryFlow(flow);
  };

  const openFlowMenu = (entry: FlowLibraryEntry, x: number, y: number) => {
    setFlowMenu({ entryId: entry.id, x, y });
  };

  const beginRenameFlow = (entry: FlowLibraryEntry) => {
    setFlowMenu(null);
    if (!describeFlow(entry).capabilities.rename) { setMessage("该流程已锁定，请先解除锁定"); return; }
    setRenameFlow(entry);
    setRenameFlowValue(entry.name.replace(/\.workflow\.json$/i, "").replace(/\.json$/i, ""));
  };

  const confirmRenameFlow = async () => {
    if (!renameFlow) return;
    const name = renameFlowValue.trim();
    if (!name || /[\\/]/.test(name)) { setMessage("流程名称不能为空，且不能包含斜杠"); return; }
    try {
      let nextName = name;
      let nextUri = renameFlow.uri;
      if (renameFlow.external && renameFlow.uri) {
        const extension = /\.workflow\.json$/i.test(renameFlow.name) ? ".workflow.json" : /\.json$/i.test(renameFlow.name) ? ".json" : ".workflow.json";
        const renamed = await renameWorkflowFile(renameFlow.uri, `${name}${extension}`);
        nextName = renamed.name;
        nextUri = renamed.uri;
      }
      resourceLibrary.renameFlow(renameFlow.id, nextName, nextUri);
      setRenameFlow(null);
      setMessage(`已重命名流程为“${nextName}”`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法重命名流程"); }
  };

  const deleteFlow = async (entry: FlowLibraryEntry) => {
    setFlowMenu(null);
    if (!describeFlow(entry).capabilities.remove) { setMessage("该流程已锁定，请先解除锁定"); return; }
    if (!(await requestConfirm({ title: "删除流程", message: `确定删除流程“${entry.name}”？此操作无法恢复。`, confirmLabel: "删除", danger: true }))) return;
    try {
      if (entry.external && entry.uri) await deleteWorkflowFile(entry.uri);
      resourceLibrary.removeFlow(entry.id);
      setMessage(`已删除流程“${entry.name}”`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法删除流程"); }
  };

  const toggleFlowLock = (entry: FlowLibraryEntry) => {
    setFlowMenu(null);
    if (!describeFlow(entry).capabilities.lock) { setMessage("该流程不支持锁定操作"); return; }
    resourceLibrary.toggleFlowLock(entry.id);
    setMessage(entry.locked ? `已解除流程“${entry.name}”的锁定` : `已锁定流程“${entry.name}”，不会允许改名或删除`);
  };

  const jumpToWorkflowFolder = async () => {
    setFlowMenu(null);
    try {
      if (!userProfile?.workspaceUri) { await configureWorkflowFolder(); return; }
      await openWorkflowFolder();
      setMessage("已在文件管理器中打开用户流程文件夹");
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法打开用户流程文件夹"); }
  };

  const configureWorkflowFolder = async () => {
    try {
      setUserProfile(await chooseWorkflowFolder());
      await refreshExternalWorkflowLibrary();
      setMessage("已连接用户流程文件夹；“流程”抽屉会自动扫描其中的 JSON 工作流");
    } catch (error) { setMessage(error instanceof Error ? error.message : "未设置流程文件夹"); }
  };

  const loadWorkflowFile = async (file: File) => {
    try {
      const text = await file.text();
      if (file.name.toLocaleLowerCase().endsWith(".ipynb")) {
        const imported = parseJupyterNotebook(text);
        const source = joinNotebookCells(imported.cells);
        const analyses = source.includes("# %% [node]") ? [] : await analyzeNotebook(serializeJupyterNotebookCells(imported.name, imported.cells, imported.metadata));
        const document = source.includes("# %% [node]") ? parseWorkflowNotebook(source, imported.name)
          : analyses.some((analysis) => analysis.recognized)
            ? analyzedNotebookToWorkflow(imported.name, imported.cells, analyses, imported.metadata)
            : notebookCellsToWorkflow(imported.name, imported.cells, imported.metadata);
        setNotebookCells(imported.cells);
        setNotebookMetadata(imported.metadata);
        replaceWorkflowContent(prepareImportedWorkflow(document));
        setViewMode("nodes");
        const recognizedCount = analyses.filter((analysis) => analysis.recognized).length;
        setMessage(source.includes("# %% [node]")
          ? `已从 Jupyter 自动恢复 ${document.nodes.length} 个功能节点`
          : `已转换 ${imported.cells.length} 个单元格：识别 ${recognizedCount} 个功能节点，其余无损保留`);
        return;
      }
      const opened = lifecycle.openSerialized(session, text, prepareImportedWorkflow);
      clearExecutionResult();
      const document = opened.document;
      setMessage(`已导入流程“${document.name}”`);
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "工作流导入失败");
    }
  };

  const importWorkflow = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await loadWorkflowFile(file);
    event.target.value = "";
  };

  const loadCsvSelection = async (selectedFiles: File[]) => {
    const loaded = await Promise.all(selectedFiles.filter((file) => /\.(csv|tsv|txt|dat|json|png|jpe?g)$/i.test(file.name) || /^(text|image)\//.test(file.type)).map(async (file) => ({ name: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    if (!loaded.length) {
      setMessage("所选位置没有受支持的数据文件");
      return;
    }
    const [{ name, bytes }] = loaded;
    setCsvFiles(loaded);
    setFileName(loaded.length === 1 ? name : `${loaded.length} 个文件`);
    setCsvBytes(bytes);
    setCsvText(new TextDecoder("utf-8").decode(bytes));
    clearExecutionResult();
    setMessage(`已载入 ${loaded.length} 个文件：${loaded.map((file) => file.name).join("、")}`);
  };

  const applyPickedCsvFiles = (loaded: Array<{ name: string; bytes: Uint8Array }>, source: string) => {
    if (!loaded.length) { setMessage(`${source}中没有可读取的数据文件`); return; }
    const [{ name, bytes }] = loaded;
    setCsvFiles(loaded); setFileName(loaded.length === 1 ? name : `${loaded.length} 个文件`);
    setCsvBytes(bytes); setCsvText(new TextDecoder("utf-8").decode(bytes)); clearExecutionResult();
    setMessage(`已从${source}载入 ${loaded.length} 个文件`);
  };

  const effectiveSmbConnection = (): SmbConnection => smbGuest
    ? { ...smbConnection, domain: "", username: "", password: "" }
    : smbConnection;

  const browseSmb = async (path = smbPath) => {
    setSmbLoading(true); setSmbError(null);
    try { setSmbEntries(await listSmbDirectory(effectiveSmbConnection(), path)); setSmbPath(path); setSmbSelected([]); }
    catch (error) { setSmbError(readableError(error, "无法访问 SMB，请检查共享名、凭据和访问权限")); }
    finally { setSmbLoading(false); }
  };

  const scanConfiguredSmb = async () => {
    setSmbLoading(true); setSmbError(null);
    try {
      const shares = await scanSmbShares(effectiveSmbConnection());
      setSmbScannedShares(shares);
      setSmbServers((current) => current.map((server) => server.address === smbConnection.server ? { ...server, shares } : server));
      if (!smbConnection.share && shares.length === 1) setSmbConnection((current) => ({ ...current, share: shares[0] }));
      setMessage(`已发现 ${shares.length} 个 SMB 共享`);
    } catch (error) { setSmbError(readableError(error, smbGuest ? "访客访问被服务器拒绝，请改用账号登录" : "无法读取共享，请检查账号和密码")); }
    finally { setSmbLoading(false); }
  };

  const selectSmbShare = async (share: string) => {
    setSmbConnection((current) => ({ ...current, share }));
    setSmbLoading(true); setSmbError(null);
    try {
      const connection = { ...effectiveSmbConnection(), share };
      setSmbEntries(await listSmbDirectory(connection, ""));
      setSmbPath(""); setSmbSelected([]);
    } catch (error) { setSmbError(readableError(error, "无法访问共享，请检查共享名、账号密码和权限")); }
    finally { setSmbLoading(false); }
  };

  const discoverConfiguredSmb = async () => {
    setSmbLoading(true); setSmbError(null); setSmbServers([]);
    try {
      const servers = await discoverSmbServers();
      setSmbServers(servers);
      setMessage(servers.length ? `已发现 ${servers.length} 台提供 SMB 的设备` : "当前网络没有发现开放 SMB 端口的设备");
    } catch (error) { setSmbError(readableError(error, "无法扫描局域网 SMB 设备")); }
    finally { setSmbLoading(false); }
  };

  const importSmbSelection = async (allInFolder = false) => {
    const paths = allInFolder ? smbEntries.filter((entry) => !entry.directory).map((entry) => entry.path) : smbSelected;
    if (!paths.length) { setSmbError("请选择数据文件，或使用“导入当前文件夹”"); return; }
    setSmbLoading(true); setSmbError(null);
    try { const files = await readSmbCsvFiles(effectiveSmbConnection(), paths); applyPickedCsvFiles(files, "SMB"); setSmbOpen(false); }
    catch (error) { setSmbError(readableError(error, "无法读取 SMB 文件")); }
    finally { setSmbLoading(false); }
  };

  const chooseCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = [...(event.target.files ?? [])];
    if (!selectedFiles.length) return;
    await loadCsvSelection(selectedFiles);
    event.target.value = "";
  };

  const handleFileDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    const files = [...event.dataTransfer.files];
    const workflow = files.find((file) => /\.ipynb$/i.test(file.name) || /(?:workflow|pydroid).*\.json$/i.test(file.name));
    if (workflow) await loadWorkflowFile(workflow);
    const dataFiles = files.filter((file) => file !== workflow);
    if (dataFiles.length) await loadCsvSelection(dataFiles);
    if (!dataFiles.length && !workflow) setMessage("可拖入 CSV、TXT、DAT、JSON、图片、工作流 JSON 或 Jupyter 文件");
  };

  const toggleRemoteServer = async () => {
    if (!remoteServer) { setRemoteAccessDialog(true); return; }
    try {
      await stopRemoteServer();
      setRemoteServer(null);
      setRemoteBannerVisible(false);
      setMessage("计算服务已关闭");
    } catch (error) {
      setMessage(error instanceof Error ? `局域网服务失败：${error.message}` : "局域网服务关闭失败");
    }
  };

  const startConfiguredRemoteServer = async () => {
    setRemoteAccessDialog(false);
    setMessage("正在开启计算服务…");
    try {
      const info = await startRemoteServer(remoteRequirePin);
      setRemoteServer(info);
      setRemoteBannerVisible(true);
      setMessage("计算服务已开启");
    } catch (error) {
      setRemoteAccessDialog(true);
      setMessage(error instanceof Error ? `局域网服务失败：${error.message}` : "局域网服务启动失败");
    }
  };

  const submitRemotePin = async () => {
    if (!/^\d{4}$/.test(remotePinInput)) { setRemoteAccessError("请输入四位数字校验码"); return; }
    try {
      await pairRemoteRuntime(remotePinInput);
      setRemotePaired(true);
      setRemoteAccessError(null);
      setMessage("已连接 Android 计算服务");
    } catch (error) {
      setRemoteAccessError(error instanceof Error ? error.message : "校验失败");
    }
  };

  const copyRemoteUrl = async () => {
    if (!remoteServer) return;
    try {
      await navigator.clipboard.writeText(remoteServer.url);
      setMessage("地址已复制");
    } catch {
      setMessage(`请在电脑浏览器打开：${remoteServer.url}`);
    }
  };

  const openRemoteFromStatusbar = () => {
    if (remoteServer) {
      setRemoteBannerVisible(true);
      return;
    }
    setRemoteAccessDialog(true);
  };

  const openSmbFromStatusbar = () => {
    setSmbError(null);
    setSmbOpen(true);
  };

  const chooseCsvSource = async (mode: "files" | "files_external" | "directory" | "directory_external") => {
    try {
      const nativeFiles = await pickCsvFiles(mode);
      if (nativeFiles) {
      const loaded = nativeFiles;
      if (!loaded.length) {
        setMessage(mode.startsWith("directory") ? "文件夹中没有受支持的数据文件，或已取消选择" : "未选择数据文件");
        return;
      }
      setCsvFiles(loaded);
      setFileName(loaded.length === 1 ? loaded[0].name : `${loaded.length} 个文件`);
      setCsvBytes(loaded[0].bytes);
      setCsvText(new TextDecoder().decode(loaded[0].bytes));
      clearExecutionResult();
      setMessage(`已载入 ${loaded.length} 个文件：${loaded.map((file) => file.name).join("、")}`);
        return;
      }
      (mode.startsWith("directory") ? directoryInput : fileInput).current?.click();
    } catch (error) {
      setMessage(error instanceof Error ? `选择文件失败：${error.message}` : "选择文件失败");
    }
  };

  const workflowInputPayload = (workflowNodes: WorkflowNode[]) => {
    let effectiveCsvText = csvText;
    let effectiveInputFiles: Array<{ name: string; text: string; base64?: string }> = [];
    if (csvBytes) {
      const reader = workflowNodes.find((node) => ["io.read_csv", "io.read_csv_batch", "io.read_table", "io.read_text", "io.read_json"].includes(node.data.nodeType));
      const requestedEncoding = String(reader?.data.parameters.encoding ?? "utf-8");
      const encoding = requestedEncoding === "utf-8-sig" ? "utf-8" : requestedEncoding;
      const errors = String(reader?.data.parameters.encodingErrors ?? "strict");
      effectiveCsvText = reader ? new TextDecoder(encoding, { fatal: errors === "strict" }).decode(csvBytes) : "";
      if (errors === "ignore") effectiveCsvText = effectiveCsvText.replaceAll("�", "");
      effectiveInputFiles = csvFiles.map((file) => {
        let text = "";
        try { text = new TextDecoder(encoding, { fatal: errors === "strict" }).decode(file.bytes); } catch { if (reader) throw new Error(`${file.name} 无法按 ${encoding} 解码`); }
        if (errors === "ignore") text = text.replaceAll("�", "");
        return { name: file.name, text, base64: bytesToBase64(file.bytes) };
      });
    }
    return { effectiveCsvText, effectiveInputFiles };
  };

  const prepareAlertPreview = async (alertNode: WorkflowNode, workflowNodes: WorkflowNode[], workflowEdges: Edge[]): Promise<NodeExecutionPreview | undefined> => {
    const contentEdge = workflowEdges.find((edge) => edge.target === alertNode.id && edge.targetHandle === "content");
    if (!contentEdge) return undefined;
    const sourceNode = workflowNodes.find((node) => node.id === contentEdge.source);
    if (sourceNode?.data.nodeType === "ui.input_dialog") {
      const value = String(sourceNode.data.parameters.value ?? "");
      if (!value) return undefined;
      return value.startsWith("data:image/") ? { kind: "plot", plotPngBase64: value.split(",", 2)[1] ?? "" } : { kind: "value", text: value };
    }
    const slice = upstreamSubgraph(workflowNodes, workflowEdges, [contentEdge.source]);
    if (!slice.nodes.length) return undefined;
    const previewSafety = canSafelyPreExecuteNodes(slice.nodes);
    if (!previewSafety.safe) {
      setMessage(`“${alertNode.data.label}”的上游包含副作用或状态节点，已跳过自动预执行预览`);
      return undefined;
    }
    setMessage(`正在准备“${alertNode.data.label}”的当前内容…`);
    const { effectiveCsvText, effectiveInputFiles } = workflowInputPayload(slice.nodes);
    const previewResult = await executeWorkflow(slice.nodes, slice.edges, effectiveCsvText, effectiveInputFiles, runtimePreference, { workspaceId: tabId, workspaceLabel: tabName, clientId: executionClientId, workspaceIdentity, functions });
    return previewResult.nodeResults[contentEdge.source] ?? (previewResult.preview.totalRows || previewResult.preview.totalColumns ? { kind: "table", preview: previewResult.preview } : undefined);
  };

  const submitInputDialog = async () => {
    if (!inputDialogNode) return;
    const kind = String(inputDialogNode.data.parameters.inputKind ?? "text");
    if (kind === "number" && !Number.isFinite(Number(inputDialogValue))) {
      setMessage("请输入有效数值");
      return;
    }
    const context = interactiveRunContext.current ?? { nodes, edges, completed: new Set<string>() };
    const nextNodes = applyRuntimeNodeParameterOverride(context.nodes, inputDialogNode.id, { value: inputDialogValue });
    const completed = new Set<string>(context.completed).add(inputDialogNode.id);
    setInputDialogNode(null);
    await runPrototype(nextNodes, context.edges, completed);
  };

  const submitAlertDialog = async (response: boolean | null) => {
    if (!alertDialogNode) return;
    const context = interactiveRunContext.current ?? { nodes, edges, completed: new Set<string>() };
    const nextNodes = applyRuntimeNodeParameterOverride(context.nodes, alertDialogNode.id, { response });
    const completed = new Set<string>(context.completed).add(alertDialogNode.id);
    setAlertDialogNode(null);
    setAlertDialogPreview(undefined);
    await runPrototype(nextNodes, context.edges, completed);
  };

  const stopCurrentExecution = async () => {
    if (localExecutionActive) {
      if (cancelActiveExecution(workspaceIdentity)) setMessage("正在取消当前工作区执行并等待宿主释放…");
      return;
    }
    const executionId = currentHostExecution?.executionId;
    if (!executionId) return;
    setMessage(currentHostExecution.phase === "queued" ? "正在取消排队任务…" : "正在停止当前工作区执行…");
    const cancelled = await cancelHostExecution(executionId).catch(() => false);
    if (!cancelled) setMessage("当前工作区执行已结束或无法找到对应任务");
    const status = await getHostExecutionStatus().catch(() => emptyHostExecutionStatus(isNativePlatform() ? 1 : 4));
    setHostExecutionLifecycle(status);
  };

  const stopHostExecution = async (target: HostExecutionEntry) => {
    const owner = target.clientId === executionClientId ? (target.workspaceLabel || "其他工作区") : target.source === "remote" ? `远程 · ${target.workspaceLabel || "工作流"}` : `宿主 · ${target.workspaceLabel || "工作流"}`;
    setMessage(`正在停止 ${owner}…`);
    const cancelled = await cancelHostExecution(target.executionId).catch(() => false);
    if (!cancelled) setMessage(`${owner} 已结束或无法找到对应任务`);
    const status = await getHostExecutionStatus().catch(() => emptyHostExecutionStatus(isNativePlatform() ? 1 : 4));
    setHostExecutionLifecycle(status);
    if (status.executions.length <= 1) setHostTaskMenuOpen(false);
  };

  async function runPrototype(workflowNodes: WorkflowNode[] = nodes, workflowEdges: Edge[] = edges, completedInteractiveNodes = new Set<string>(), requestedStopAt?: string) {
    if (["queued", "running", "cancelling"].includes(getExecutionStatus(workspaceIdentity).phase)) return;
    const hostStatus = await getHostExecutionStatus().catch(() => emptyHostExecutionStatus(isNativePlatform() ? 1 : 4));
    setHostExecutionLifecycle(hostStatus);
    const fullOrder = nodesInExecutionOrder(workflowNodes, workflowEdges);
    const stopAt = requestedStopAt ?? (debugMode ? fullOrder.find((node) => debugBreakpoints.has(node.id))?.id : undefined);
    if (stopAt) {
      const included = new Set<string>([stopAt]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const edge of workflowEdges) if (included.has(edge.target) && !included.has(edge.source)) { included.add(edge.source); changed = true; }
      }
      for (const node of workflowNodes) if ((node.parentId && included.has(node.parentId)) || (node.data.canvasParentId && included.has(node.data.canvasParentId))) included.add(node.id);
      workflowNodes = workflowNodes.filter((node) => included.has(node.id));
      workflowEdges = workflowEdges.filter((edge) => included.has(edge.source) && included.has(edge.target));
    }
    const interactiveNode = nodesInExecutionOrder(workflowNodes, workflowEdges).find((node) =>
      ["ui.input_dialog", "ui.alert"].includes(node.data.nodeType) && !completedInteractiveNodes.has(node.id));
    if (interactiveNode) {
      interactiveRunContext.current = { nodes: workflowNodes, edges: workflowEdges, completed: completedInteractiveNodes };
      if (interactiveNode.data.nodeType === "ui.input_dialog") {
        setInputDialogNode(interactiveNode);
        setInputDialogValue(String(interactiveNode.data.parameters.value ?? ""));
      } else {
        try {
          setAlertDialogPreview(await prepareAlertPreview(interactiveNode, workflowNodes, workflowEdges));
          setAlertDialogNode(interactiveNode);
        } catch (error) {
          if (error instanceof ExecutionCancelledError) { setMessage("弹窗内容计算已取消"); return; }
          if (error instanceof ExecutionBusyError) { setMessage(`上一次执行仍在退出（${error.executionId}），请稍后重试`); return; }
          const detail = error instanceof Error ? error.message : "弹窗内容计算失败";
          setExecutionError({ title: "弹窗内容计算失败", message: detail });
          setMessage(detail);
        }
      }
      return;
    }
    const requiresFiles = workflowNodes.some((node) => ["io.read_csv", "io.read_csv_batch", "io.read_table", "io.read_text", "io.read_json", "io.read_image"].includes(node.data.nodeType));
    if (requiresFiles && !csvText && !csvBytes && !csvFiles.length) {
      void chooseCsvSource(workflowNodes.some((node) => node.data.nodeType === "io.read_csv_batch") ? "files" : "files");
      setMessage("请先选择数据文件");
      return;
    }
    const runStartedAt = performance.now();
    const selectedRuntime = resolveExecutionRuntime(runtimePreference, workflowNodes, functions);
    setMessage(`正在执行 ${selectedRuntime.label} 工作流…`);
    setExecutionError(null);
    setErrorDetailOpen(false);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "running" } })));
    try {
      const { effectiveCsvText, effectiveInputFiles } = workflowInputPayload(workflowNodes);
      const nextResult = await executeWorkflow(workflowNodes, workflowEdges, effectiveCsvText, effectiveInputFiles, runtimePreference, { workspaceId: tabId, workspaceLabel: tabName, clientId: executionClientId, workspaceIdentity, functions });
      setResult(nextResult);
      // Workspace variables live outside React state. Refresh their resource view explicitly
      // after every successful execution instead of relying on result identity as an indirect trigger.
      setWorkspaceVariableRevision((value) => value + 1);
      setExecutionError(null);
      setDebugPausedAt(stopAt ?? null);
      setMessage(stopAt ? `调试已暂停在 ${nodes.find((node) => node.id === stopAt)?.data.label ?? stopAt}` : `执行完成 · ${nextResult.runtimeId === "javascript" ? "JS" : "Python"}：${nextResult.preview.totalRows} 行 × ${nextResult.preview.totalColumns} 列`);
      const completed = new Set(nextResult.executionOrder ?? workflowNodes.map((node) => node.id));
      setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: completed.has(node.id) ? "success" : "idle" } })));
    } catch (error) {
      if (error instanceof ExecutionBusyError) {
        setMessage(`上一次执行仍在退出（${error.executionId}），请等待宿主释放后再运行`);
        setExecutionError(null);
        setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
      } else if (error instanceof ExecutionCancelledError) {
        setMessage("执行已取消");
        setExecutionError(null);
        setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
      } else if (error instanceof ExecutionTimeoutError) {
        setMessage(error.message);
        setExecutionError({ title: "工作流执行超时", message: error.message });
        setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
      } else if (error instanceof WorkflowExecutionError) {
        const failingNodeExists = nodes.some((node) => node.id === error.nodeId);
        if (failingNodeExists) setSelectedId(error.nodeId);
        setMessage(`${error.nodeType}：${error.message}`);
        setExecutionError({ title: failingNodeExists ? "节点执行失败" : "工作流执行失败", message: error.message, nodeId: failingNodeExists ? error.nodeId : undefined, nodeType: error.nodeType, traceback: error.details?.debugTraceback });
        const partialResults = error.details?.nodeResults ?? {};
        const partialPreview = error.details?.preview;
        if (partialPreview || Object.keys(partialResults).length) setResult({ status: "success", preview: partialPreview ?? { columns: [], rows: [], totalRows: 0, totalColumns: 0 }, plotPngBase64: null, plotChart: null, exportCsv: null, exports: [], nodeResults: partialResults, nodeTimingsMs: error.details?.nodeTimingsMs, executionOrder: error.details?.executionOrder });
        const completed = new Set(error.details?.executionOrder ?? []);
        setNodes((current) => current.map((node) => ({
          ...node,
          data: { ...node.data, status: node.id === error.nodeId ? "error" : completed.has(node.id) ? "success" : "idle" },
        })));
      } else {
        const detail = error instanceof Error ? error.message : "执行失败";
        setMessage(detail);
        setExecutionError({ title: "工作流执行失败", message: detail });
        setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
      }
    } finally {
      setLastRunDurationMs(performance.now() - runStartedAt);
    }
  }

  const runInAppAutomatedDiagnostics = async () => {
    if (automatedDiagnosticsRunning) return;
    setAutomatedDiagnosticsOpen(true);
    setAutomatedDiagnosticsRunning(true);
    setAutomatedDiagnosticsReport(null);
    setAutomatedDiagnosticsExportStatus(null);
    try {
      const platform = getPlatformAdapter();
      const report = await runAutomatedDiagnostics({
        appVersion: APP_VERSION,
        platformId: platform.id,
        native: isNativePlatform(),
        remote: isRemoteRuntime(),
        activeWorkspaceId: tabId,
        executionClientId,
        activeVariableNames: listWorkspaceVariableNames(workspaceIdentity),
        activeFunctions: functions,
        activeNodeCount: nodes.length,
        activeEdgeCount: edges.length,
        testRemoteHost: canHostRemoteServer() ? async () => {
          const alreadyRunning = Boolean(remoteServer);
          const info = remoteServer ?? await startRemoteServer(true);
          try {
            if (!Number.isFinite(info.port) || info.port <= 0) throw new Error("宿主没有返回有效 HTTP 监听端口");
            const parsed = new URL(info.url);
            if (parsed.protocol !== "http:") throw new Error(`宿主返回了非 HTTP 地址：${info.url}`);
            if (["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error(`宿主只暴露了回环地址：${info.url}`);
            const discovery = info.discovery;
            if (!discovery) throw new Error("宿主没有返回 LAN Discovery 运行状态");
            if (!discovery.interfaces.length) throw new Error("没有发现可用于局域网服务的 IPv4 网络接口");
            if (discovery.ssdp !== "running") throw new Error(`SSDP 未运行：${discovery.ssdp}`);
            if (discovery.mdns !== "running") throw new Error(`mDNS 未运行：${discovery.mdns}`);
            if (!discovery.interfaces.some((item) => item.address === parsed.hostname)) throw new Error(`主访问地址 ${parsed.hostname} 不属于当前发现接口`);
            return {
              nativeHttpReadinessVerified: true,
              url: info.url,
              urls: info.urls ?? [],
              port: info.port,
              discovery,
              serviceWasAlreadyRunning: alreadyRunning,
            };
          } finally {
            if (!alreadyRunning) await stopRemoteServer();
          }
        } : undefined,
        executeWithRuntime: (runtimeId, diagnosticNodes, diagnosticEdges, diagnosticCsvText, options) => executeWorkflowWithRuntime(runtimeId, diagnosticNodes, diagnosticEdges, diagnosticCsvText, [], { ...options, clientId: executionClientId }),
      });
      setAutomatedDiagnosticsReport(report);
      const json = JSON.stringify(report, null, 2);
      void saveUserProfileFile("logs/automated-diagnostics-latest.json", json).catch(() => undefined);
      setMessage(report.summary.failed ? `自动诊断完成：${report.summary.failed} 项失败，请导出结果` : `自动诊断通过：${report.summary.passed}/${report.summary.total}`);
    } catch (error) {
      setMessage(error instanceof Error ? `自动诊断启动失败：${error.message}` : "自动诊断启动失败");
    } finally {
      setAutomatedDiagnosticsRunning(false);
    }
  };

  const copyAutomatedDiagnostics = async () => {
    if (!automatedDiagnosticsReport) return;
    await navigator.clipboard.writeText(JSON.stringify(automatedDiagnosticsReport, null, 2));
    setMessage("已复制完整自动诊断结果，可直接粘贴给开发者");
  };

  const exportAutomatedDiagnostics = async () => {
    if (!automatedDiagnosticsReport) return;
    const stamp = automatedDiagnosticsReport.createdAt.replace(/[:.]/g, "-");
    const fileName = `pydroid-diagnostics-${APP_VERSION}-${stamp}.json`;
    try {
      const exported = await exportTextFile(fileName, JSON.stringify(automatedDiagnosticsReport, null, 2), "application/json");
      if (!exported.saved) {
        const status = "已取消导出。最近一次结果仍保存在应用内部日志中。";
        setAutomatedDiagnosticsExportStatus(status);
        setMessage(status);
        return;
      }
      const destination = exported.destination?.trim();
      const status = isNativePlatform()
        ? `已保存${destination ? `：${destination}` : "到系统文件选择器指定的位置"}`
        : `已导出${destination ? `到${destination}` : ""}`;
      setAutomatedDiagnosticsExportStatus(status);
      setMessage(status);
    } catch (error) {
      const status = `导出失败：${readableError(error, "无法写入诊断 JSON")}`;
      setAutomatedDiagnosticsExportStatus(status);
      setMessage(status);
    }
  };

  const agentTransport: AgentTransport | undefined = remoteBrowser && remoteAgentProxyAvailable
    ? (settings, body) => proxyRemoteAgentRequest(settings.provider, body)
    : undefined;

  const requestPlanFromAgent = async () => {
    setAgentRequesting(true);
    try {
      const nextPlan = await requestAgentPlan(agentSettings, agentApiKey, agentInstruction, NODE_CATALOG.map((spec) => ({
        nodeType: spec.nodeType,
        label: spec.label,
        description: spec.description,
        parameters: spec.parameters.map((parameter) => ({ key: parameter.key, kind: parameter.kind, required: parameter.required })),
        inputPorts: spec.inputPorts.map((port) => ({ id: port.id, valueType: port.valueType, required: port.required })),
        outputPorts: spec.outputPorts.map((port) => ({ id: port.id, valueType: port.valueType })),
      })), {
        nodes: nodes.map((node) => ({ id: node.id, label: node.data.label, nodeType: node.data.nodeType, parentId: node.parentId ?? node.data.canvasParentId, branch: node.data.branch, parameterKeys: nodeSpecFor(node)?.parameters.map((parameter) => parameter.key) ?? [], inputs: nodeSpecFor(node)?.inputPorts.map((port) => ({ id: port.id, type: port.valueType, required: port.required })) ?? [], outputs: nodeSpecFor(node)?.outputPorts.map((port) => ({ id: port.id, type: port.valueType })) ?? [] })),
        edges: edges.map((edge) => ({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? "output", targetHandle: edge.targetHandle ?? "input" })),
        runtimePreference,
      }, agentTransport);
      setAgentPlanText(JSON.stringify(nextPlan, null, 2));
      setAgentPlan(nextPlan);
      setAgentPlanError(null);
      setMessage(`AI 已提出 ${nextPlan.operations.length} 项操作，等待你的确认`);
    } catch (error) {
      setAgentPlan(null);
      setAgentPlanError(error instanceof Error ? error.message : "AI 请求失败");
    } finally {
      setAgentRequesting(false);
    }
  };

  const testCurrentAgentConnection = async () => {
    setAgentTesting(true);
    setAgentConnectionStatus(null);
    try {
      const result = await testAgentConnection(agentSettings, agentApiKey, agentTransport);
      setAgentConnectionStatus(result.message);
    } catch (error) {
      setAgentConnectionStatus(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setAgentTesting(false);
    }
  };

  const selectAgentPreset = (presetId: string) => {
    const preset = presetById(presetId);
    setAgentSettings((current) => ({ ...current, presetId: preset.id, provider: preset.provider, endpoint: preset.endpoint, model: preset.models.includes(current.model) ? current.model : preset.models[0] ?? "" }));
    setAgentConnectionStatus(null);
  };

  const reviewAgentPlan = () => {
    try {
      const nextPlan = parseAgentPlan(agentPlanText);
      for (const operation of nextPlan.operations) {
        const permission = agentPermissionFor(operation);
        if (!agentSettings.permissions[permission]) throw new Error(`未授权 AI 执行：${permission}`);
      }
      const validation = validateAgentPlan(nextPlan, {
        nodes: nodes.map((node) => ({ id: node.id, nodeType: node.data.nodeType, parameterKeys: nodeSpecFor(node)?.parameters.map((parameter) => parameter.key) ?? [], inputs: nodeSpecFor(node)?.inputPorts.map((port) => ({ id: port.id, type: port.valueType, required: port.required })) ?? [], outputs: nodeSpecFor(node)?.outputPorts.map((port) => ({ id: port.id, type: port.valueType })) ?? [] })),
        edges: edges.map((edge) => ({ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? "output", targetHandle: edge.targetHandle ?? "input" })),
        runtimePreference,
      });
      if (validation.length) throw new Error(validation.join("；"));
      setAgentPlan(nextPlan);
      setAgentPlanError(null);
      setMessage(`AI 计划已检查：${nextPlan.operations.length} 项操作等待确认`);
    } catch (error) {
      setAgentPlan(null);
      setAgentPlanError(error instanceof Error ? error.message : "AI 计划无法解析");
    }
  };

  const applyAgentPlan = async () => {
    if (!agentPlan) return;
    try {
      const applied = applyAgentOperationsToSession(session, agentPlan.operations, {
        canvasId: currentCanvasId,
        viewportWidth,
        createNode,
        isAllowed: (operation) => agentSettings.permissions[agentPermissionFor(operation)],
      });
      if (applied.requestedDirection) setLayoutMode(applied.requestedDirection);
      clearExecutionResult();
      setAgentAudit((current) => [{ at: new Date().toISOString(), summary: agentPlan.summary, result: `已应用 ${agentPlan.operations.length} 项操作${applied.runRequested ? "，并请求运行" : ""}` }, ...current].slice(0, 30));
      setMessage(`AI 计划已应用：${agentPlan.operations.length} 项操作`);
      if (applied.runRequested) await runPrototype(applied.snapshot.nodes, applied.snapshot.edges);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "AI 计划应用失败";
      setAgentPlanError(detail);
      setAgentAudit((current) => [{ at: new Date().toISOString(), summary: agentPlan.summary, result: `已拒绝：${detail}` }, ...current].slice(0, 30));
    }
  };

  const renderParameterFields = (parameters: ParameterSpec[]) => parameters.map((parameter) => (
    <ParameterField
      key={parameter.key}
      spec={parameter}
      value={selectedNode?.data.parameters[parameter.key] ?? selectedSpec?.defaults[parameter.key]}
      onChange={(value) => updateParameter(parameter.key, value)}
      onExpand={parameter.key === "code" ? () => setCodeEditorOpen(true) : undefined}
    />
  ));
  const basicParameters = selectedSpec?.parameters.filter((parameter) => !parameter.advanced) ?? [];
  const advancedParameters = selectedSpec?.parameters.filter((parameter) => parameter.advanced) ?? [];
  const rememberedParameterCount = selectedSpec?.parameters.filter((parameter) => parameter.rememberDefault).length ?? 0;
  const resultPanel = result ? (
    <section className={`result-panel ${resultDock === "bottom" ? "result-panel--bottom" : ""}`}>
      {resultDock === "bottom" && <div className="result-resizer" role="separator" aria-orientation="horizontal" aria-label="调整底部结果区高度" onPointerDown={startResultResize} />}
      <div className="result-panel__heading">
        <h3>{ui("结果预览", "Result preview")}</h3>
        <div className="result-actions">
          <label><input type="checkbox" checked={livePreview} onChange={(event) => setLivePreview(event.target.checked)} />{ui("实时预览", "Live preview")}</label>
          <div className="result-dock-switch" role="group" aria-label="结果区域位置">
            <button className={resultDock === "right" ? "active" : ""} title="结果显示在参数栏右侧" aria-label="结果显示在右侧" onClick={() => { setResultDock("right"); setInspectorCollapsed(false); }}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>
            <button className={resultDock === "bottom" ? "active" : ""} title="结果显示在画布底部" aria-label="结果显示在底部" onClick={() => setResultDock("bottom")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/></svg></button>
          </div>
          {(result.exports?.length ? result.exports : result.exportCsv ? [{ nodeId: "legacy", fileName: "result.csv", content: result.exportCsv }] : []).map((item) => <button className="download-link" key={item.nodeId} onClick={() => downloadText(item.content, item.fileName, "text/csv;charset=utf-8")}>下载 {item.fileName}</button>)}
        </div>
      </div>
      <p className="result-summary">{result.preview.totalRows} 行 × {result.preview.totalColumns} 列</p>
      {Object.entries(result.nodeResults).filter(([nodeId]) => nodes.find((node) => node.id === nodeId)?.data.nodeType === "python.print").length > 0 && <section className="print-results" aria-label="打印结果"><strong>打印结果</strong>{Object.entries(result.nodeResults).filter(([nodeId]) => nodes.find((node) => node.id === nodeId)?.data.nodeType === "python.print").map(([nodeId, preview]) => <article key={nodeId}><span>{nodes.find((node) => node.id === nodeId)?.data.label ?? "打印输出"}</span><code>{preview.kind === "value" ? preview.text : ""}</code></article>)}</section>}
      <div className="result-content">
        <DataGrid preview={result.preview} onExpand={() => setResultDetail({ title: "工作流结果", text: JSON.stringify(result.preview, null, 2), preview: result.preview })} />
        {(() => { const preview: Extract<NodeExecutionPreview, { kind: "plot" }> | null = result.plotChart ? { kind: "plot", chart: result.plotChart } : result.plotPngBase64 ? { kind: "plot", plotPngBase64: result.plotPngBase64 } : null; return preview ? <button className="plot-preview-button" onClick={() => { setPlotZoom(1); setPlotExpandedPreview(preview); }}><PlotPreview preview={preview} className="plot-preview" alt="工作流绘图结果；点击放大" /></button> : null; })()}
      </div>
    </section>
  ) : null;
  const workspaceStyle = {
    "--inspector-width": `${inspectorWidth}px`,
    "--inspector-height": `${inspectorHeight}px`,
    "--palette-width": `${paletteWidth}px`,
    "--result-height": `${resultHeight}px`,
    "--edge-width": `${edgeWidth}px`,
  } as CSSProperties;

  return (
    <div className={`app-shell ${isNativePlatform() ? "native-platform" : ""} ${showNodeInsights ? "show-node-insights" : ""}`} data-theme={resolvedTheme}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/pydroid-resource")) updatePaletteDragPreviewAt(event.clientX, event.clientY);
        if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
      }}
      onDrop={(event) => void handleFileDrop(event)}>
      <img ref={desktopDragImageElement} className="native-drag-image-shim" alt="" aria-hidden="true" draggable={false} src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==" />
      <header className="topbar">
        {isNativePlatform() && <strong className="mobile-brand" aria-label="PyDroid Node">PyDroid Node</strong>}
        <TabBar />
        <div className="topbar__actions">
          <input ref={fileInput} className="file-input" type="file" accept=".csv,.tsv,.txt,.dat,.json,.png,.jpg,.jpeg,text/*,application/json,image/*" multiple onChange={chooseCsv} />
          <input ref={(element) => { directoryInput.current = element; if (element) { element.setAttribute("webkitdirectory", ""); element.setAttribute("directory", ""); } }} className="file-input" type="file" multiple onChange={chooseCsv} />
          <input ref={workflowInput} className="file-input" type="file" accept=".json,.ipynb,application/json,application/x-ipynb+json" onChange={importWorkflow} />
          <input ref={notebookInput} className="file-input" type="file" accept=".ipynb,application/x-ipynb+json,application/json" onChange={importNotebook} />
          <input ref={templateInput} className="file-input" type="file" accept=".json,application/json" onChange={importCustomTemplate} />
          <input ref={settingsInput} className="file-input" type="file" accept=".json,application/json" onChange={importSettings} />
          <button className="button secondary icon-button topbar-tool-action" title="撤销（Ctrl+Z）" aria-label="撤销" disabled={!session.history.canUndo} onClick={undo}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5" /><path d="M4 12h9a7 7 0 0 1 7 7" /></svg>
          </button>
          <button className="button secondary icon-button topbar-tool-action" title="重做（Ctrl+Y）" aria-label="重做" disabled={!session.history.canRedo} onClick={redo}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5" /><path d="M20 12h-9a7 7 0 0 0-7 7" /></svg>
          </button>
          <button className="button secondary icon-button topbar-tool-action" title="AI Agent" aria-label="AI Agent" onClick={() => setAgentPanelOpen(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 5.3L19 10l-5.5 1.7L12 17l-1.5-5.3L5 10l5.5-1.7L12 3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></svg>
          </button>
          <button className="button secondary icon-button topbar-tool-action" title="设置" aria-label="设置" onClick={() => setSettingsOpen(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14" /><circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="11" cy="18" r="1.7" /></svg>
          </button>
          {canHostRemoteServer() && <button className={`button ${remoteServer ? "primary" : "secondary"} icon-button optional-action topbar-tool-action`} title={remoteServer ? "关闭局域网网页服务" : "开启局域网网页服务：其他设备通过浏览器操作，本机完成计算"} aria-label={remoteServer ? "关闭局域网网页服务" : "开启局域网网页服务"} onClick={() => void toggleRemoteServer()}>
            <svg className="airdrop-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2" /><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4" /><path d="M4.7 19.3a10.3 10.3 0 0 1 0-14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6" /></svg>
          </button>}
          <button className="button secondary icon-button topbar-tool-action" title="Python 包管理" aria-label="Python 包管理" onClick={() => void openPackageManager()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5V16l-8 5-8-5V7.5Z" /><path d="M12 12v9" /></svg>
          </button>
          <div className="mobile-tools-overflow">
            <button type="button" className="button secondary icon-button mobile-tools-overflow__trigger" title="更多工具" aria-label="更多工具" aria-expanded={mobileToolsOpen} onClick={() => setMobileToolsOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><g className="mobile-tools-overflow__dots"><circle cx="6" cy="9" r="1.35"/><circle cx="12" cy="9" r="1.35"/><circle cx="18" cy="9" r="1.35"/></g><path className="mobile-tools-overflow__chevron" d="m8.75 15.5 3.25 3.1 3.25-3.1"/></svg>
            </button>
            {mobileToolsOpen && <div className="mobile-tools-menu" role="menu">
              <button type="button" onClick={() => { setMobileToolsOpen(false); undo(); }} disabled={!session.history.canUndo}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7"/></svg><span>{ui("撤销", "Undo")}</span></button>
              <button type="button" onClick={() => { setMobileToolsOpen(false); redo(); }} disabled={!session.history.canRedo}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5"/><path d="M20 12h-9a7 7 0 0 0-7 7"/></svg><span>{ui("重做", "Redo")}</span></button>
              <button type="button" onClick={() => { setMobileToolsOpen(false); setAgentPanelOpen(true); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 5.3L19 10l-5.5 1.7L12 17l-1.5-5.3L5 10l5.5-1.7L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg><span>AI Agent</span></button>
              <button type="button" onClick={() => { setMobileToolsOpen(false); setSettingsOpen(true); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="11" cy="18" r="1.7"/></svg><span>{ui("设置", "Settings")}</span></button>
              {canHostRemoteServer() && <button type="button" onClick={() => { setMobileToolsOpen(false); void toggleRemoteServer(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M4.7 19.3a10.3 10.3 0 0 1 0-14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6"/></svg><span>{remoteServer ? "关闭局域网" : "开启局域网"}</span></button>}
              <button type="button" onClick={() => { setMobileToolsOpen(false); void openPackageManager(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5V16l-8 5-8-5V7.5Z"/><path d="M12 12v9"/></svg><span>{ui("Python 包管理", "Python packages")}</span></button>
              <button type="button" className="mobile-tools-menu__compact-only" onClick={() => { setMobileToolsOpen(false); requestNewWorkflow(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>{ui("新建工作流", "New workflow")}</span></button>
              <button type="button" className="mobile-tools-menu__compact-only" onClick={() => { setMobileToolsOpen(false); workflowInput.current?.click(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg><span>{ui("导入工作流", "Import workflow")}</span></button>
              <button type="button" className="mobile-tools-menu__compact-only" onClick={() => { setMobileToolsOpen(false); saveWorkflow(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4"/><path d="M8 20v-6h8v6"/></svg><span>{ui("保存工作流", "Save workflow")}</span></button>
            </div>}
          </div>
          <i className="topbar-divider" aria-hidden="true" />
          <button className="button secondary optional-action topbar-file-action" onClick={requestNewWorkflow}>{ui("新建", "New")}</button>
          <button className="button secondary optional-action topbar-file-action" onClick={() => workflowInput.current?.click()}>{ui("导入", "Import")}</button>
          <button className="button secondary optional-action topbar-file-action" onClick={saveWorkflow}>{ui("保存", "Save")}</button>
          <button className="button primary topbar-run" title={isRunning ? `停止当前工作区执行${visibleExecutionId ? ` · ${visibleExecutionId}` : ""}` : `运行当前工作区${hostExecutionLifecycle.active ? ` · 宿主另有 ${hostExecutionLifecycle.runningCount} 个运行 / ${hostExecutionLifecycle.queuedCount} 个排队` : ""}`} onClick={() => { if (isRunning) void stopCurrentExecution(); else void runPrototype(); }}>{isRunning ? (executionLifecycle.phase === "cancelling" || currentHostExecution?.phase === "cancelling" ? ui("取消中…", "Cancelling…") : currentHostExecution?.phase === "queued" ? ui("取消排队", "Cancel queued") : ui("停止", "Stop")) : ui("运行", "Run")}</button>
        </div>
      </header>

      {remoteServer && remoteBannerVisible && <aside className="remote-server-banner" role="status">
        <div className="remote-server-banner__identity">
          <strong className="remote-server-banner__status">计算服务已开启</strong>
          <code>{remoteServer.url}</code>
        </div>
        <button className="remote-server-banner__copy" onClick={() => void copyRemoteUrl()}>复制地址</button>
        {remoteServer.requiresPin && <span className="remote-server-banner__pin">PIN {remoteServer.pin}</span>}
        <button className="remote-server-banner__collapse" title="收起到状态栏" aria-label="收起计算服务信息到状态栏" onClick={() => setRemoteBannerVisible(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
      </aside>}

      <main style={workspaceStyle} className={`workspace ${paletteCollapsed ? "palette-collapsed" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""} ${inspectorDock === "bottom" ? "inspector-bottom" : "inspector-right"} ${result && resultDock === "bottom" ? "result-bottom" : ""}`}>
        <aside className="node-palette">
          <div className="sidebar-resizer sidebar-resizer--palette" role="separator" aria-orientation="vertical" aria-label="调整节点列表宽度" onPointerDown={(event) => startSidebarResize("palette", event)} />
          <div className="palette-fixed">
            <div className="palette-heading"><h2>{ui("资源", "Resources")}</h2><button className="download-link" title="隐藏节点列表" onClick={() => setPaletteCollapsed(true)}>{ui("收起", "Collapse")}</button></div>
            <nav className="palette-tabs" aria-label="资源分类"><button className={paletteTab === "nodes" ? "active" : ""} onClick={() => setPaletteTab("nodes")}><span className="palette-tabs__icon" aria-hidden="true">◆</span><span className="palette-tabs__label">{ui("节点", "Nodes")}</span></button><button className={paletteTab === "functions" ? "active" : ""} onClick={() => setPaletteTab("functions")}><span className="palette-tabs__icon" aria-hidden="true">ƒ</span><span className="palette-tabs__label">{ui("函数", "Functions")}</span></button><button className={paletteTab === "groups" ? "active" : ""} onClick={() => setPaletteTab("groups")}><span className="palette-tabs__icon" aria-hidden="true">⧉</span><span className="palette-tabs__label">{ui("组合", "Groups")}</span></button><button className={paletteTab === "flows" ? "active" : ""} onClick={() => setPaletteTab("flows")}><span className="palette-tabs__icon" aria-hidden="true">◇</span><span className="palette-tabs__label">{ui("流程", "Flows")}</span></button></nav>
            <label className="node-search"><input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder={ui("搜索内置或导入节点", "Search built-in or imported nodes")} /><span>{matchedCatalog.length}</span></label>
          </div>
          <div className="palette-content">
            {paletteTab === "nodes" && <>{savedNodeLibrary.length > 0 && <section className="palette-group palette-group--custom"><h3>我的节点<small>{savedNodeLibrary.length} · 可拖拽排序</small></h3>{savedNodeLibrary.map((entry) => { const descriptor = describeSavedNode(entry); const resource = resourceRef(descriptor); return <button draggable={finePointer && descriptor.capabilities.draggable} key={entry.id} className={savedNodeDragOverId === entry.id ? "palette-sort-target" : ""} onDragStart={(event) => onPaletteDragStart(event, resource)} onDrag={updatePaletteDragPreview} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/pydroid-resource")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setSavedNodeDragOverId(entry.id); } }} onDragLeave={() => setSavedNodeDragOverId((current) => current === entry.id ? null : current)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setSavedNodeDragOverId(null); const data = event.dataTransfer.getData("application/pydroid-resource"); if (data) { try { const dragged = JSON.parse(data) as PaletteResource; if (dragged.kind === "saved-node") reorderSavedNodes(dragged.id, entry.id); } catch { /* 忽略无效拖拽数据 */ } } }} onDragEnd={clearPaletteDrag} onContextMenu={(event) => onPaletteResourceContextMenu(event, resource)} onPointerDown={(event) => { if (event.pointerType !== "mouse") onPalettePointerDown(event, resource); }} onPointerMove={(event) => { if (event.pointerType !== "mouse") onPalettePointerMove(event); }} onPointerUp={(event) => { if (event.pointerType !== "mouse") onPalettePointerUp(event); }} onPointerCancel={() => { clearPaletteResourceMenuHold(); clearPaletteDrag(); }} onClick={() => { if (palettePointerDragHandled.current) { palettePointerDragHandled.current = false; return; } insertSavedNode(entry); }} title="加入保存的节点与参数 · 长按管理"><strong>◇ {entry.name}</strong><small>{entry.node.data.nodeType} · 已保存参数</small></button>; })}</section>}
            {[...catalogGroups.entries()].map(([category, specs]) => (
              <section className="palette-group" key={category}>
                <h3>{category}</h3>
                {specs.map((spec) => { const resource = resourceRef(describeCatalogNode(spec.nodeType, spec.label)); return <button draggable={false} key={spec.nodeType} title={`按住后拖到画布添加 · ${spec.pythonCallable ?? spec.nodeType}${spec.description ? ` · ${spec.description}` : ""}`} onContextMenu={(event) => onPaletteResourceContextMenu(event, resource)} onPointerDown={(event) => onPalettePointerDown(event, resource)} onPointerMove={onPalettePointerMove} onPointerUp={onPalettePointerUp} onPointerCancel={() => { clearPaletteResourceMenuHold(); clearPaletteDrag(); }}>⠿ <strong>{spec.label}</strong>{nodeSearch && <small>{spec.pythonCallable ?? spec.nodeType}</small>}</button>; })}
              </section>
            ))}
            {nodeSearch && matchedCatalog.length === 0 && <p className="muted">没有匹配节点。可添加“Python 函数”并粘贴带类型标注的函数签名。</p>}</>}
            {paletteTab === "groups" && <>{groupLibrary.map((entry) => { const descriptor = describeGroup(entry); const resource = resourceRef(descriptor); return <section className={`palette-group palette-group--custom ${entry.builtIn ? "palette-group--default" : ""}`} key={entry.id}><h3>{entry.name}<small>{entry.builtIn ? "内置组合" : "我的组合"}</small></h3><button className="group-resource-card" draggable={false} title={`拖动添加 · 静止长按约 0.7 秒或双击打开菜单 · ${entry.nodes.filter((node) => node.data.nodeType !== "workflow.group").length} 个节点${entry.description ? ` · ${entry.description}` : ""}`} onContextMenu={(event) => onPaletteResourceContextMenu(event, resource)} onPointerDown={(event) => onPalettePointerDown(event, resource)} onPointerMove={onPalettePointerMove} onPointerUp={onPalettePointerUp} onPointerCancel={() => { clearPaletteResourceMenuHold(); clearPaletteDrag(); }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); palettePointerDragHandled.current = true; openPaletteMenuFromElement(resource, event.currentTarget); window.setTimeout(() => { palettePointerDragHandled.current = false; }, 450); }} onClick={(event) => { if (palettePointerDragHandled.current) { palettePointerDragHandled.current = false; return; } if (event.detail > 1) { clearPaletteResourceClick(); return; } if (pointerMode === "mouse") schedulePaletteSingleClick(() => insertGroupTemplate(entry)); }}><strong>◇ {entry.name}</strong><small>{entry.nodes.filter((node) => node.data.nodeType !== "workflow.group").length} 个节点</small></button></section>; })}{!groupLibrary.length && <p className="muted">选中多个节点后点击“组合”，然后在其长按菜单中保存为组合。</p>}</>}
            {paletteTab === "functions" && <>
              <section className="palette-group palette-group--custom workflow-language-state"><h3>{ui("工作区变量", "Workspace variables")}<small>{workspaceVariableNames.length} · {ui("当前标签页", "current tab")}</small></h3>{workspaceVariableNames.length ? <div className="workflow-variable-list">{workspaceVariableNames.map((name) => <code key={name}>{name}</code>)}</div> : <p className="muted">{ui("尚未写入工作区变量。使用“设置工作区变量”节点后会显示在这里。", "No workspace variables yet. Use a Set Workspace Variable node to create one.")}</p>}<button className="secondary" disabled={!workspaceVariableNames.length} onClick={clearWorkspaceVariables}>{ui("清空当前标签变量", "Clear tab variables")}</button></section>
              {functions.map((definition) => { const resource = describeFunction(definition); return <section className="palette-group palette-group--custom workflow-function-card" key={resource.id}><h3>{resource.label}<small>v{definition.version} · {functionCallCount(nodes, definition.id)} {ui("个调用", "calls")}</small></h3>{resource.description && <p className="muted">{resource.description}</p>}<div className="flow-library-actions"><button className="primary" onClick={() => insertFunctionCall(definition)}>{ui("调用", "Call")}</button><button onClick={() => insertFunctionEditableGroup(definition)}>{ui("展开编辑", "Edit copy")}</button><button onClick={() => void deleteWorkflowFunction(definition)}>{ui("删除", "Delete")}</button></div><small>{definition.inputs.length} {ui("输入", "inputs")} · {definition.outputs.length} {ui("输出", "outputs")}</small></section>; })}
              {!functions.length && <p className="muted">{ui("先将节点组合，然后在组合检查器中选择“保存为函数”。函数会随工作流一起保存。", "Group nodes first, then choose Save as function in the group inspector. Functions are stored with the workflow.")}</p>}
            </>}
            {paletteTab === "flows" && <><div className="flow-library-actions"><button onClick={() => void configureWorkflowFolder()}>选择用户文件夹</button><button onClick={() => void refreshExternalWorkflowLibrary()}>刷新扫描</button></div>{userProfile && <small className="flow-library-path">{userProfile.workspaceUri ? "已扫描外部文件夹" : "当前使用应用流程库"}：{userProfile.workspaceUri ?? userProfile.path}</small>}{flowLibrary.map((entry) => { const descriptor = describeFlow(entry); const resource = resourceRef(descriptor); return <button draggable={false} className={`flow-library-item ${entry.locked ? "locked" : ""}`} key={entry.id} onContextMenu={(event) => onPaletteResourceContextMenu(event, resource)} onPointerDown={(event) => onPalettePointerDown(event, resource)} onPointerMove={onPalettePointerMove} onPointerUp={onPalettePointerUp} onPointerCancel={clearPaletteDrag} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); palettePointerDragHandled.current = true; openPaletteMenuFromElement(resource, event.currentTarget); window.setTimeout(() => { palettePointerDragHandled.current = false; }, 450); }} onClick={(event) => { if (palettePointerDragHandled.current) { palettePointerDragHandled.current = false; return; } if (event.detail > 1) { clearPaletteResourceClick(); return; } schedulePaletteSingleClick(() => openLibraryFlow(entry)); }}><strong>◇ {entry.name}{entry.locked ? "  🔒" : ""}</strong><small>{entry.savedAt ? new Date(entry.savedAt).toLocaleString() : "外部文件夹"} · 可拖入画布 · 长按/双击管理</small></button>; })}{!flowLibrary.length && <p className="muted">点击顶部“保存”后，完整流程会出现在这里；Android 可选择任意用户可访问文件夹，自动扫描其中 JSON 工作流。</p>}</>}
          </div>
        </aside>

        <section
          ref={canvasPanelRef}
          className={`canvas-panel ${touchMarquee ? "touch-marquee-active" : ""}`}
          onPointerDownCapture={onCanvasPointerDown}
          onPointerMoveCapture={onCanvasPointerMove}
          onPointerUpCapture={onCanvasPointerUp}
          onPointerCancelCapture={onCanvasPointerCancel}
          onDragOver={(event) => { if (event.dataTransfer.types.includes("application/pydroid-resource")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; updatePaletteDragPreviewAt(event.clientX, event.clientY); } }}
          onDrop={onCanvasDrop}
        >
          {touchMarquee && <div className="touch-marquee" aria-hidden="true" style={{ left: Math.min(touchMarquee.startX, touchMarquee.currentX), top: Math.min(touchMarquee.startY, touchMarquee.currentY), width: Math.abs(touchMarquee.currentX - touchMarquee.startX), height: Math.abs(touchMarquee.currentY - touchMarquee.startY) }} />}
          {viewMode === "nodes" ? <NodeLayoutContext.Provider value={resolvedLayoutDirection}><NodeAppearanceContext.Provider value={{ nodeScale, endpointScale }}><NodeSelectionContext.Provider value={{ active: selectionMode, toggle: toggleNodeSelection, remove: (nodeId) => deleteNodes([nodeId]) }}><NodeInsightContext.Provider value={{ visible: showNodeInsights, results: result?.nodeResults ?? {} }}><EdgeActionsContext.Provider value={{ disconnect: (ids) => disconnectEdges(ids) }}><ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onWorkflowNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            edgesReconnectable={finePointer}
            onReconnectStart={() => { reconnectSucceeded.current = false; setMessage("拖动连线端点到空白处可断开，拖到其他兼容端口可改接"); }}
            onReconnect={onReconnect}
            onReconnectEnd={(_event, edge, _handleType, connectionState) => { if (!reconnectSucceeded.current && !connectionState.toNode) disconnectEdges([edge.id]); reconnectSucceeded.current = false; }}
            onEdgeDoubleClick={(event, edge) => { event.preventDefault(); event.stopPropagation(); disconnectEdges([edge.id]); }}
            onEdgeContextMenu={(event, edge) => { event.preventDefault(); setEdges((current) => current.map((item) => ({ ...item, selected: item.id === edge.id }))); setMessage("已选中连线；按 Delete / Backspace 断开，或双击直接断开"); }}
            connectionLineType={ConnectionLineType.Bezier}
            defaultEdgeOptions={{ type: "default" }}
            isValidConnection={isValidConnection}
            onError={(code, detail) => setMessage(`画布连线提示 ${code}：${detail}`)}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, node) => {
              if (suppressNextNodeClick.current) { suppressNextNodeClick.current = false; return; }
              if (selectionMode) toggleNodeSelection(node.id); else setSelectedId(node.id);
            }}
            onNodeDoubleClick={(event, node) => {
              event.preventDefault();
              const profile = pointerMode === "mouse" && finePointer ? "desktop" : "mobile";
              const action = resolveGesturePolicy(profile, gestureTargetForNodeType(node.data.nodeType)).doubleTap;
              if (action === "open-group") { openSubflowGroup(node.id); return; }
              if (action === "open-context-menu") openNodeMenu(node.id, event.clientX, event.clientY);
            }}
            onSelectionChange={onSelectionChange}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              const profile = pointerMode === "mouse" && finePointer ? "desktop" : "mobile";
              const policy = resolveGesturePolicy(profile, gestureTargetForNodeType(node.data.nodeType));
              if (profile === "mobile" || policy.contextMenu === "none" || Date.now() < nodeTouchDragSuppressMenuUntil.current) return;
              if (node.selected && selectedIds.length > 1) openSelectionMenu(event.clientX, event.clientY);
              else if (policy.contextMenu === "open-context-menu") openNodeMenu(node.id, event.clientX, event.clientY);
            }}
            onSelectionContextMenu={(event, selected) => {
              event.preventDefault();
              const ids = selected.map((node) => node.id);
              setSelectedIds(ids);
              setSelectedId(ids.length === 1 ? ids[0] : null);
              openSelectionMenu(event.clientX, event.clientY);
            }}
            onPaneContextMenu={(event) => {
              if (!finePointer || !selectedIds.length) return;
              event.preventDefault();
              openSelectionMenu(event.clientX, event.clientY);
            }}
            onPaneClick={() => { setContextMenu(null); setSelectionMenu(null); setFlowMenu(null); setResourceMenu(null); if (!selectionMode) { setSelectedId(null); setSelectedIds([]); } }}
            selectionOnDrag={finePointer && pointerMode === "mouse"}
            panOnDrag={finePointer && pointerMode === "mouse" ? [1, 2] : false}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            fitView
            minZoom={0.25}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
            {showMiniMap && <MiniMap pannable zoomable />}
            <Controls />
          </ReactFlow></EdgeActionsContext.Provider></NodeInsightContext.Provider></NodeSelectionContext.Provider></NodeAppearanceContext.Provider></NodeLayoutContext.Provider> : <div className="notebook-view">
            <header>
              <div><strong>Python Notebook</strong><span>可运行的 pandas / NumPy / Matplotlib 代码 · # %% 单元格</span></div>
              <div>
                <button className="primary" disabled={notebookRunningCell !== null} onClick={() => void runNotebook()}>{notebookRunningCell === "all" ? "运行中…" : "▶ 运行全部"}</button>
                <button onClick={() => notebookInput.current?.click()}>导入 .ipynb</button>
                <button onClick={() => setNotebookCells((current) => [...current, { id: `cell-${Date.now()}`, cellType: "code", source: "# 新代码单元格\n" }])}>＋代码</button>
                <button onClick={() => setNotebookCells((current) => [...current, { id: `cell-${Date.now()}`, cellType: "markdown", source: "## 新说明\n" }])}>＋文本</button>
                <button onClick={() => { const expanded = flattenWorkflowGroups(nodes, edges); setNotebookCells(workflowNotebookCells(expanded.nodes, expanded.edges, requirements)); setNotebookMetadata({}); }}>从节点刷新</button>
                <button onClick={() => downloadText(serializeJupyterNotebookCells("PyDroid Flow 工作流", notebookCells, notebookMetadata), "pydroid-flow.ipynb", "application/x-ipynb+json")}>导出 .ipynb</button>
                <button className="primary" onClick={applyNotebook}>应用到节点视图</button>
              </div>
            </header>
            {notebookError && <p className="notebook-error">{notebookError}</p>}
            <div className="notebook-cells">
              {notebookCells.map((cell, index) => <div className={`notebook-cell notebook-cell--${cell.cellType}`} key={cell.id}>
                <div className="notebook-prompt"><span>{cell.cellType === "code" ? `In [${cell.executionCount ?? " "}]` : "文本"}</span>{cell.cellType === "code" && <button className="notebook-run-cell" title="运行到此单元格" disabled={notebookRunningCell !== null} onClick={() => void runNotebook(index)}>{notebookRunningCell === index ? "…" : "▶"}</button>}<button title="切换代码/文本单元格" onClick={() => setNotebookCells((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, cellType: item.cellType === "code" ? "markdown" : "code" } : item))}>↔</button><button title="删除单元格" onClick={() => setNotebookCells((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>
                <div className="notebook-cell__content"><NotebookEditor value={cell.source} rows={notebookCellRows(cell.source)} onChange={(source) => {
                    setNotebookCells((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, source } : item));
                    setNotebookCellResults((current) => { const next = { ...current }; delete next[cell.id]; return next; });
                    setNotebookError(null);
                  }} />{notebookCellResults[cell.id] && <div className="notebook-cell__output"><span>Out [{cell.executionCount ?? " "}]</span>{(() => { const preview = notebookCellResults[cell.id]; return preview.kind === "table" ? <DataGrid preview={preview.preview} /> : preview.kind === "plot" ? <PlotPreview preview={preview} alt={`单元格 ${index + 1} 图形输出`}/> : <pre>{preview.text}</pre>; })()}</div>}</div>
              </div>)}
            </div>
          </div>}
          <nav className="canvas-toolbar" aria-label="画布工具">
            <button className={viewMode === "nodes" ? "active" : ""} title="节点视图" aria-label="节点视图" onClick={() => setViewMode("nodes")}>⌘</button>
            <button className={viewMode === "notebook" ? "active canvas-toolbar__code" : "canvas-toolbar__code"} title="Notebook 代码视图" aria-label="Notebook 代码视图" onClick={openNotebookView}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg></button>
            {viewMode === "nodes" && <><i /><button className={`canvas-toolbar__labeled ${selectionMode ? "active" : ""}`} title="选择多个节点并折叠为可复用子流程" onClick={createSubflowGroup}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="13" width="7" height="7" rx="2"/><path d="M10 7.5h4M17.5 13v-2a3.5 3.5 0 0 0-3.5-3.5"/></svg><span>{selectionMode ? `完成组合 · ${selectedIds.length}` : "组合"}</span></button>{selectionMode && selectedIds.length === 1 && (selectedNode?.data.nodeType === "workflow.group" ? <button className="canvas-toolbar__labeled" title="保存当前组合资源" onClick={saveSelectedGroupToLibrary}><span>保存组合</span></button> : <button className="canvas-toolbar__labeled" title="保存当前节点及参数" onClick={saveSelectedNodeToLibrary}><span>保存节点</span></button>)}{selectionMode && <button className="canvas-toolbar__labeled" title="退出多选" onClick={() => { setSelectionMode(false); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); setSelectedIds([]); }}><span>取消</span></button>}<button className="canvas-toolbar__labeled" title="按屏幕宽度自动整理节点" aria-label="整理布局" onClick={arrangeNodes}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="6" rx="1" /><rect x="14" y="4" width="7" height="6" rx="1" /><rect x="3" y="14" width="7" height="6" rx="1" /><rect x="14" y="14" width="7" height="6" rx="1" /></svg><span>整理</span>
            </button>
            <button className={`canvas-toolbar__labeled ${showNodeInsights ? "active" : ""}`} title={showNodeInsights ? "隐藏节点上方的运行结果" : "显示节点上方的运行结果"} aria-label={showNodeInsights ? "隐藏节点结果" : "显示节点结果"} onClick={() => setShowNodeInsights((visible) => !visible)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" />{!showNodeInsights && <path d="m4 4 16 16" />}</svg><span>结果</span>
            </button><div className="canvas-menu">
            <button className="canvas-toolbar__labeled canvas-menu__trigger" title="点击切换自动、横向、纵向布局方向" aria-label="切换布局方向" onClick={cycleLayoutMode}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={resolvedLayoutDirection === "vertical" ? "M12 3v18m-4-4 4 4 4-4" : "M3 12h18m-4-4 4 4-4 4"} /></svg><span>{layoutMode === "auto" ? "自动" : layoutMode === "vertical" ? "纵向" : "横向"}</span>
            </button>
            </div>
            <button className={`canvas-toolbar__labeled ${showMiniMap ? "active" : ""}`} title="切换缩略图显示方式" onClick={() => setMiniMapMode((mode) => mode === "auto" ? "show" : mode === "show" ? "hide" : "auto")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m6 15 3-3 2 2 4-5 3 4" /></svg><span>缩略图</span></button></>}
          </nav>
          {viewMode === "nodes" && currentCanvasId && <nav className="canvas-breadcrumb" aria-label="画布层级"><button onClick={() => leaveSubflowGroup(null)}>← 返回主流程</button>{canvasTrail.map((group, index) => <span key={group.id}>› <button className={index === canvasTrail.length - 1 ? "active" : ""} onClick={() => leaveSubflowGroup(group.id)}>{group.data.label}</button></span>)}</nav>}
          {paletteDragPreview && <div className={`palette-drag-preview palette-drag-preview--${paletteDragPreview.kind} ${paletteDragPreview.overCanvas ? "over-canvas" : ""}`} style={{ left: paletteDragPreview.x, top: paletteDragPreview.y }}><span>{paletteDragPreview.kind === "group" ? "⧉" : paletteDragPreview.kind === "flow" ? "◇" : "◆"}</span><div><strong>{paletteDragPreview.label}</strong><small>{paletteDragPreview.overCanvas ? "松开放置" : "拖到画布"}</small></div></div>}
          {viewMode === "nodes" && currentCanvasId && (() => { const group = nodes.find((node) => node.id === currentCanvasId); return group ? <aside className="group-interface"><span><i>输入</i><span className="group-interface__ports">{(group.data.groupInputs ?? []).map((port) => <b key={port.id}>{port.label} → {nodes.find((node) => node.id === port.internalNodeId)?.data.label ?? port.internalNodeId}</b>)}</span></span><span><i>输出</i><span className="group-interface__ports">{(group.data.groupOutputs ?? []).map((port) => <b key={port.id}>{nodes.find((node) => node.id === port.internalNodeId)?.data.label ?? port.internalNodeId} → {port.label}</b>)}</span></span></aside> : null; })()}
          {paletteCollapsed && <button className="palette-toggle" onClick={() => setPaletteCollapsed(false)}>{ui("显示节点", "Show resources")}</button>}
          {inspectorCollapsed && <button className="inspector-toggle" onClick={() => setInspectorCollapsed(false)}>{ui("显示参数", "Show parameters")}</button>}
          {contextMenu && (
            <div
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              role="menu"
              aria-label="节点操作"
              onContextMenu={(event) => event.preventDefault()}
            >
              <strong>{nodes.find((node) => node.id === contextMenu.nodeId)?.data.label ?? "节点"}</strong>
              <button onClick={() => { setContextMenu(null); setInspectorCollapsed(false); document.querySelector<HTMLElement>(".inspector")?.focus(); }}>编辑参数</button>
              {selectedNode?.data.nodeType === "workflow.group" && <button onClick={() => openSubflowGroup(selectedNode.id)}>打开子流程</button>}
              {selectedNode?.data.nodeType === "workflow.group" && <button onClick={() => { saveSelectedGroupToLibrary(); setContextMenu(null); }}>保存为组合</button>}
              {selectedNode?.data.nodeType === "workflow.group" && <button onClick={() => { dissolveSelectedGroup(); setContextMenu(null); }}>解除组合</button>}
              {selectedNode?.data.nodeType !== "workflow.group" && <button onClick={() => { saveSelectedNodeToLibrary(); setContextMenu(null); }}>保存为我的节点</button>}
              {selectedNode?.data.nodeType !== "workflow.group" && <button onClick={() => { duplicateSelectedNode(); setContextMenu(null); }}>复制节点</button>}
              {selectedNode?.data.nodeType !== "workflow.group" && <button onClick={() => { setContextMenu(null); setReplacementOpen(true); setReplacementShowAll(false); setReplacementSearch(""); }}>替换功能…</button>}
              <button onClick={() => { disconnectSelectedNode(); setContextMenu(null); }}>断开连线</button>
              <button className="danger" onClick={() => { deleteSelectedNode(); setContextMenu(null); }}>删除节点</button>
            </div>
          )}
          {selectionMenu && selectedIds.length > 0 && (
            <div className="context-menu selection-context-menu" style={{ left: selectionMenu.x, top: selectionMenu.y }} role="menu" aria-label="所选节点操作" onContextMenu={(event) => event.preventDefault()}>
              <strong>已选择 {selectedIds.length} 个节点</strong>
              {selectedIds.length >= 2 && <button onClick={() => { setSelectionMenu(null); createSubflowGroup(); }}>组合所选节点</button>}
              <button onClick={() => { disconnectNodes(selectedIds); setSelectionMenu(null); }}>断开所选连线</button>
              <button className="danger" onClick={() => { deleteNodes(selectedIds); setSelectionMenu(null); }}>删除所选节点 <kbd>Delete</kbd></button>
              <button onClick={() => { setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node)); setSelectedIds([]); setSelectedId(null); setSelectionMenu(null); }}>取消选择 <kbd>Esc</kbd></button>
            </div>
          )}
          {resourceMenu && (() => {
            const catalog = resourceMenu.kind === "catalog-node" ? getNodeSpec(resourceMenu.entryId) : undefined;
            const saved = resourceMenu.kind === "saved-node" ? savedNodeLibrary.find((item) => item.id === resourceMenu.entryId) : undefined;
            const group = resourceMenu.kind === "group" ? groupLibrary.find((item) => item.id === resourceMenu.entryId) : undefined;
            const descriptor = catalog ? describeCatalogNode(catalog.nodeType, catalog.label) : saved ? describeSavedNode(saved) : group ? describeGroup(group) : null;
            const label = descriptor?.label ?? "资源";
            return <div className="context-menu resource-context-menu" style={{ left: Math.min(resourceMenu.x, window.innerWidth - 210), top: Math.min(resourceMenu.y, window.innerHeight - 240) }} role="menu" aria-label="资源操作" onContextMenu={(event) => event.preventDefault()}><strong>{label}</strong>
              <button onClick={() => { if (catalog) addNodeFromCatalog(catalog.nodeType); else if (saved) insertSavedNode(saved); else if (group) insertGroupTemplate(group); setResourceMenu(null); }}>添加到画布</button>
              {saved && descriptor?.capabilities.rename && <button onClick={() => { setResourceMenu(null); void requestTextPrompt({ title: "重命名节点", label: "节点名称", value: saved.name }).then((value) => { const name = value?.trim(); if (name) resourceLibrary.renameNode(saved.id, name); }); }}>重命名</button>}
              {group && descriptor?.capabilities.rename && <button onClick={() => { setResourceMenu(null); void requestTextPrompt({ title: "重命名组合", label: "组合名称", value: group.name }).then((value) => { const name = value?.trim(); if (name) resourceLibrary.renameGroup(group.id, name); }); }}>重命名</button>}
              {saved && descriptor?.capabilities.remove && <button className="danger" onClick={() => { resourceLibrary.removeNode(saved.id); setResourceMenu(null); }}>删除我的节点</button>}
              {group && descriptor?.capabilities.remove && <button className="danger" onClick={() => { resourceLibrary.removeGroup(group.id); setResourceMenu(null); }}>删除组合</button>}
            </div>;
          })()}
          {flowMenu && (() => {
            const entry = flowLibrary.find((item) => item.id === flowMenu.entryId);
            const descriptor = entry ? describeFlow(entry) : null;
            return entry && descriptor ? <div className="context-menu flow-context-menu" style={{ left: flowMenu.x, top: flowMenu.y }} role="menu" aria-label="流程资源操作" onContextMenu={(event) => event.preventDefault()}><strong>◇ {entry.name}</strong><button onClick={() => beginRenameFlow(entry)} disabled={!descriptor.capabilities.rename}>重命名</button><button onClick={() => toggleFlowLock(entry)} disabled={!descriptor.capabilities.lock}>{entry.locked ? "解除锁定" : "锁定流程"}</button><button onClick={() => void jumpToWorkflowFolder()}>跳转到文件夹</button><button className="danger" disabled={!descriptor.capabilities.remove} onClick={() => void deleteFlow(entry)}>删除流程</button></div> : null;
          })()}
          {replacementOpen && <ReplacementPanel node={selectedNode} search={replacementSearch} showAll={replacementShowAll} candidates={replacementCandidates} onSearch={setReplacementSearch} onToggleShowAll={setReplacementShowAll} onSelect={replaceSelectedNode} onClose={() => setReplacementOpen(false)} />}
        </section>

        <aside className="inspector">
          <div className="sidebar-resizer sidebar-resizer--inspector" role="separator" aria-orientation={inspectorDock === "bottom" ? "horizontal" : "vertical"} aria-label={inspectorDock === "bottom" ? "调整参数面板高度" : "调整参数面板宽度"} onPointerDown={(event) => startSidebarResize("inspector", event)} />
          <div className="inspector-scroll">
          <div className="inspector__heading">
            <h2>{ui("参数", "Parameters")}</h2>
            <div className="inspector__heading-tools">
              <div className="inspector-dock-switch" role="group" aria-label="参数面板位置">
                <button type="button" className={inspectorDock === "right" ? "active" : ""} title="参数面板放在右侧" onClick={() => setInspectorDock("right")}>{ui("右侧", "Right")}</button>
                <button type="button" className={inspectorDock === "bottom" ? "active" : ""} title="参数面板放在底部" onClick={() => setInspectorDock("bottom")}>{ui("底部", "Bottom")}</button>
              </div>
            <div className="inspector__actions">
              {selectedNode && <>{selectedNode.data.nodeType !== "workflow.group" && <button className="download-link" onClick={duplicateSelectedNode}>{ui("复制", "Duplicate")}</button>}<button className="danger-link" onClick={deleteSelectedNode}>{ui("删除", "Delete")}</button></>}
              <button className="download-link" onClick={() => setInspectorCollapsed(true)}>{ui("收起", "Collapse")}</button>
            </div>
            </div>
          </div>
          {selectedNode ? (
            <>
              <div className="inspector__selection"><strong className="inspector__node-name">{selectedNode.data.label}</strong><span className="inspector__node-type">{selectedNode.data.nodeType}</span>{selectedContract && <span className="node-contract-badges" title={`执行模型：${selectedContract.executionModel} · 缓存：${selectedContract.cachePolicy} · 状态：${selectedContract.stateScope}`}><i>{selectedContract.runtimes.python ? "PY" : ""}</i>{selectedContract.runtimes.javascript && <i>JS</i>}{selectedContract.sideEffect && <i className="warn">副作用</i>}{selectedContract.stateScope !== "none" && <i className="state">{selectedContract.stateScope === "global" ? "全局" : "临时状态"}</i>}</span>}</div>
              {selectedNodeResult && <section className="node-result-inspector" title={selectedNodeResult.kind === "plot" ? ui("点击或双击展开交互图", "Click or double-click to expand interactive chart") : ui("双击展开、编辑和复制", "Double-click to expand, edit and copy")} tabIndex={0} onDoubleClick={() => { if (selectedNodeResult.kind === "plot") { setPlotZoom(1); setPlotExpandedPreview(selectedNodeResult); return; } setResultDetail({ title: `${selectedNode.data.label} · ${ui("本节点结果", "Node result")}`, text: resultPreviewText(selectedNodeResult), preview: selectedNodeResult.kind === "table" ? selectedNodeResult.preview : undefined }); }}><h3>{ui("本节点结果", "Node result")} <small>{selectedNodeResult.kind === "plot" ? ui("点击展开", "Click to expand") : ui("双击展开", "Double-click to expand")}</small></h3>{(() => { const preview = selectedNodeResult; return preview.kind === "table" ? <DataGrid preview={preview.preview} onExpand={() => setResultDetail({ title: `${selectedNode.data.label} · ${ui("本节点结果", "Node result")}`, text: resultPreviewText(preview), preview: preview.preview })} /> : preview.kind === "plot" ? <button className="plot-preview-button" onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setPlotZoom(1); setPlotExpandedPreview(preview); }} onClick={(event) => { event.stopPropagation(); setPlotZoom(1); setPlotExpandedPreview(preview); }}><PlotPreview preview={preview} className="plot-preview" alt={ui("节点图表结果", "Node chart result")} /></button> : <pre className="node-result-value">{preview.text}</pre>; })()}</section>}
              {selectedNode.data.nodeType === "workflow.group" && <section className="group-settings">
                <label>组名称<input value={selectedNode.data.label} onChange={(event) => updateSelectedGroupLabel(event.target.value)} /></label>
                <button className="primary" onClick={() => openSubflowGroup(selectedNode.id)}>进入子流程画布</button><button onClick={saveSelectedGroupAsFunction}>{selectedNode.data.functionSourceId ? `更新函数${selectedFunctionDefinition ? ` · v${selectedFunctionDefinition.version}` : ""}` : "保存为函数"}</button>
                <div><strong>公开输入</strong>{(selectedNode.data.groupInputs ?? []).map((port) => <label key={port.id}><span>{port.valueType}</span><input value={port.label} onChange={(event) => updateSelectedGroupPort("input", port.id, event.target.value)} /></label>)}</div>
                <div><strong>公开输出</strong>{(selectedNode.data.groupOutputs ?? []).map((port) => <label key={port.id}><span>{port.valueType}</span><input value={port.label} onChange={(event) => updateSelectedGroupPort("output", port.id, event.target.value)} /></label>)}</div>
                <small>端口由组合时跨越组边界的连线自动生成；内部连线和节点参数在子画布中编辑。</small>
              </section>}
              {selectedNode.data.nodeType === "function.call" && <section className="group-settings function-call-settings"><strong>{selectedFunctionDefinition?.name ?? selectedNode.data.label}</strong><small>{selectedFunctionDefinition ? `函数 ${selectedFunctionDefinition.id} · v${selectedFunctionDefinition.version}` : "函数定义缺失"}</small>{selectedFunctionDefinition && <button onClick={() => insertFunctionEditableGroup(selectedFunctionDefinition)}>展开为可编辑组合</button>}<small>调用端口来自函数签名；更新函数时当前工作流中的调用节点会同步到新版本。</small></section>}
              <div className="inspector-node-overview">
              {["io.read_csv", "io.read_csv_batch", "io.read_table", "io.read_text", "io.read_json", "io.read_image"].includes(selectedNode.data.nodeType) && <div className="node-file-picker"><div className="node-file-picker__actions"><button onClick={() => void chooseCsvSource("files")}>{selectedNode.data.nodeType === "io.read_csv_batch" ? "选择文件（可多选）" : "选择文件"}</button>{["io.read_csv_batch", "io.read_table"].includes(selectedNode.data.nodeType) && <button onClick={() => void chooseCsvSource("directory")}>选择文件夹</button>}{!remoteBrowser && <button onClick={() => { setSmbOpen(true); setSmbError(null); }}>局域网 SMB</button>}</div><span>{fileName ?? "尚未选择文件"}</span></div>}
              {selectedNode.data.nodeType !== "workflow.group" && selectedSpec?.pythonCallable && (
                <div className="callable-signature">
                  <strong>{selectedSpec.pythonCallable}(…)</strong>
                  <span>{selectedSpec.parameters.length} 个可执行参数由函数签名清单生成</span>
                  {selectedSpec.docsUrl && <a href={selectedSpec.docsUrl} target="_blank" rel="noreferrer">查看官方文档</a>}
                  {selectedSpec.excludedSignatureParameters?.length ? <small>未生成：{selectedSpec.excludedSignatureParameters.join(", ")}（浏览器文件输入、返回迭代器或可执行回调与表格节点模型不兼容）</small> : null}
                </div>
              )}
              </div>
              <div className="node-organization">
                <label>节点标签<input value={(selectedNode.data.tags ?? []).join(",")} placeholder="清洗,关键步骤" onChange={(event) => updateSelectedTags(event.target.value)} /></label>
                <label>加入分组<span><input value={groupName} placeholder="我的常用" onChange={(event) => setGroupName(event.target.value)} /><button onClick={addSelectedToGroup}>加入</button></span></label>
              </div>
              {rememberedParameterCount > 0 && (
                <div className="node-default-actions">
                  <button onClick={saveSelectedDefaults}>保存为默认</button>
                  <button onClick={clearSelectedDefaults}>恢复内置默认</button>
                  <small>仅保存 {rememberedParameterCount} 项偏好参数；不会保存列名、筛选条件或数据字段。</small>
                </div>
              )}
              {selectedNode.data.nodeType === "custom.python_function" && (
                <section className="custom-templates">
                  <span>函数模板</span>
                  <div>
                    {customTemplates.map((template) => (
                      <span className="template-chip" key={template.id}>
                        <button title={template.description} onClick={() => applyCustomTemplate(template.code, template.label)}>{template.label}</button>
                        {template.id.startsWith("personal-") && <button className="template-chip__delete" title="删除个人模板" onClick={() => deletePersonalTemplate(template.id, template.label)}>×</button>}
                      </span>
                    ))}
                  </div>
                  <div className="template-manager">
                    <input value={templateName} placeholder="模板名称（可选）" onChange={(event) => setTemplateName(event.target.value)} />
                    <button onClick={savePersonalTemplate}>{ui("保存", "Save")}</button>
                    <button onClick={() => templateInput.current?.click()}>{ui("导入", "Import")}</button>
                    <button onClick={exportCurrentTemplate}>导出</button>
                  </div>
                </section>
              )}
              {selectedSignature && !selectedSignature.error && (
                <p className="signature-summary">
                  <strong>{selectedSignature.functionName}</strong>
                  <span>{selectedSignature.inputPorts.length} 输入 · {selectedSignature.parameters.length} 参数 · {selectedSignature.outputPorts.length} 输出</span>
                </p>
              )}
              {selectedSpec ? <>
                {renderParameterFields(basicParameters)}
                {advancedParameters.length > 0 && <details className="advanced-parameters"><summary>高级参数 <span>{advancedParameters.length}</span></summary><div className="advanced-parameters__grid">{renderParameterFields(advancedParameters)}</div></details>}
              </> : Object.entries(selectedNode.data.parameters).map(([key, value]) => (
                <label className="field" key={key}><span>{key}</span><input value={String(value ?? "")} onChange={(event) => updateParameter(key, event.target.value)} /></label>
              ))}
              {authoritativeSignatureError && <p className="validation-error">签名错误：{authoritativeSignatureError}</p>}
              {selectedSpec?.parameters.length === 0 && <p className="muted">此节点没有可配置参数。</p>}
            </>
          ) : <p className="muted">从左侧添加节点，或选择画布中的节点编辑参数。</p>}
          {resultDock === "right" && resultPanel}
          </div>
        </aside>
        {resultDock === "bottom" && resultPanel}
      </main>
      <footer className="app-statusbar" aria-label="运行状态">
        <span title="每秒刷新一次的应用内存"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M9 3v4m3-4v4m3-4v4M9 17v4m3-4v4m3-4v4M3 9h4m-4 3h4m-4 3h4m10-6h4m-4 3h4m-4 3h4" /></svg>内存 {memoryMb === null ? "不可用" : `${memoryMb.toFixed(1)} MB`}</span>
        <span title="最近一次工作流执行耗时"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 13V8m0 5 3 2M9 3h6" /></svg>计算 {lastRunDurationMs === null ? "—" : lastRunDurationMs < 1000 ? `${Math.round(lastRunDurationMs)} ms` : `${(lastRunDurationMs / 1000).toFixed(2)} s`}</span>
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /><path d="m10 7 4 10" /></svg>节点 {nodes.length}</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="m7.5 7.5 9 9" /></svg>连线 {edges.length}</span>{executionError ? <button className="app-statusbar__error" onClick={() => setErrorDetailOpen(true)} title="点击查看完整错误">⚠ {message}</button> : <span className="app-statusbar__message">{message}</span>}
        {otherHostExecutions.length > 0 && <div className="statusbar-tasks">
          <button className={`statusbar-task-trigger ${hostTaskMenuOpen ? "active" : ""}`} title={`宿主任务：${hostExecutionLifecycle.runningCount} 运行 / ${hostExecutionLifecycle.queuedCount} 排队`} aria-label="查看宿主任务" aria-expanded={hostTaskMenuOpen} onClick={() => setHostTaskMenuOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h10M7 17h10"/><circle cx="4" cy="7" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17" r="1"/></svg>
            <span>{ui("任务", "Tasks")}</span><strong>{hostExecutionLifecycle.executions.length}</strong>
          </button>
          {hostTaskMenuOpen && <div className="statusbar-task-menu" role="dialog" aria-label="宿主执行任务">
            <header><div><strong>{ui("宿主任务", "Host tasks")}</strong><small>{hostExecutionLifecycle.runningCount} {ui("运行", "running")} · {hostExecutionLifecycle.queuedCount} {ui("排队", "queued")}</small></div><button type="button" aria-label="关闭任务列表" onClick={() => setHostTaskMenuOpen(false)}>×</button></header>
            <div className="statusbar-task-list">
              {hostExecutionLifecycle.executions.map((entry) => {
                const isCurrent = entry.executionId === currentHostExecution?.executionId;
                const sameClient = entry.clientId === executionClientId;
                const phaseLabel = entry.phase === "queued" ? ui("排队", "Queued") : entry.phase === "cancelling" ? ui("取消中", "Cancelling") : ui("运行", "Running");
                const sourceLabel = sameClient ? ui("本机标签", "Local tab") : entry.source === "remote" ? ui("远程网页", "Remote web") : ui("宿主", "Host");
                return <div className="statusbar-task-item" key={entry.executionId}>
                  <span className={`statusbar-task-dot statusbar-task-dot--${entry.phase}`} aria-hidden="true"/>
                  <div className="statusbar-task-copy"><strong>{entry.workspaceLabel || entry.workspaceId || ui("工作流", "Workflow")}{isCurrent ? ` · ${ui("当前", "Current")}` : ""}</strong><small>{sourceLabel} · {phaseLabel} · {entry.executionId.slice(0, 8)}</small></div>
                  <button type="button" disabled={entry.phase === "cancelling"} onClick={() => void stopHostExecution(entry)}>{entry.phase === "queued" ? ui("取消", "Cancel") : ui("停止", "Stop")}</button>
                </div>;
              })}
            </div>
          </div>}
        </div>}
        {debugMode && <button className="statusbar-debug" title="调试面板" aria-label="调试面板" onClick={() => setDebugOpen(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9h8v7a4 4 0 0 1-8 0V9Z"/><path d="m9 6-2-2m8 2 2-2M5 11H2m3 4H2m17-4h3m-3 4h3M12 9V5"/></svg></button>}
        <div className="statusbar-quick-services" aria-label="快捷服务">
          {!remoteBrowser && <button className="statusbar-service-button statusbar-service-button--smb" title="打开局域网 SMB" aria-label="打开局域网 SMB" onClick={openSmbFromStatusbar}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="2.2"/><circle cx="6" cy="17" r="2.2"/><circle cx="18" cy="17" r="2.2"/><path d="M12 8.2v3.1M12 11.3H6v3.5M12 11.3h6v3.5"/></svg></button>}
          {canHostRemoteServer() && <button className={`statusbar-service-button statusbar-service-button--remote ${remoteServer ? "active" : ""}`} title={remoteServer ? `计算服务已开启 · ${remoteServer.url} · 点击显示地址` : "开启计算服务"} aria-label={remoteServer ? "计算服务已开启，显示服务地址" : "开启计算服务"} aria-pressed={Boolean(remoteServer)} onClick={openRemoteFromStatusbar}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M4.7 19.3a10.3 10.3 0 0 1 0-14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6"/></svg><span className="statusbar-service-button__indicator" aria-hidden="true"/></button>}
          <button className="statusbar-history" title="历史记录" aria-label="历史记录" onClick={() => setHistoryOpen(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg></button>
        </div>
      </footer>
      {debugOpen && <DebugDialog open={debugOpen} nodes={nodes} order={nodesInExecutionOrder(nodes, edges)} result={result} breakpoints={debugBreakpoints} pausedAt={debugPausedAt} executionError={executionError} onClose={() => setDebugOpen(false)} onRunFirst={() => void runPrototype(nodes, edges, new Set(), nodesInExecutionOrder(nodes, edges)[0]?.id)} onRunNext={() => { const order = nodesInExecutionOrder(nodes, edges); const index = order.findIndex((node) => node.id === debugPausedAt); const next = order[index + 1]; if (next) void runPrototype(nodes, edges, new Set(), next.id); else setMessage("已到达工作流末尾"); }} onClearBreakpoints={() => { setDebugBreakpoints(new Set()); setDebugPausedAt(null); }} onToggleBreakpoint={(nodeId) => setDebugBreakpoints((current) => { const next = new Set(current); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next; })} onRunTo={(nodeId) => void runPrototype(nodes, edges, new Set(), nodeId)} onCopyWorkflowJson={() => void navigator.clipboard.writeText(JSON.stringify(serializeWorkflow("调试快照", nodes, edges, requirements, functions), null, 2))} onCopySnapshotJson={() => void navigator.clipboard.writeText(JSON.stringify({ result, executionError, breakpoints: [...debugBreakpoints], pausedAt: debugPausedAt }, null, 2))} />}
      {historyOpen && <HistoryDialog entries={session.history.entries} futureCount={session.history.futureCount} onClose={() => setHistoryOpen(false)} onUndo={undo} onRedo={redo} onClear={clearHistory} onRestore={restoreHistoryAt} />}
      {smbOpen && <SmbDialog open={smbOpen} language={language} servers={smbServers} connection={smbConnection} guest={smbGuest} rememberPassword={smbRememberPassword} passwordVisible={smbPasswordVisible} loading={smbLoading} error={smbError} path={smbPath} entries={smbEntries} selected={smbSelected} scannedShares={smbScannedShares} onClose={() => setSmbOpen(false)} onDiscover={() => void discoverConfiguredSmb()} onSelectServer={(address, shares) => { setSmbConnection((current) => ({ ...current, server: address, share: shares?.length === 1 ? shares[0] : "" })); setSmbScannedShares(shares ?? []); setSmbEntries([]); setSmbPath(""); }} onConnectionChange={(patch) => setSmbConnection((current) => ({ ...current, ...patch }))} onGuestChange={(checked) => { setSmbGuest(checked); if (checked) setSmbRememberPassword(false); }} onRememberPasswordChange={setSmbRememberPassword} onPasswordVisibleChange={() => setSmbPasswordVisible((current) => !current)} onScanShares={() => void scanConfiguredSmb()} onSelectShare={(share) => void selectSmbShare(share)} onBrowse={(nextPath) => void browseSmb(nextPath)} onImportSelection={(importAll) => void importSmbSelection(importAll)} onToggleSelected={(path, checked) => setSmbSelected((current) => checked ? [...current, path] : current.filter((item) => item !== path))} />}
      {remoteAccessDialog && <RemoteAccessDialog open={remoteAccessDialog} requirePin={remoteRequirePin} onRequirePin={setRemoteRequirePin} onClose={() => setRemoteAccessDialog(false)} onStart={() => void startConfiguredRemoteServer()} />}
      {remoteBrowser && !remotePaired && <RemotePairDialog policy={remoteAccessPolicy} error={remoteAccessError} pinInput={remotePinInput} onPinChange={(value) => { setRemotePinInput(value.replace(/\D/g, "").slice(0, 4)); setRemoteAccessError(null); }} onSubmitPin={() => void submitRemotePin()} />}
      {inputDialogNode && <InputDialog node={inputDialogNode} value={inputDialogValue} onValueChange={setInputDialogValue} onSubmit={() => void submitInputDialog()} onCancel={() => setInputDialogNode(null)} />}
      {alertDialogNode && <AlertDialog node={alertDialogNode} preview={alertInputPreview} onSubmit={(response) => void submitAlertDialog(response)} />}
      {renameFlow && <RenameFlowDialog name={renameFlow.name} value={renameFlowValue} onValueChange={setRenameFlowValue} onClose={() => setRenameFlow(null)} onConfirm={() => void confirmRenameFlow()} />}
      {agentPanelOpen && <AgentDialog open={agentPanelOpen} settings={agentSettings} apiKey={agentApiKey} keyStorageHint={isNativePlatform() && !remoteBrowser ? "keystore" : "session"} apiKeyManagedByHost={remoteBrowser && remoteAgentProxyAvailable} testing={agentTesting} connectionStatus={agentConnectionStatus} language={language} instruction={agentInstruction} requesting={agentRequesting} planText={agentPlanText} plan={agentPlan} planError={agentPlanError} audit={agentAudit} onClose={() => setAgentPanelOpen(false)} onPresetSelect={(id) => selectAgentPreset(id)} onSettingsChange={(patch) => setAgentSettings((current) => ({ ...current, ...patch }))} onApiKeyChange={setAgentApiKey} onLanguageChange={(next) => { setLanguage(next); setAgentSettings((current) => ({ ...current, language: next })); }} onTestConnection={() => void testCurrentAgentConnection()} onInstructionChange={setAgentInstruction} onRequestPlan={() => void requestPlanFromAgent()} onPlanTextChange={(value) => { setAgentPlanText(value); setAgentPlan(null); setAgentPlanError(null); }} onReviewPlan={reviewAgentPlan} onApplyPlan={() => void applyAgentPlan()} />}
      <AutomatedDiagnosticsDialog open={automatedDiagnosticsOpen} running={automatedDiagnosticsRunning} report={automatedDiagnosticsReport} onClose={() => setAutomatedDiagnosticsOpen(false)} onRun={() => void runInAppAutomatedDiagnostics()} onCopy={() => void copyAutomatedDiagnostics()} onExport={() => void exportAutomatedDiagnostics()} exportStatus={automatedDiagnosticsExportStatus} />
      {settingsOpen && <SettingsDialog open={settingsOpen} themeMode={themeMode} language={language} resolvedTheme={resolvedTheme} runtimePreference={runtimePreference} canvas={{ nodeScale, endpointScale, edgeWidth, paletteWidth, inspectorWidth, inspectorHeight, resultHeight, miniMapMode, showNodeInsights }} smbServer={smbConnection.server} smbShare={smbConnection.share} smbGuest={smbGuest} smbUsername={smbConnection.username} smbDisabled={remoteBrowser} debugMode={debugMode} automatedDiagnosticsEnabled={automatedDiagnosticsEnabled} hotReloadEnabled={Boolean(import.meta.hot)} profilePath={userProfile?.path ?? null} workspaceUri={userProfile?.workspaceUri ?? null} onClose={() => setSettingsOpen(false)} onThemeModeChange={setThemeMode} onLanguageChange={(next) => { setLanguage(next); setAgentSettings((current) => ({ ...current, language: next })); }} onRuntimePreferenceChange={setRuntimePreference} onCanvasChange={(patch) => { if (patch.nodeScale !== undefined) setNodeScale(patch.nodeScale); if (patch.endpointScale !== undefined) setEndpointScale(patch.endpointScale); if (patch.edgeWidth !== undefined) setEdgeWidth(patch.edgeWidth); if (patch.paletteWidth !== undefined) setPaletteWidth(patch.paletteWidth); if (patch.inspectorWidth !== undefined) setInspectorWidth(patch.inspectorWidth); if (patch.inspectorHeight !== undefined) setInspectorHeight(patch.inspectorHeight); if (patch.resultHeight !== undefined) setResultHeight(patch.resultHeight); if (patch.miniMapMode !== undefined) setMiniMapMode(patch.miniMapMode); if (patch.showNodeInsights !== undefined) setShowNodeInsights(patch.showNodeInsights); }} onOpenSmb={() => { setSettingsOpen(false); setSmbOpen(true); setSmbError(null); }} onOpenAgent={() => { setSettingsOpen(false); setAgentPanelOpen(true); }} onDebugModeChange={setDebugMode} onAutomatedDiagnosticsEnabledChange={setAutomatedDiagnosticsEnabled} onOpenDiagnostics={() => { setSettingsOpen(false); void runInAppAutomatedDiagnostics(); }} onConfigureFolder={() => void configureWorkflowFolder()} onExportSettings={exportSettings} onImportSettings={() => settingsInput.current?.click()} />}
      {packageManagerOpen && <PackageManager open={packageManagerOpen} loading={environmentLoading} environment={pythonEnvironment} requirements={requirements} requirementInput={packageRequirement} onClose={() => setPackageManagerOpen(false)} onRequirementInputChange={setPackageRequirement} onAddRequirement={addPackageRequirement} onRemoveRequirement={removePackageRequirement} onCopyPipCommand={() => void copyPipCommand()} onExportRequirements={() => downloadText(`${requirements.join("\n")}${requirements.length ? "\n" : ""}`, "requirements.txt", "text/plain;charset=utf-8")} />}
      {codeEditorOpen && selectedNode?.data.nodeType === "custom.python_function" && <CodeEditorModal open={codeEditorOpen} code={String(selectedNode.data.parameters.code ?? "")} summary={signatureSummary} error={authoritativeSignatureError} onClose={() => setCodeEditorOpen(false)} onCodeChange={(code) => updateParameter("code", code)} />}
      {plotExpandedPreview && <PlotLightbox open preview={plotExpandedPreview} zoom={plotZoom} onZoom={setPlotZoom} onClose={() => setPlotExpandedPreview(null)} />}
      {resultDetail && <ResultDetailDialog detail={resultDetail} onClose={() => setResultDetail(null)} onCopy={() => void navigator.clipboard.writeText(resultDetail.text).then(() => setMessage("节点结果已复制"))} onTextChange={(text) => setResultDetail((current) => current ? { ...current, text } : null)} />}
      {executionError && errorDetailOpen && <ErrorDetailDialog error={executionError} open={errorDetailOpen} canLocate={Boolean(executionError.nodeId && nodes.some((node) => node.id === executionError.nodeId))} onClose={() => setErrorDetailOpen(false)} onLocate={(nodeId) => locateNode(nodeId)} onCopy={() => void navigator.clipboard.writeText(`${executionError.nodeType ?? "workflow"} (${executionError.nodeId ?? "unknown"})\n${executionError.message}\n${executionError.traceback ?? ""}`)} />}
      <NewWorkflowDialog open={newWorkflowDialogOpen} onCurrentTab={chooseNewInCurrentTab} onNewTab={chooseNewTab} onCancel={() => setNewWorkflowDialogOpen(false)} />
      <UnsavedChangesDialog open={replaceCurrentUnsavedOpen} title="是否保存当前标签页？" message={`“${tabName}”包含尚未保存的修改。保存后将继续在当前标签页创建空白工作流。`} onSave={saveThenReplaceCurrentWorkflow} onDiscard={discardThenReplaceCurrentWorkflow} onCancel={() => setReplaceCurrentUnsavedOpen(false)} />
      {confirmDialog && <ConfirmDialog open title={confirmDialog.title} message={confirmDialog.message} confirmLabel={confirmDialog.confirmLabel} danger={confirmDialog.danger} onCancel={() => { confirmDialog.resolve(false); setConfirmDialog(null); }} onConfirm={() => { confirmDialog.resolve(true); setConfirmDialog(null); }} />}
      {textPromptDialog && <TextPromptDialog open title={textPromptDialog.title} label={textPromptDialog.label} value={textPromptDialog.value} confirmLabel={textPromptDialog.confirmLabel} onValueChange={(value) => setTextPromptDialog((current) => current ? { ...current, value } : null)} onCancel={() => { textPromptDialog.resolve(null); setTextPromptDialog(null); }} onConfirm={() => { const value = textPromptDialog.value.trim(); if (!value) return; textPromptDialog.resolve(value); setTextPromptDialog(null); }} />}
    </div>
  );
}

export function App() {
  return <AppErrorBoundary><MultiTabWorkspace /></AppErrorBoundary>;
}

type WorkspaceTab = { id: string; name: string };


type TabsApi = {
  tabs: WorkspaceTab[];
  activeId: string;
  executionPhases: Record<string, string>;
  completedIndicators: Record<string, boolean>;
  errorIndicators: Record<string, boolean>;
  selectTab: (id: string) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  reorderTab: (fromId: string, toId: string) => void;
};

const TabsContext = createContext<TabsApi | null>(null);

function TabBar() {
  const api = useContext(TabsContext);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [touchCloseId, setTouchCloseId] = useState<string | null>(null);
  const [pointerMode] = useState<"mouse" | "touch">(() => window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse");
  const longPressTimer = useRef<number | null>(null);
  const longPressHandled = useRef(false);
  const tabLongPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const touchCloseTimer = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollActiveId = api?.activeId ?? null;
  const scrollTabCount = api?.tabs.length ?? 0;

  useEffect(() => {
    if (!scrollActiveId) return;
    const activeTab = tabRefs.current.get(scrollActiveId);
    if (!activeTab) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const left = activeTab.offsetLeft;
    const right = left + activeTab.offsetWidth;
    const viewLeft = scroller.scrollLeft;
    const viewRight = viewLeft + scroller.clientWidth;
    if (left < viewLeft) scroller.scrollTo({ left: Math.max(0, left - 8), behavior: "smooth" });
    else if (right > viewRight) scroller.scrollTo({ left: right - scroller.clientWidth + 8, behavior: "smooth" });
  }, [scrollActiveId, scrollTabCount]);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    tabLongPressOrigin.current = null;
  };

  const clearTouchCloseTimer = () => {
    if (touchCloseTimer.current !== null) window.clearTimeout(touchCloseTimer.current);
    touchCloseTimer.current = null;
  };

  const hideTouchClose = () => {
    clearTouchCloseTimer();
    setTouchCloseId(null);
  };

  const revealTouchClose = (id: string) => {
    clearTouchCloseTimer();
    setTouchCloseId(id);
    touchCloseTimer.current = window.setTimeout(() => {
      setTouchCloseId((current) => current === id ? null : current);
      touchCloseTimer.current = null;
    }, 3200);
  };

  const openTouchTabMenu = (id: string, x: number, y: number) => {
    revealTouchClose(id);
    setTabMenu({
      tabId: id,
      x: Math.max(8, Math.min(x, window.innerWidth - 170)),
      y: Math.max(8, Math.min(y, window.innerHeight - 130)),
    });
  };

  const startLongPress = (id: string, x: number, y: number, element: HTMLElement) => {
    const policy = resolveGesturePolicy("mobile", "tab");
    longPressHandled.current = false;
    clearLongPress();
    tabLongPressOrigin.current = { x, y };
    longPressTimer.current = window.setTimeout(() => {
      longPressHandled.current = true;
      const bounds = element.getBoundingClientRect();
      openTouchTabMenu(id, bounds.left + Math.min(bounds.width * .55, 56), bounds.bottom + 5);
      navigator.vibrate?.(18);
      longPressTimer.current = null;
      tabLongPressOrigin.current = null;
    }, policy.longPressMs ?? 500);
  };

  useEffect(() => () => {
    clearLongPress();
    clearTouchCloseTimer();
  }, []);

  useEffect(() => {
    if (!touchCloseId && !tabMenu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".tab-context-menu") || target.closest(".tabbar__close")) return;
      const tab = target.closest<HTMLElement>(".tabbar__tab");
      if (tab && tab.dataset.tabId === touchCloseId) return;
      hideTouchClose();
      setTabMenu(null);
    };
    window.addEventListener("pointerdown", dismiss, true);
    return () => window.removeEventListener("pointerdown", dismiss, true);
  }, [touchCloseId, tabMenu]);

  if (!api) return null;
  const { tabs, activeId, executionPhases, completedIndicators, errorIndicators, selectTab, addTab, closeTab, renameTab, reorderTab } = api;

  const commitRename = () => {
    const name = editingName.trim();
    if (editingId && name) renameTab(editingId, name);
    setEditingId(null);
  };



  return (
    <>
      <nav className="tabbar" role="tablist" aria-label="工作流标签页">
        <div className="tabbar__scroller" ref={scrollerRef} onScroll={() => { hideTouchClose(); setTabMenu(null); }}>
          <div className="tabbar__track">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const isEditing = editingId === tab.id;
          const executionPhase = executionPhases[tab.id] ?? "idle";
          const executionIndicatorPhase = executionPhase === "timeout" ? "failed" : executionPhase;
          const executionErrorVisible = ["failed", "timeout"].includes(executionPhase) && Boolean(errorIndicators[tab.id]);
          const executionIndicatorVisible = ["queued", "running", "cancelling"].includes(executionPhase) || executionErrorVisible;
          const completedIndicatorVisible = !executionIndicatorVisible && !isActive && Boolean(completedIndicators[tab.id]);
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              ref={(element) => { if (element) tabRefs.current.set(tab.id, element); else tabRefs.current.delete(tab.id); }}
              role="tab"
              aria-selected={isActive}
              className={`tabbar__tab ${isActive ? "active" : ""} ${dragOverId === tab.id ? "drag-over" : ""}`}
              draggable={!isEditing}
              onDragStart={(event) => { event.dataTransfer.setData("application/pydroid-tab", tab.id); event.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(event) => { if (event.dataTransfer.types.includes("application/pydroid-tab")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverId(tab.id); } }}
              onDragLeave={() => setDragOverId((current) => current === tab.id ? null : current)}
              onDrop={(event) => { event.preventDefault(); setDragOverId(null); const dragged = event.dataTransfer.getData("application/pydroid-tab"); if (dragged) reorderTab(dragged, tab.id); }}
              onDragEnd={() => setDragOverId(null)}
              onClick={(event) => {
                if (longPressHandled.current) { longPressHandled.current = false; return; }
                if (touchCloseId && touchCloseId !== tab.id) hideTouchClose();
                selectTab(tab.id);
                const element = event.currentTarget;
                window.requestAnimationFrame(() => {
                  const scroller = scrollerRef.current;
                  if (!scroller) return;
                  const left = element.offsetLeft;
                  const right = left + element.offsetWidth;
                  if (left < scroller.scrollLeft) scroller.scrollTo({ left: Math.max(0, left - 8), behavior: "smooth" });
                  else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollTo({ left: right - scroller.clientWidth + 8, behavior: "smooth" });
                });
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (pointerMode === "touch") {
                  if (!longPressHandled.current) openTouchTabMenu(tab.id, event.clientX, event.clientY);
                  return;
                }
                setTabMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
              }}
              onPointerDown={(event) => { if (event.pointerType === "touch") startLongPress(tab.id, event.clientX, event.clientY, event.currentTarget); }}
              onPointerMove={(event) => {
                if (event.pointerType !== "touch") return;
                const origin = tabLongPressOrigin.current;
                if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > resolveGesturePolicy("mobile", "tab").dragThresholdPx) clearLongPress();
              }}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              onPointerCancel={clearLongPress}
              onDoubleClick={() => { if (pointerMode === "mouse") { setEditingId(tab.id); setEditingName(tab.name); } }}
              title={`${tab.name}${executionIndicatorVisible ? ` · ${executionPhase === "queued" ? "排队中" : executionPhase === "cancelling" ? "取消中" : executionPhase === "failed" || executionPhase === "timeout" ? "执行错误" : "运行中"}` : ""}${pointerMode === "mouse" ? " · 双击改名，右键菜单" : " · 长按显示关闭"}`}
            >
              {(executionIndicatorVisible || completedIndicatorVisible) && <span className={`tabbar__execution tabbar__execution--${completedIndicatorVisible ? "completed" : executionIndicatorPhase}`} aria-label={completedIndicatorVisible ? "后台执行已完成" : executionPhase === "queued" ? "排队中" : executionPhase === "cancelling" ? "取消中" : executionPhase === "failed" || executionPhase === "timeout" ? "执行错误" : "运行中"} />}
              {isEditing ? (
                <input
                  className="tabbar__rename"
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => { if (event.key === "Enter") commitRename(); else if (event.key === "Escape") setEditingId(null); }}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : (
                <span className="tabbar__name">{tab.name}</span>
              )}
              {tabs.length > 1 && (
                <button
                  type="button"
                  className={`tabbar__close ${touchCloseId === tab.id ? "visible" : ""}`}
                  title="关闭标签页"
                  aria-label={`关闭 ${tab.name}`}
                  onClick={(event) => { event.stopPropagation(); hideTouchClose(); setTabMenu(null); closeTab(tab.id); }}
                ><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" /></svg></button>
              )}
            </div>
          );
        })}
          </div>
        </div>
        <button type="button" className="tabbar__add" title="新建标签页" aria-label="新建标签页" onClick={addTab}>+</button>
      </nav>
      {tabMenu && (() => {
        const menuHeight = 110;
        const opensAbove = tabMenu.y > window.innerHeight - menuHeight - 12;
        return (
          <div className="tab-context-menu" style={{ left: tabMenu.x, top: opensAbove ? tabMenu.y - menuHeight : tabMenu.y }}>
            <button type="button" onClick={() => { setEditingId(tabMenu.tabId); const target = tabs.find((tab) => tab.id === tabMenu.tabId); setEditingName(target?.name ?? ""); hideTouchClose(); setTabMenu(null); }}>重命名</button>
            <button type="button" onClick={() => { hideTouchClose(); closeTab(tabMenu.tabId); setTabMenu(null); }} disabled={tabs.length <= 1}>关闭标签页</button>
            <button type="button" onClick={() => { hideTouchClose(); setTabMenu(null); }}>取消</button>
          </div>
        );
      })()}
    </>
  );
}

function desktopWindowControls(): WindowControls | undefined {
  return getWindowControls();
}

function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const controls = desktopWindowControls();
  const remoteBrowser = isRemoteRuntime();
  useEffect(() => {
    if (!controls) return;
    let mounted = true;
    controls.isMaximized().then((value) => { if (mounted) setMaximized(value); });
    const unsubscribe = controls.onMaximizedChanged(setMaximized);
    return () => { mounted = false; unsubscribe(); };
  }, [controls]);
  if (!controls && isNativePlatform()) return null;
  return (
    <header className="titlebar">
      <div className="titlebar__brand"><strong>PyDroid Node</strong><span>{remoteBrowser ? "远程连接 · Android 计算" : "节点式数据处理 · Python / JavaScript"}</span></div>
      {controls && (
        <div className="titlebar__controls">
          <button type="button" title="最小化" aria-label="最小化" onClick={() => controls.minimize()}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg></button>
          <button type="button" title={maximized ? "还原" : "最大化"} aria-label={maximized ? "还原" : "最大化"} onClick={() => controls.toggleMaximize()}>{maximized ? <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5h5v5h-5z" /></svg> : <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" fill="none" /></svg>}</button>
          <button type="button" className="titlebar__close" title="关闭" aria-label="关闭" onClick={() => controls.close()}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" /></svg></button>
        </div>
      )}
    </header>
  );
}

function MultiTabWorkspace() {
  const workspaceExecutionClientId = getExecutionClientId();
  const workspaceSessionSource = isRemoteRuntime() ? "remote" as const : "local" as const;
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadAppSettings().themeMode);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const resolvedTheme: "dark" | "light" = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#0b1020" : "#f4f7fb");
    if (isNativePlatform()) void setSystemTheme(resolvedTheme === "dark").catch(() => undefined);
  }, [resolvedTheme]);
  // A new app session always starts from one predictable, empty workspace.
  const emptySnapshot = emptyWorkflowSnapshot();
  const [tabs, setTabs] = useState<WorkspaceTab[]>([{ id: "default", name: "工作流 1" }]);
  const [activeId, setActiveId] = useState<string>("default");
  const sessionStoreRef = useRef(new EditorSessionStore("default", emptySnapshot, { clientId: workspaceExecutionClientId, source: workspaceSessionSource }));
  const lifecycleRef = useRef(new EditorWorkspaceLifecycleService(localStorage, AUTOSAVE_KEY));
  const resourceLibraryRef = useRef<EditorResourceLibraryService | null>(null);
  if (!resourceLibraryRef.current) resourceLibraryRef.current = new EditorResourceLibraryService(localStorage, defaultGroupLibrary(), (path, content) => saveUserProfileFile(path, content));
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [executionPhases, setExecutionPhases] = useState<Record<string, string>>({ default: getExecutionStatus(sessionStoreRef.current.ensure("default").identity).phase });
  const [completedIndicators, setCompletedIndicators] = useState<Record<string, boolean>>({});
  const [errorIndicators, setErrorIndicators] = useState<Record<string, boolean>>({});
  const previousExecutionPhasesRef = useRef<Record<string, string>>({ default: getExecutionStatus(sessionStoreRef.current.ensure("default").identity).phase });
  const errorIndicatorTimersRef = useRef(new Map<string, number>());

  const clearWorkspaceErrorIndicator = useCallback((workspaceId: string) => {
    const existing = errorIndicatorTimersRef.current.get(workspaceId);
    if (existing !== undefined) window.clearTimeout(existing);
    errorIndicatorTimersRef.current.delete(workspaceId);
    setErrorIndicators((current) => current[workspaceId] ? { ...current, [workspaceId]: false } : current);
  }, []);

  const showTransientWorkspaceError = useCallback((workspaceId: string) => {
    const existing = errorIndicatorTimersRef.current.get(workspaceId);
    if (existing !== undefined) window.clearTimeout(existing);
    setErrorIndicators((current) => current[workspaceId] ? current : { ...current, [workspaceId]: true });
    const timer = window.setTimeout(() => {
      errorIndicatorTimersRef.current.delete(workspaceId);
      setErrorIndicators((current) => current[workspaceId] ? { ...current, [workspaceId]: false } : current);
    }, 4500);
    errorIndicatorTimersRef.current.set(workspaceId, timer);
  }, []);

  useEffect(() => () => {
    for (const timer of errorIndicatorTimersRef.current.values()) window.clearTimeout(timer);
    errorIndicatorTimersRef.current.clear();
  }, []);

  const applyWorkspaceExecutionPhase = useCallback((workspaceId: string, phase: string, isActiveWorkspace: boolean) => {
    const previousPhase = previousExecutionPhasesRef.current[workspaceId] ?? "idle";
    previousExecutionPhasesRef.current[workspaceId] = phase;
    setExecutionPhases((current) => current[workspaceId] === phase ? current : { ...current, [workspaceId]: phase });
    if (phase === "success" && previousPhase !== "success") {
      clearWorkspaceErrorIndicator(workspaceId);
      if (isActiveWorkspace) setCompletedIndicators((current) => current[workspaceId] ? { ...current, [workspaceId]: false } : current);
      else setCompletedIndicators((current) => current[workspaceId] ? current : { ...current, [workspaceId]: true });
      return;
    }
    if ((phase === "failed" || phase === "timeout") && phase !== previousPhase) {
      showTransientWorkspaceError(workspaceId);
    } else if (!["failed", "timeout"].includes(phase)) {
      clearWorkspaceErrorIndicator(workspaceId);
    }
    if (["queued", "running", "cancelling", "failed", "timeout", "cancelled"].includes(phase)) {
      setCompletedIndicators((current) => current[workspaceId] ? { ...current, [workspaceId]: false } : current);
    }
  }, [clearWorkspaceErrorIndicator, showTransientWorkspaceError]);

  useEffect(() => {
    const unsubscribers = tabs.map((tab) => subscribeExecutionStatus(sessionStoreRef.current.ensure(tab.id).identity, (status) => {
      applyWorkspaceExecutionPhase(tab.id, status.phase, tab.id === activeId);
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeId, applyWorkspaceExecutionPhase, tabs]);

  useEffect(() => {
    let disposed = false;
    const syncHostPhases = async () => {
      const hostStatus = await getHostExecutionStatus().catch(() => null);
      if (disposed || !hostStatus) return;
      for (const tab of tabs) {
        const identity = sessionStoreRef.current.ensure(tab.id).identity;
        const hostEntry = hostStatus.executions.find((entry) => matchesHostExecution(identity, entry));
        const phase = hostEntry?.phase ?? getExecutionStatus(identity).phase;
        applyWorkspaceExecutionPhase(tab.id, phase, tab.id === activeId);
      }
    };
    void syncHostPhases();
    const timer = window.setInterval(() => void syncHostPhases(), 300);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeId, applyWorkspaceExecutionPhase, tabs]);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  useEffect(() => {
    setCompletedIndicators((current) => current[activeId] ? { ...current, [activeId]: false } : current);
  }, [activeId]);

  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    setCompletedIndicators((current) => current[id] ? { ...current, [id]: false } : current);
  }, []);

  const addTab = useCallback(() => {
    const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setTabs((current) => {
      const usedNumbers = new Set(current.map((tab) => Number(tab.name.match(/^工作流\s+(\d+)$/)?.[1])).filter(Number.isFinite));
      let number = 1;
      while (usedNumbers.has(number)) number += 1;
      const name = `工作流 ${number}`;
      sessionStoreRef.current.ensure(id, emptyWorkflowSnapshot());
      return [...current, { id, name }];
    });
    setActiveId(id);
  }, []);

  const performCloseTab = useCallback((id: string) => {
    setTabs((current) => {
      if (current.length <= 1) return current;
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeId && next.length) {
        const neighbor = next[Math.max(0, index - 1)];
        if (neighbor) setActiveId(neighbor.id);
      }
      const closingSession = sessionStoreRef.current.get(id);
      const identity = closingSession?.identity ?? createWorkspaceSessionIdentity(id, workspaceExecutionClientId, workspaceSessionSource);
      cancelActiveExecution(identity);
      clearWorkspaceExecutionResult(identity);
      clearWorkspaceVariableState(identity);
      sessionStoreRef.current.delete(id);
      lifecycleRef.current.clearAutosave(id);
      setExecutionPhases((phases) => { const next = { ...phases }; delete next[id]; return next; });
      setCompletedIndicators((markers) => { const next = { ...markers }; delete next[id]; return next; });
      setErrorIndicators((markers) => { const next = { ...markers }; delete next[id]; return next; });
      const errorTimer = errorIndicatorTimersRef.current.get(id);
      if (errorTimer !== undefined) window.clearTimeout(errorTimer);
      errorIndicatorTimersRef.current.delete(id);
      delete previousExecutionPhasesRef.current[id];
      return next;
    });
  }, [activeId]);

  const closeTab = useCallback((id: string) => {
    if (tabs.length <= 1) return;
    const session = sessionStoreRef.current.get(id);
    if (!session || !lifecycleRef.current.needsSaveBeforeClose(session)) {
      performCloseTab(id);
      return;
    }
    setPendingCloseTabId(id);
  }, [performCloseTab, tabs.length]);

  const savePendingTabAndClose = useCallback(() => {
    if (!pendingCloseTabId) return;
    const tab = tabs.find((item) => item.id === pendingCloseTabId);
    const session = sessionStoreRef.current.get(pendingCloseTabId);
    if (!tab || !session) { setPendingCloseTabId(null); return; }
    lifecycleRef.current.saveSession(session, tab.name, (json) => persistSerializedWorkflow(resourceLibraryRef.current!, json, tab.name));
    const id = pendingCloseTabId;
    setPendingCloseTabId(null);
    performCloseTab(id);
  }, [pendingCloseTabId, performCloseTab, tabs]);

  const discardPendingTabAndClose = useCallback(() => {
    if (!pendingCloseTabId) return;
    const id = pendingCloseTabId;
    setPendingCloseTabId(null);
    performCloseTab(id);
  }, [pendingCloseTabId, performCloseTab]);

  const renameTab = (id: string, name: string) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, name } : tab)));
  };

  const reorderTab = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((current) => {
      const fromIndex = current.findIndex((tab) => tab.id === fromId);
      const toIndex = current.findIndex((tab) => tab.id === toId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const api: TabsApi = { tabs, activeId, executionPhases, completedIndicators, errorIndicators, selectTab, addTab, closeTab, renameTab, reorderTab };

  return (
    <TabsContext.Provider value={api}>
      <div className="workspace-shell" data-theme={resolvedTheme}>
        <TitleBar />
        <ReactFlowProvider key={activeTab.id}><FlowEditor session={sessionStoreRef.current.ensure(activeTab.id, emptyWorkflowSnapshot())} lifecycle={lifecycleRef.current} resourceLibrary={resourceLibraryRef.current!} tabName={activeTab.name} onAddTab={addTab} themeMode={themeMode} resolvedTheme={resolvedTheme} onThemeModeChange={setThemeMode} /></ReactFlowProvider>
        <UnsavedChangesDialog open={Boolean(pendingCloseTabId)} title="是否保存后关闭标签页？" message={`“${tabs.find((tab) => tab.id === pendingCloseTabId)?.name ?? "当前标签页"}”包含尚未保存的修改。`} onSave={savePendingTabAndClose} onDiscard={discardPendingTabAndClose} onCancel={() => setPendingCloseTabId(null)} />
      </div>
    </TabsContext.Provider>
  );
}
