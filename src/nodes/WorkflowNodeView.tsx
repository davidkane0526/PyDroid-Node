import { createContext, useContext, useEffect, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BaseEdge, Handle, NodeResizer, Position, getBezierPath, useUpdateNodeInternals, type EdgeProps, type NodeProps } from "@xyflow/react";
import { getNodeSpec, type NodeSpec, type ParameterSpec } from "../nodeCatalog";
import { resolveNodeSpec } from "../nodeSpec";
import { type WorkflowNode } from "../workflow";
import { resolveNodeCardLayout } from "./layout";
import { isIfStructureNodeType, isLoopStructureNodeType, isVisualStructureNodeType } from "../workflow-structure-types";
import { declarativeUiValues, declarativeUiVisible, resolveDeclarativeParameter } from "./declarativeUi";
import { getNodePluginIconDataUrl } from "../plugins/PluginManager";
import { NumericInput } from "../NumericInput";
import { ThemedSelect } from "../ThemedSelect";
import { PrimitiveValueControl } from "../ui/PrimitiveValueControl";
import { PlotPreview } from "../ui/PlotPreview";
import { type NodeExecutionPreview } from "../execution";
import { VALUE_TYPE_COLORS } from "./valueTypeColors";

export const EdgeActionsContext = createContext<{ disconnect: (ids: string[]) => void }>({ disconnect: () => undefined });

