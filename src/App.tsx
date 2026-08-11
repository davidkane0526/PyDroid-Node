import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import { NODE_CATALOG, getNodeSpec, type NodeSpec, type ParameterSpec } from "./nodeCatalog";
import {
  parseWorkflow,
  serializeWorkflow,
  type WorkflowNode,
} from "./workflow";
import { executeWorkflow, WorkflowExecutionError, type ExecutionResult } from "./execution";

const AUTOSAVE_KEY = "pydroid-flow.autosave.v1";

type WorkflowSnapshot = { nodes: WorkflowNode[]; edges: Edge[] };

const initialNodes: WorkflowNode[] = [
  createNode("read-csv", "io.read_csv", 40, 100, { skipRows: 2 }),
  createNode("select-columns", "table.select_columns", 280, 100, { columns: "0,1" }),
  createNode("group-aggregate", "table.group_aggregate", 520, 100),
  createNode("line-plot", "plot.line", 760, 40),
  createNode("export-csv", "io.export_csv", 760, 190),
];

const initialEdges: Edge[] = [
  { id: "e1", source: "read-csv", target: "select-columns" },
  { id: "e2", source: "select-columns", target: "group-aggregate" },
  { id: "e3", source: "group-aggregate", target: "line-plot" },
  { id: "e4", source: "group-aggregate", target: "export-csv" },
];

function createNode(
  id: string,
  nodeType: string,
  x: number,
  y: number,
  parameterOverrides: Record<string, string | number | boolean | null> = {},
): WorkflowNode {
  const spec = getNodeSpec(nodeType);
  return {
    id,
    type: "workflow",
    position: { x, y },
    data: {
      label: spec?.label ?? nodeType,
      nodeType,
      nodeVersion: 1,
      parameters: { ...(spec?.defaults ?? {}), ...parameterOverrides },
      status: "idle",
    },
  };
}

function groupCatalog(): Map<NodeSpec["category"], NodeSpec[]> {
  const groups = new Map<NodeSpec["category"], NodeSpec[]>();
  for (const item of NODE_CATALOG) {
    const group = groups.get(item.category) ?? [];
    group.push(item);
    groups.set(item.category, group);
  }
  return groups;
}

function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkflowSnapshot;
}

function loadAutosave(): WorkflowSnapshot | null {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) return null;
    const document = parseWorkflow(saved);
    return {
      nodes: document.nodes.map((node) => ({
        ...node,
        type: "workflow",
        data: { ...node.data, status: "idle" },
      })),
      edges: document.edges,
    };
  } catch {
    localStorage.removeItem(AUTOSAVE_KEY);
    return null;
  }
}

function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowNode>) {
  const inputPorts = getNodeSpec(data.nodeType)?.inputPorts ?? [{ id: "input", label: "" }];
  return (
    <div className={`workflow-node status-${data.status ?? "idle"} ${selected ? "selected" : ""}`}>
      {inputPorts.map((port, index) => (
        <div className="input-port" style={{ top: `${((index + 1) * 100) / (inputPorts.length + 1)}%` }} key={port.id}>
          <Handle id={port.id} type="target" position={Position.Left} />
          {port.label && <span>{port.label}</span>}
        </div>
      ))}
      <div className="workflow-node__type">{data.nodeType}</div>
      <div className="workflow-node__label">{data.label}</div>
      <Handle id="output" type="source" position={Position.Right} />
    </div>
  );
}

