import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-node-layout-"));
try {
  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const result = spawnSync(tsc.command, [...tsc.args, path.join(root, "src", "nodes", "layout.ts"), path.join(root, "src", "nodeCatalog.ts"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", path.join(root, "src")], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  writeFileSync(path.join(temp, "package.json"), '{"type":"commonjs"}\n');
  const module = await import(pathToFileURL(path.join(temp, "nodes", "layout.js")).href);
  const layout = module.default ?? module;
  const ports = Array.from({ length: 12 }, (_, index) => ({ id: `item${index + 1}`, label: `Input ${index + 1}`, valueType: "any" }));

  const verticalDynamic = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Dynamic Inputs", inputPorts: ports, outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: true, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!verticalDynamic.dynamic || verticalDynamic.sideRailLayout || !verticalDynamic.verticalFormLayout || verticalDynamic.direction !== "vertical") throw new Error("vertical dynamic node did not preserve top-to-bottom form layout");
  if (verticalDynamic.nodeWidth > 360) throw new Error("vertical dynamic node exceeded compact width cap");
  const lefts = ports.map((_, index) => verticalDynamic.verticalPortLeft(index, ports.length));
  if (!lefts.every((value, index) => value > 0 && value < 100 && (index === 0 || value > lefts[index - 1]))) throw new Error("vertical ports are not deterministically distributed across top/bottom edges");

  const horizontalDynamic = layout.resolveNodeCardLayout({ requestedDirection: "horizontal", label: "Dynamic Inputs", inputPorts: ports, outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: true, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!horizontalDynamic.sideRailLayout || horizontalDynamic.verticalFormLayout || horizontalDynamic.direction !== "horizontal") throw new Error("horizontal dynamic node lost deterministic side rails");
  const tops = ports.map((_, index) => horizontalDynamic.portTop(index, ports.length));
  if (!tops.every((value, index) => index === 0 || value - tops[index - 1] === horizontalDynamic.portRowHeight)) throw new Error("horizontal dynamic ports do not use deterministic rows");
  if (tops.at(-1) >= horizontalDynamic.nodeMinHeight) throw new Error("last horizontal dynamic port exceeds node bounds");
  const singleOutputTop = horizontalDynamic.portTop(0, 1);
  if (Math.abs(singleOutputTop - horizontalDynamic.nodeMinHeight / 2) > horizontalDynamic.portRowHeight / 2) throw new Error("single horizontal output is not centered in its rail");


  const heatmapDefaults = [
    { key: "rowLabelColumn", label: "行标签列", kind: "text", defaultValue: "Vg_V" },
    { key: "colorMin", label: "颜色下限", kind: "number", defaultValue: null },
    { key: "colorMax", label: "颜色上限", kind: "number", defaultValue: null },
  ];
  const heatmapInputs = [
    { id: "input", label: "表格", valueType: "table" },
    { id: "rowLabelColumn", label: "Rows", valueType: "any", defaultParameter: "rowLabelColumn" },
    { id: "colorMin", label: "Min", valueType: "number", defaultParameter: "colorMin" },
    { id: "colorMax", label: "Max", valueType: "number", defaultParameter: "colorMax" },
  ];
  const heatmapLayout = layout.resolveNodeCardLayout({ requestedDirection: "horizontal", label: "绘制 TER 热图", inputPorts: heatmapInputs, outputPorts: [{ id: "output", label: "图像", valueType: "plot" }], inputDefaultSpecs: heatmapDefaults, inlineParameters: [{ key: "colorMap", label: "配色", kind: "select", defaultValue: "viridis", options: [{ value: "viridis", label: "Viridis" }] }], inlineLayout: "row", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  const heatmapInputTops = heatmapInputs.map((_, index) => heatmapLayout.portTop(index, heatmapInputs.length));
  if (!heatmapLayout.sideRailLayout || heatmapLayout.nodeMinHeight < 190 || heatmapLayout.nodeWidth > 277) throw new Error("horizontal heatmap is not using content-fit side-rail geometry");
  if (heatmapInputTops.at(-1) + heatmapLayout.portRowHeight / 2 >= heatmapLayout.nodeMinHeight) throw new Error("horizontal heatmap socket row escapes the card boundary");
  if (Math.abs(heatmapLayout.portTop(0, 1) - heatmapLayout.nodeMinHeight / 2) > 1) throw new Error("horizontal heatmap output is not vertically centered");
  const heatmapSocketColumn = heatmapLayout.inputRailWidth + heatmapLayout.sideFormControlOffset;
  const expectedHeatmapSocketColumn = 11 + heatmapLayout.inputPortLabelWidth + 7;
  if (Math.abs(heatmapSocketColumn - expectedHeatmapSocketColumn) > 0.001) throw new Error("horizontal heatmap inline control does not share the socket control column");
  if (heatmapLayout.sideFormTop + 0.001 < heatmapInputTops.at(-1) + heatmapLayout.portRowHeight / 2) throw new Error("horizontal heatmap inline form still crowds the final input-port row");
  const heatmapInlinePreferred = layout.inlineControlPreferredWidth({ key: "colorMap", label: "配色", kind: "select", defaultValue: "viridis", options: [{ value: "viridis", label: "Viridis" }] });
  if (heatmapLayout.socketControlWidth < heatmapInlinePreferred || heatmapLayout.socketControlWidth < 96) throw new Error("horizontal heatmap controls do not share a balanced control width");

  const compactExport = layout.resolveNodeCardLayout({ requestedDirection: "horizontal", label: "导出 TER 矩阵", inputPorts: [{ id: "input", label: "表格", valueType: "table" }], outputPorts: [{ id: "output", label: "CSV", valueType: "table" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (compactExport.dynamic || compactExport.nodeWidth > 250 || compactExport.nodeWidth < 210) throw new Error("simple horizontal node did not use compact content-fit width");


  const compactExportLong = layout.resolveNodeCardLayout({ requestedDirection: "horizontal", label: "导出 TER 长表", inputPorts: [{ id: "input", label: "表格", valueType: "table" }], outputPorts: [{ id: "output", label: "CSV", valueType: "csv" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (compactExportLong.nodeMinHeight < 92) throw new Error("long simple node title did not receive enough vertical breathing room");

  const staticVertical = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Static", inputPorts: [{ id: "input", label: "Input", valueType: "any" }], outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (staticVertical.dynamic || staticVertical.direction !== "vertical" || staticVertical.verticalFormLayout) throw new Error("static node layout was unnecessarily overridden");

  const inline = { key: "mode", label: "Mode", kind: "select", defaultValue: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
  const inlineDynamic = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Inline Dynamic", inputPorts: [{ id: "input", label: "Input", valueType: "any" }], outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [inline], inlineLayout: "row", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!inlineDynamic.dynamic || !inlineDynamic.verticalFormLayout || inlineDynamic.direction !== "vertical") throw new Error("vertical node with inline UI did not use shared form contract");

  const socket = { key: "value", label: "Value", kind: "number", defaultValue: 0 };
  const socketLayout = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Socket Defaults", inputPorts: [{ id: "value", label: "Value", valueType: "number", defaultParameter: "value" }], outputPorts: [], inputDefaultSpecs: [socket], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!socketLayout.verticalFormLayout || socketLayout.sideRailLayout || socketLayout.socketControlWidth < 70 || socketLayout.nodeMinHeight < 120) throw new Error("vertical socket default did not receive stable form geometry");

  const pivotInputs = [
    { id: "input", label: "表格", valueType: "table" },
    { id: "index", label: "Rows", valueType: "any", defaultParameter: "index" },
    { id: "columns", label: "Columns", valueType: "any", defaultParameter: "columns" },
    { id: "values", label: "Values", valueType: "any", defaultParameter: "values" },
  ];
  const pivotDefaults = [
    { key: "index", label: "行键列", kind: "text", defaultValue: "Vg_V" },
    { key: "columns", label: "列键列", kind: "text", defaultValue: "Vds_V" },
    { key: "values", label: "数值列", kind: "text", defaultValue: "TER_percent" },
  ];

  const pivotHorizontalLayout = layout.resolveNodeCardLayout({ requestedDirection: "horizontal", label: "生成 TER 矩阵", inputPorts: pivotInputs, outputPorts: [{ id: "output", label: "表格", valueType: "table" }], inputDefaultSpecs: pivotDefaults, inlineParameters: [{ key: "aggregate", label: "聚合", kind: "select", defaultValue: "mean", options: [{ value: "mean", label: "平均值" }] }], inlineLayout: "row", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!pivotHorizontalLayout.sideRailLayout || pivotHorizontalLayout.nodeWidth > 262) throw new Error("horizontal pivot still reserves excessive empty center width");
  if (pivotHorizontalLayout.nodeMinHeight < 190) throw new Error("horizontal pivot became vertically cramped while reducing width");

  const pivotLayout = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "生成 TER 矩阵", inputPorts: pivotInputs, outputPorts: [{ id: "output", label: "表格", valueType: "table" }], inputDefaultSpecs: pivotDefaults, inlineParameters: [inline], inlineLayout: "row", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: false, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (pivotLayout.nodeWidth > 360 || pivotLayout.nodeWidth < 230) throw new Error("vertical form width is not compact/readable");
  if (pivotLayout.nodeMinHeight < socketLayout.nodeMinHeight + 70) throw new Error("vertical form height does not grow with socket rows");

  const signaturePorts = Array.from({ length: 7 }, (_, index) => ({ id: `arg${index + 1}`, label: `Long function argument ${index + 1}`, valueType: "any" }));
  const functionLayout = layout.resolveNodeCardLayout({ requestedDirection: "vertical", label: "Portable Function", inputPorts: signaturePorts, outputPorts: [{ id: "result", label: "Result", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: false, hasDynamicPorts: true, isGroup: false, nodeScale: 1, endpointScale: 1 });
  if (!functionLayout.dynamic || !functionLayout.verticalFormLayout || functionLayout.direction !== "vertical") throw new Error("runtime-signature node did not preserve vertical flow");

  const denseEndpointLayout = layout.resolveNodeCardLayout({ requestedDirection: "horizontal", label: "Dense Endpoints", inputPorts: ports, outputPorts: [{ id: "output", label: "Output", valueType: "any" }], inputDefaultSpecs: [], inlineParameters: [], inlineLayout: "stack", hasVariants: false, hasInputPortGroups: true, hasDynamicPorts: false, isGroup: false, nodeScale: 0.75, endpointScale: 1.8 });
  if (denseEndpointLayout.portRowHeight * 0.75 < 16 * 1.8 + 5) throw new Error("horizontal dynamic port rows do not reserve enough room for enlarged endpoints");

  const appSource = readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  const cssSource = readFileSync(path.join(root, "src", "styles", "base.css"), "utf8");
  const catalogSource = readFileSync(path.join(root, "src", "nodeCatalog.ts"), "utf8");
  if (!appSource.includes('nodeLayout.verticalFormLayout ? "workflow-node--vertical-form"')) throw new Error("WorkflowNodeCard does not expose vertical form layout class");
  if (!appSource.includes('className="workflow-node__socket-form"')) throw new Error("vertical socket defaults are not rendered as body form rows");
  if (!appSource.includes('position={effectiveDirection === "horizontal" ? Position.Left : Position.Top}')) throw new Error("vertical input handles are not top-facing");
  if (!appSource.includes('position={effectiveDirection === "horizontal" ? Position.Right : Position.Bottom}')) throw new Error("vertical output handles are not bottom-facing");
  if (!cssSource.includes('.workflow-node--dynamic-ui.workflow-node--vertical-form.direction-vertical')) throw new Error("vertical dynamic form CSS contract is missing");
  if (!cssSource.includes('grid-template-columns: minmax(0, var(--vertical-form-label-width')) throw new Error("vertical form rows do not share aligned label/control columns");
  if (!cssSource.includes('min-height: max(calc(62px * var(--node-scale, 1)), var(--node-min-height')) throw new Error("wide-screen CSS can still override measured node height");
  if (!appSource.includes('workflow-node--side-rail')) throw new Error("WorkflowNodeCard does not expose horizontal side-rail layout class");
  if (!appSource.includes('workflow-node__inline-controls--side-form')) throw new Error("horizontal inline parameters are not rendered through the shared side-form grid");
  if (!appSource.includes('"--side-form-top"')) throw new Error("horizontal inline form does not consume measured form-row placement");
  if (!cssSource.includes('top: var(--side-form-top')) throw new Error("horizontal inline form still uses a hard-coded top offset");
  if (!cssSource.includes('.workflow-node--side-rail.direction-horizontal {\n  min-height: var(--node-min-height')) throw new Error("horizontal side-rail card does not directly preserve measured height");
  if (!cssSource.includes('direction-horizontal:not(.workflow-structure):not(.workflow-node--side-rail) .workflow-node__body')) throw new Error("simple horizontal body does not consume measured card height");
  if (!cssSource.includes('grid-template-columns: minmax(0, var(--input-port-label-width')) throw new Error("horizontal side-form rows do not share the socket label/control columns");
  if (!cssSource.includes('left: calc(30px * var(--node-scale, 1));') || !cssSource.includes('transform: none;')) throw new Error("horizontal dynamic header is not centered against the full card");
  if (!catalogSource.includes('inlineParameterLabels: { aggregate: "聚合" }') || !catalogSource.includes('inlineParameterLabels: { colorMap: "配色" }')) throw new Error("pivot/heatmap inline controls lost their concise form labels");

  console.log("Node Layout Contract smoke: PASS (content-fit 2D geometry, vertical forms, compact side rails, centered metadata, endpoint-scale spacing)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