export function TypedGradientEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps) {
  const edgeActions = useContext(EdgeActionsContext);
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const gradientId = `edge-gradient-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const colors = data as { sourceColor?: string; targetColor?: string } | undefined;
  return <><defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}><stop offset="0%" stopColor={colors?.sourceColor ?? "#64748b"}/><stop offset="100%" stopColor={colors?.targetColor ?? "#64748b"}/></linearGradient></defs><BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={38} style={{ ...style, stroke: `url(#${gradientId})` }} /><path className="edge-disconnect-hit" d={path} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); edgeActions.disconnect([id]); }} /></>;
}

export const NodeInsightContext = createContext<{ visible: boolean; results: Record<string, NodeExecutionPreview> }>({ visible: true, results: {} });
export const NodeLayoutContext = createContext<"horizontal" | "vertical">("horizontal");
export const NodeAppearanceContext = createContext<{ nodeScale: number; endpointScale: number }>({ nodeScale: 1, endpointScale: 1 });
export const NodeSelectionContext = createContext<{ active: boolean; toggle: (nodeId: string) => void; remove: (nodeId: string) => void }>({ active: false, toggle: () => undefined, remove: () => undefined });
export const NodeRunContext = createContext<{ run: (nodeId: string) => void; busy: boolean }>({ run: () => undefined, busy: false });
export const NodeParameterContext = createContext<{ update: (nodeId: string, key: string, value: string | number | boolean | null) => void }>({ update: () => undefined });
export const NodeConnectionsContext = createContext<{ isInputConnected: (nodeId: string, handleId: string) => boolean }>({ isInputConnected: () => false });
function InlineNodeControl({
  spec,
  value,
  className = "",
  onChange,
  primitive = false,
}: {
  spec: ParameterSpec;
  value: unknown;
  className?: string;
  onChange: (value: string | number | boolean | null) => void;
  primitive?: boolean;
}) {
  const stop = (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => event.stopPropagation();
  if (primitive) return <PrimitiveValueControl spec={spec} value={value} stopPropagation onChange={onChange} />;
  if (spec.kind === "boolean") {
    return <label className={`node-inline-control node-inline-control--boolean nodrag nopan ${className}`} title={spec.label} onPointerDown={stop}><input type="checkbox" checked={Boolean(value)} disabled={Boolean(spec.disabled || spec.readOnly)} onChange={(event) => onChange(event.target.checked)} /><span>{Boolean(value) ? "True" : "False"}</span></label>;
  }
  if (spec.kind === "select") {
    const options = spec.options ?? [];
    const selected = options.find((option) => option.value === value) ?? options.find((option) => String(option.value) === String(value ?? "")) ?? options[0];
    return <ThemedSelect
      ariaLabel={spec.label}
      value={selected?.value ?? String(value ?? "")}
      options={options}
      disabled={Boolean(spec.disabled || spec.readOnly)}
      className={`themed-select--node nodrag nopan ${className}`}
      stopPropagation
      onChange={(next) => onChange(next)}
    />;
  }
  if (spec.kind === "number") {
    return <NumericInput label={spec.label} value={value as string | number | null | undefined} min={spec.min} max={spec.max} step={spec.step} readOnly={Boolean(spec.readOnly)} disabled={Boolean(spec.disabled)} className={`numeric-input--node nodrag nopan ${className}`} inputClassName="node-inline-control node-inline-control--number" stopPropagation onChange={onChange} />;
  }
  if (spec.kind === "color") {
    return <input className={`node-inline-control node-inline-control--color nodrag nopan ${className}`} aria-label={spec.label} title={spec.label} type="color" value={String(value ?? "#3b82f6")} readOnly={Boolean(spec.readOnly)} disabled={Boolean(spec.disabled)} onPointerDown={stop} onClick={stop} onChange={(event) => onChange(event.target.value)} />;
  }
  if (spec.kind === "datetime") {
    return <input className={`node-inline-control node-inline-control--datetime nodrag nopan ${className}`} aria-label={spec.label} title={spec.label} type="datetime-local" value={String(value ?? "")} readOnly={Boolean(spec.readOnly)} disabled={Boolean(spec.disabled)} onPointerDown={stop} onClick={stop} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input className={`node-inline-control nodrag nopan ${className}`} aria-label={spec.label} title={spec.label} type="text" value={String(value ?? "")} readOnly={Boolean(spec.readOnly)} disabled={Boolean(spec.disabled)} onPointerDown={stop} onClick={stop} onChange={(event) => onChange(event.target.value)} />;
}

export function WorkflowNodeCard({ id, data, selected }: NodeProps<WorkflowNode>) {
  const spec: NodeSpec | undefined = data.nodeType === "workflow.group"
    ? { nodeType: "workflow.group", label: data.label, category: "逻辑控制" as const, defaults: {}, parameters: [], inputPorts: data.groupInputs ?? [], outputPorts: data.groupOutputs ?? [] }
    : data.nodeType === "function.call" || data.nodeType === "function.map"
      ? { nodeType: data.nodeType, label: data.label, category: "自定义" as const, defaults: {}, parameters: [], inputPorts: data.functionInputs ?? [], outputPorts: data.functionOutputs ?? [] }
      : resolveNodeSpec(getNodeSpec(data.nodeType), data.parameters);
  const insight = useContext(NodeInsightContext);
  const nodeResult = insight.results[id];
  const direction = useContext(NodeLayoutContext);
  const { nodeScale, endpointScale } = useContext(NodeAppearanceContext);
  const selection = useContext(NodeSelectionContext);
  const nodeRun = useContext(NodeRunContext);
  const nodeParameters = useContext(NodeParameterContext);
  const nodeConnections = useContext(NodeConnectionsContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const inputPorts = spec?.inputPorts ?? [];
  const outputPorts = spec?.outputPorts ?? [];
  const inlineParameterKeys = spec?.ui?.inlineParameters ?? [];
  const effectiveUiValues = spec ? declarativeUiValues(spec, data.parameters) : data.parameters;
  const inlineParameters = inlineParameterKeys
    .map((key) => spec?.parameters.find((parameter) => parameter.key === key))
    .filter((parameter): parameter is ParameterSpec => Boolean(parameter))
    .filter((parameter) => declarativeUiVisible(parameter.visibleWhen, effectiveUiValues))
    .map((parameter) => resolveDeclarativeParameter(parameter, effectiveUiValues));
  const inlineLayout = spec?.ui?.inlineLayout ?? "stack";
  const inlineParameterLabels = spec?.ui?.inlineParameterLabels ?? {};
  const parameterByKey = new Map((spec?.parameters ?? []).map((parameter) => [parameter.key, resolveDeclarativeParameter(parameter, effectiveUiValues)]));
  const inlineOwnedParameterKeys = new Set([...inlineParameterKeys, ...inputPorts.flatMap((port) => port.defaultParameter ? [port.defaultParameter] : [])]);
  const inspectorParameterCount = (spec?.parameters ?? []).filter((parameter) => !inlineOwnedParameterKeys.has(parameter.key)).length;
  const inputDefaultSpecs = inputPorts.map((port) => port.defaultParameter ? parameterByKey.get(port.defaultParameter) : undefined).filter((parameter): parameter is ParameterSpec => Boolean(parameter));
  const hasInlineSocketDefaults = inputDefaultSpecs.length > 0;
  const isPrimitiveValueNode = ["value.number", "value.text", "value.boolean", "value.color", "value.datetime"].includes(data.nodeType);
  const nodeLayout = resolveNodeCardLayout({
    requestedDirection: direction,
    label: data.label,
    inputPorts,
    outputPorts,
    inputDefaultSpecs,
    inlineParameters,
    inlineLayout,
    hasVariants: Boolean(spec?.variants?.length),
    hasInputPortGroups: Boolean(spec?.inputPortGroups?.length),
    hasDynamicPorts: data.nodeType === "custom.python_function" || data.nodeType === "function.call" || data.nodeType === "function.map" || data.nodeType === "workflow.group",
    isGroup: data.nodeType === "workflow.group",
    isPrimitive: isPrimitiveValueNode,
    nodeScale,
    endpointScale,
  });
  const effectiveDirection = nodeLayout.direction;
  const hasDynamicUi = nodeLayout.dynamic;
  const { inputPortLabelWidth, outputPortLabelWidth, verticalPortLabelWidth, verticalFormLabelWidth, socketControlWidth, inputRailWidth, outputRailWidth, sideFormControlOffset, sideFormTop, nodeCenterShift, verticalPortItemWidth, nodeWidth, nodeMinHeight } = nodeLayout;
  const isStructure = isVisualStructureNodeType(data.nodeType);
  const isIfZone = isIfStructureNodeType(data.nodeType);
  const isLoopZone = isLoopStructureNodeType(data.nodeType);
  const isBoundaryZone = isIfZone || isLoopZone;
  const loopEndLabel = data.nodeType === "logic.for_each_value" ? "End For" : data.nodeType === "logic.while_state" ? "End While" : null;
  const loopEndType = data.nodeType === "logic.for_each_value" ? "logic.for_each_end" : data.nodeType === "logic.while_state" ? "logic.while_end" : null;
  const isFunctionNode = data.nodeType === "function.call" || data.nodeType === "function.map" || Boolean(data.functionSourceId);
  const isGroupNode = data.nodeType === "workflow.group";
  const nodeKindClasses = `${isFunctionNode ? "node-kind-function" : ""} ${isGroupNode ? "node-kind-group" : ""} ${isStructure ? "node-kind-flow" : "node-kind-node"}`;
  const visibleTypeLabel = hasDynamicUi ? null : data.nodeType;
  const useHorizontalSideForm = nodeLayout.sideRailLayout && inlineParameters.length > 0;
  const pluginIconUrl = getNodePluginIconDataUrl(data.nodeType);
  useEffect(() => {
    const refresh = () => updateNodeInternals(id);
    refresh();
    const element = document.querySelector<HTMLElement>(`[data-workflow-node-id="${CSS.escape(id)}"]`);
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(refresh);
    observer.observe(element);
    return () => observer.disconnect();
  }, [effectiveDirection, endpointScale, inputPortLabelWidth, outputPortLabelWidth, id, nodeMinHeight, nodeScale, nodeWidth, updateNodeInternals, verticalPortLabelWidth]);
  const inputPortStyle = (index: number): CSSProperties => {
    if (isBoundaryZone && effectiveDirection === "horizontal") return { top: `${28 + index * 26}px` };
    if (isBoundaryZone && effectiveDirection === "vertical") return { left: `${70 + index * 78}px` };
    if (nodeLayout.sideRailLayout) return { top: `${nodeLayout.portTop(index, inputPorts.length) * nodeScale}px` };
    if (nodeLayout.verticalFormLayout) return { left: `${nodeLayout.verticalPortLeft(index, inputPorts.length)}%` };
    return effectiveDirection === "horizontal" ? { top: `${((index + 1) * 100) / (inputPorts.length + 1)}%` } : { left: `${((index + 1) * 100) / (inputPorts.length + 1)}%` };
  };
  const outputPortStyle = (index: number): CSSProperties => {
    if (isBoundaryZone && effectiveDirection === "horizontal") return { top: `calc(100% - ${56 - index * 19}px)` };
    if (isBoundaryZone && effectiveDirection === "vertical") return { left: `calc(100% - ${190 - index * 62}px)` };
    if (nodeLayout.sideRailLayout) return { top: `${nodeLayout.portTop(index, outputPorts.length) * nodeScale}px` };
    if (nodeLayout.verticalFormLayout) return { left: `${nodeLayout.verticalPortLeft(index, outputPorts.length)}%` };
    return effectiveDirection === "horizontal" ? { top: `${((index + 1) * 100) / (outputPorts.length + 1)}%` } : { left: `${((index + 1) * 100) / (outputPorts.length + 1)}%` };
  };
  return (
    <div style={{ "--node-width": `${isStructure ? 520 : nodeWidth}px`, "--node-min-height": `${isStructure ? (isBoundaryZone ? 250 : 220) : nodeMinHeight}px`, "--port-label-width": `${Math.max(inputPortLabelWidth, outputPortLabelWidth) * nodeScale}px`, "--input-port-label-width": `${inputPortLabelWidth * nodeScale}px`, "--output-port-label-width": `${outputPortLabelWidth * nodeScale}px`, "--vertical-port-label-width": `${verticalPortLabelWidth * nodeScale}px`, "--vertical-form-label-width": `${verticalFormLabelWidth * nodeScale}px`, "--input-rail-width": `${inputRailWidth * nodeScale}px`, "--output-rail-width": `${outputRailWidth * nodeScale}px`, "--side-form-control-offset": `${sideFormControlOffset * nodeScale}px`, "--side-form-top": `${sideFormTop * nodeScale}px`, "--node-center-shift": `${nodeCenterShift * nodeScale}px`, "--socket-control-width": `${socketControlWidth * nodeScale}px`, "--vertical-port-item-width": `${verticalPortItemWidth * nodeScale}px`, "--node-scale": nodeScale, "--endpoint-scale": endpointScale } as CSSProperties} data-workflow-node-id={id} className={`workflow-node ${nodeKindClasses} direction-${effectiveDirection} ${isStructure ? "workflow-structure" : ""} ${isIfZone ? "workflow-structure--if workflow-if-zone" : ""} ${isLoopZone ? `workflow-structure--loop workflow-loop-zone workflow-loop-zone--${data.nodeType === "logic.for_each_value" ? "for" : "while"}` : ""} ${hasDynamicUi ? "workflow-node--dynamic-ui" : ""} ${nodeLayout.sideRailLayout ? "workflow-node--side-rail" : ""} ${nodeLayout.verticalFormLayout ? "workflow-node--vertical-form" : ""} ${isPrimitiveValueNode ? "workflow-node--primitive" : ""} ${inputPorts.length ? "has-inputs" : ""} ${hasInlineSocketDefaults ? "has-inline-input-defaults" : ""} ${outputPorts.length ? "has-outputs" : ""} status-${data.status ?? "idle"} ${selected ? "selected" : ""}`}>
      {selection.active && <button className={`node-selection-check nodrag nopan ${selected ? "checked" : ""}`} type="button" aria-label={`${selected ? "取消选择" : "选择"}${data.label}`} aria-pressed={selected} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); selection.toggle(id); }}>{selected ? "✓" : ""}</button>}
      <button className="node-run-action nodrag nopan" type="button" disabled={nodeRun.busy} aria-label={`运行 ${data.label}`} title="单独运行 · 自动补齐上游依赖" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); nodeRun.run(id); }}><svg className="node-run-action__icon" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M5.25 3.15 L11.25 6.55 Q12.85 7 11.25 7.45 L5.25 10.85 Q4.25 11.42 4.25 10.28 L4.25 3.72 Q4.25 2.58 5.25 3.15 Z" /></svg></button>
      {isStructure && <NodeResizer minWidth={isBoundaryZone ? 440 : 360} minHeight={isBoundaryZone ? 250 : 220} isVisible={selected} />}
      <Handle className="notebook-order-handle" id="__notebook_order_in" type="target" position={effectiveDirection === "horizontal" ? Position.Left : Position.Top} isConnectable={false} />
      <Handle className="notebook-order-handle" id="__notebook_order_out" type="source" position={effectiveDirection === "horizontal" ? Position.Right : Position.Bottom} isConnectable={false} />
      {inputPorts.map((port, index) => {
        const defaultSpec = port.defaultParameter ? parameterByKey.get(port.defaultParameter) : undefined;
        const connected = nodeConnections.isInputConnected(id, port.id);
        return (
          <div className={`input-port ${defaultSpec && !connected ? "input-port--with-default" : ""}`} style={Object.assign(inputPortStyle(index), { "--port-color": VALUE_TYPE_COLORS[port.valueType] }) as CSSProperties} key={port.id}>
            <Handle id={port.id} type="target" position={effectiveDirection === "horizontal" ? Position.Left : Position.Top} />
            <div className="node-port-content node-port-content--input">
              {port.label && <span className="node-port-label" title={`${port.label} · ${port.valueType}`}>{port.label}<small>{port.valueType}</small></span>}
              {defaultSpec && !nodeLayout.verticalFormLayout && !connected && <InlineNodeControl spec={defaultSpec} value={data.parameters[defaultSpec.key] ?? defaultSpec.defaultValue} className="node-inline-control--socket" onChange={(value) => nodeParameters.update(id, defaultSpec.key, value)} />}
            </div>
          </div>
        );
      })}
      <div className="workflow-node__body">
        {visibleTypeLabel && <div className="workflow-node__type" title={data.nodeType}>{visibleTypeLabel}</div>}
        <div className="workflow-node__label" title={data.label}>{pluginIconUrl && <img className="workflow-node__plugin-icon" src={pluginIconUrl} alt=""/>}{data.label}</div>
        {nodeLayout.verticalFormLayout && inputPorts.some((port) => Boolean(port.defaultParameter)) && <div className="workflow-node__socket-form">{inputPorts.map((port) => {
          const defaultSpec = port.defaultParameter ? parameterByKey.get(port.defaultParameter) : undefined;
          if (!defaultSpec) return null;
          const connected = nodeConnections.isInputConnected(id, port.id);
          const socketSpec = connected ? { ...defaultSpec, disabled: true } : defaultSpec;
          return <label key={port.id} title={`${port.label} · ${defaultSpec.label}`}><span>{defaultSpec.label}</span><InlineNodeControl spec={socketSpec} value={data.parameters[defaultSpec.key] ?? defaultSpec.defaultValue} onChange={(value) => nodeParameters.update(id, defaultSpec.key, value)} /></label>;
        })}</div>}
        {inlineParameters.length > 0 && <div className={`workflow-node__inline-controls workflow-node__inline-controls--${inlineLayout} ${useHorizontalSideForm ? "workflow-node__inline-controls--side-form" : ""}`}>{inlineParameters.map((parameter) => {
          const declaredLabel = Object.prototype.hasOwnProperty.call(inlineParameterLabels, parameter.key) ? inlineParameterLabels[parameter.key] : parameter.label;
          const showLabel = declaredLabel !== null && declaredLabel !== "";
          return <label className={showLabel ? "" : "workflow-node__inline-control--label-hidden"} key={parameter.key} title={parameter.label}>{showLabel && <span>{declaredLabel}</span>}<InlineNodeControl spec={parameter} value={data.parameters[parameter.key] ?? parameter.defaultValue} primitive={isPrimitiveValueNode} onChange={(value) => nodeParameters.update(id, parameter.key, value)} /></label>;
        })}</div>}
        <div className="workflow-node__meta">
          {data.nodeType === "workflow.group"
            ? <span className="workflow-node__meta-count">{`${data.groupInputs?.length ?? 0} 输入 · ${data.groupOutputs?.length ?? 0} 输出 · 双击操作`}</span>
            : inspectorParameterCount > 0 && <span className="workflow-node__meta-count">{`${inspectorParameterCount} 参数`}</span>}
          {data.nodeType !== "workflow.group" && data.tags?.map((tag) => <span className="workflow-node__tag" key={tag}>{tag}</span>)}
        </div>
      </div>
      {isStructure && <div className="workflow-structure__interior">
        {isIfZone ? <><div className="workflow-structure__lane workflow-structure__lane--true"><span>TRUE</span></div><div className="workflow-structure__lane workflow-structure__lane--false"><span>FALSE</span></div></> : <div className="workflow-structure__lane workflow-structure__lane--body"><span>BODY</span></div>}
      </div>}
      {isIfZone && <div className="workflow-if-zone__end" aria-hidden="true"><div className="workflow-if-zone__end-type">logic.if_end</div><strong>End If</strong></div>}
      {isLoopZone && loopEndLabel && loopEndType && <div className="workflow-loop-zone__end" aria-hidden="true"><div className="workflow-loop-zone__end-type">{loopEndType}</div><strong>{loopEndLabel}</strong></div>}
      {outputPorts.map((port, index) => (
        <div className="output-port" style={Object.assign(outputPortStyle(index), { "--port-color": VALUE_TYPE_COLORS[port.valueType] }) as CSSProperties} key={port.id}>
          <div className="node-port-content node-port-content--output">{port.label && <span className="node-port-label" title={`${port.label} · ${port.valueType}`}>{port.label}<small>{port.valueType}</small></span>}</div>
          <Handle id={port.id} type="source" position={effectiveDirection === "horizontal" ? Position.Right : Position.Bottom} />
        </div>
      ))}
      {insight.visible && nodeResult && <div className={`node-insight node-insight--${nodeResult.kind} ${data.nodeType === "python.print" ? "node-insight--print" : ""}`}>
        {nodeResult.kind === "plot" && <PlotPreview preview={nodeResult} mode="thumbnail" alt={`${data.label} 中间结果`} />}
        {nodeResult.kind === "table" && <><strong>{nodeResult.preview.totalRows}×{nodeResult.preview.totalColumns}</strong><span>{nodeResult.preview.columns.slice(0, 3).join(" · ")}</span></>}
        {nodeResult.kind === "value" && <><strong>{data.nodeType === "python.print" ? "打印结果" : "结果"}</strong><span>{nodeResult.text}</span></>}
      </div>}
    </div>
  );
}