function ParameterField({
  spec,
  value,
  onChange,
}: {
  spec: ParameterSpec;
  value: string | number | boolean | null | undefined;
  onChange: (value: string | number | boolean | null) => void;
}) {
  if (spec.kind === "boolean") {
    return (
      <label className="field field--checkbox">
        <span>{spec.label}</span>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      </label>
    );
  }
  if (spec.kind === "select") {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <select
          value={String(value ?? "")}
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
  return (
    <label className="field">
      <span>{spec.label}</span>
      <input
        type={spec.kind === "number" ? "number" : "text"}
        value={String(value ?? "")}
        onChange={(event) => onChange(spec.kind === "number" ? Number(event.target.value) : event.target.value)}
      />
    </label>
  );
}

function FlowEditor() {
  const restoredSnapshot = useMemo(loadAutosave, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(restoredSnapshot?.nodes ?? initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(restoredSnapshot?.edges ?? initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState(restoredSnapshot ? "已恢复上次自动保存的流程" : "尚未执行");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workflowInput = useRef<HTMLInputElement>(null);
  const nextNodeNumber = useRef(1);
  const history = useRef<WorkflowSnapshot[]>([]);
  const future = useRef<WorkflowSnapshot[]>([]);
  const [, setHistoryRevision] = useState(0);
  const nodeTypes = useMemo(() => ({ workflow: WorkflowNodeCard }), []);
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const selectedSpec = selectedNode ? getNodeSpec(selectedNode.data.nodeType) : undefined;
  const catalogGroups = useMemo(groupCatalog, []);

  const currentSnapshot = () => cloneSnapshot({ nodes, edges });

  const pushHistory = () => {
    history.current.push(currentSnapshot());
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    setHistoryRevision((value) => value + 1);
  };

  const restoreSnapshot = (snapshot: WorkflowSnapshot) => {
    setNodes(snapshot.nodes.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
    setEdges(snapshot.edges);
    setSelectedId(null);
    setResult(null);
  };

  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    future.current.push(currentSnapshot());
    restoreSnapshot(previous);
    setMessage("已撤销上一步");
    setHistoryRevision((value) => value + 1);
  };

  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(currentSnapshot());
    restoreSnapshot(next);
    setMessage("已重做上一步");
    setHistoryRevision((value) => value + 1);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify(serializeWorkflow("自动保存", nodes, edges)),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [edges, nodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea")) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const resetExecution = useCallback(() => {
    setResult(null);
    setMessage("流程已修改，等待运行");
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
  }, [setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      pushHistory();
      const targetNode = nodes.find((node) => node.id === connection.target);
      const isMultiInput = (getNodeSpec(targetNode?.data.nodeType ?? "")?.inputPorts?.length ?? 1) > 1;
      setEdges((current) => addEdge(connection, current.filter((edge) => {
        if (edge.target !== connection.target) return true;
        return isMultiInput ? edge.targetHandle !== connection.targetHandle : false;
      })));
      resetExecution();
    },
    [edges, nodes, resetExecution, setEdges],
  );

  const addNodeFromCatalog = (nodeType: string) => {
    pushHistory();
    const number = nextNodeNumber.current++;
    const id = `${nodeType.replaceAll(".", "-")}-${Date.now()}-${number}`;
    const column = (nodes.length + number) % 3;
    const row = Math.floor((nodes.length + number) / 3) % 4;
    const node = createNode(id, nodeType, 80 + column * 230, 80 + row * 150);
    setNodes((current) => [...current, node]);
    setSelectedId(id);
    setResult(null);
    setMessage(`已添加“${node.data.label}”节点`);
  };

  const deleteSelectedNode = () => {
    if (!selectedId) return;
    pushHistory();
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
    setSelectedId(null);
    setResult(null);
    setMessage("节点及其连线已删除");
  };

  const duplicateSelectedNode = () => {
    if (!selectedNode) return;
    pushHistory();
    const id = `${selectedNode.data.nodeType.replaceAll(".", "-")}-${Date.now()}-copy`;
    const copy: WorkflowNode = {
      ...cloneSnapshot({ nodes: [selectedNode], edges: [] }).nodes[0],
      id,
      selected: false,
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
      data: { ...selectedNode.data, status: "idle", label: `${selectedNode.data.label} 副本` },
    };
    setNodes((current) => [...current, copy]);
    setSelectedId(id);
    setResult(null);
    setMessage("节点已复制；连线不会自动复制");
  };

  const updateParameter = (key: string, value: string | number | boolean | null) => {
    if (!selectedId) return;
    pushHistory();
    setNodes((current) => current.map((node) => node.id === selectedId ? {
      ...node,
      data: { ...node.data, status: "idle", parameters: { ...node.data.parameters, [key]: value } },
    } : node));
    setResult(null);
    setMessage("参数已修改，等待运行");
  };

  const downloadText = (text: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveWorkflow = () => {
    const json = JSON.stringify(serializeWorkflow("PyDroid Flow 工作流", nodes, edges), null, 2);
    downloadText(json, "pydroid-flow.workflow.json", "application/json");
    setMessage("工作流 JSON 已导出");
  };

  const importWorkflow = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const document = parseWorkflow(await file.text());
      pushHistory();
      setNodes(document.nodes.map((node) => ({ ...node, type: "workflow", data: { ...node.data, status: "idle" } })));
      setEdges(document.edges);
      setSelectedId(null);
      setResult(null);
      setMessage(`已导入流程“${document.name}”`);
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "工作流导入失败");
    } finally {
      event.target.value = "";
    }
  };

  const chooseCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsvText(await file.text());
    setResult(null);
    setMessage(`已载入 ${file.name}`);
  };

  const runPrototype = async () => {
    if (!csvText) {
      fileInput.current?.click();
      setMessage("请先选择 CSV 文件");
      return;
    }
    setMessage("正在执行 Python 工作流…");
    setResult(null);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "running" } })));
    try {
      const nextResult = await executeWorkflow(nodes, edges, csvText);
      setResult(nextResult);
      setMessage(`执行完成：${nextResult.preview.totalRows} 行 × ${nextResult.preview.totalColumns} 列`);
      setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "success" } })));
    } catch (error) {
      if (error instanceof WorkflowExecutionError) {
        setSelectedId(error.nodeId);
        setMessage(`${error.nodeType}：${error.message}`);
        setNodes((current) => current.map((node) => ({
          ...node,
          data: { ...node.data, status: node.id === error.nodeId ? "error" : "idle" },
        })));
      } else {
        setMessage(error instanceof Error ? error.message : "执行失败");
        setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "error" } })));
      }
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><strong>PyDroid Flow</strong><span>节点式 Python 数据处理</span></div>
        <div className="topbar__actions">
          <input ref={fileInput} className="file-input" type="file" accept=".csv,text/csv,text/plain" onChange={chooseCsv} />
          <input ref={workflowInput} className="file-input" type="file" accept=".json,application/json" onChange={importWorkflow} />
          <button className="button secondary compact" disabled={history.current.length === 0} onClick={undo}>撤销</button>
          <button className="button secondary compact" disabled={future.current.length === 0} onClick={redo}>重做</button>
          <button className="button secondary" onClick={() => fileInput.current?.click()}>{fileName ?? "选择 CSV"}</button>
          <button className="button secondary optional-action" onClick={() => workflowInput.current?.click()}>导入流程</button>
          <button className="button secondary optional-action" onClick={saveWorkflow}>保存流程</button>
          <button className="button primary" onClick={runPrototype}>运行</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="node-palette">
          <h2>节点</h2>
          {[...catalogGroups.entries()].map(([category, specs]) => (
            <section className="palette-group" key={category}>
              <h3>{category}</h3>
              {specs.map((spec) => <button key={spec.nodeType} onClick={() => addNodeFromCatalog(spec.nodeType)}>＋ {spec.label}</button>)}
            </section>
          ))}
        </aside>

        <section className="canvas-panel">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={pushHistory}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={null}
            fitView
            minZoom={0.25}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </section>

        <aside className="inspector">
          <div className="inspector__heading">
            <h2>参数</h2>
            {selectedNode && <div className="inspector__actions"><button className="download-link" onClick={duplicateSelectedNode}>复制</button><button className="danger-link" onClick={deleteSelectedNode}>删除</button></div>}
          </div>
          {selectedNode ? (
            <>
              <div className="inspector__node-type">{selectedNode.data.nodeType}</div>
              {selectedSpec ? selectedSpec.parameters.map((parameter) => (
                <ParameterField
                  key={parameter.key}
                  spec={parameter}
                  value={selectedNode.data.parameters[parameter.key]}
                  onChange={(value) => updateParameter(parameter.key, value)}
                />
              )) : Object.entries(selectedNode.data.parameters).map(([key, value]) => (
                <label className="field" key={key}><span>{key}</span><input value={String(value ?? "")} onChange={(event) => updateParameter(key, event.target.value)} /></label>
              ))}
              {selectedSpec?.parameters.length === 0 && <p className="muted">此节点没有可配置参数。</p>}
            </>
          ) : <p className="muted">从左侧添加节点，或选择画布中的节点编辑参数。</p>}
          <div className="run-status"><span>状态 · 自动保存已开启</span><p>{message}</p></div>
          {result && (
            <section className="result-panel">
              <div className="result-panel__heading">
                <h3>结果预览</h3>
                {result.exportCsv && <button className="download-link" onClick={() => downloadText(result.exportCsv!, "result.csv", "text/csv;charset=utf-8")}>下载 CSV</button>}
              </div>
              <p className="result-summary">{result.preview.totalRows} 行 × {result.preview.totalColumns} 列</p>
              <div className="table-scroll">
                <table>
                  <thead><tr>{result.preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{result.preview.rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{String(value ?? "")}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {result.plotPngBase64 && <img className="plot-preview" src={`data:image/png;base64,${result.plotPngBase64}`} alt="Python 绘图结果" />}
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}

export function App() {
  return <ReactFlowProvider><FlowEditor /></ReactFlowProvider>;
}
