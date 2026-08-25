import type { ParameterSpec, PortSpec } from "../nodeCatalog";

export type NodeLayoutDirection = "horizontal" | "vertical";

export type NodeCardLayoutInput = {
  requestedDirection: NodeLayoutDirection;
  label: string;
  inputPorts: PortSpec[];
  outputPorts: PortSpec[];
  inputDefaultSpecs: ParameterSpec[];
  inlineParameters: ParameterSpec[];
  inlineLayout: "stack" | "row";
  hasVariants: boolean;
  hasInputPortGroups: boolean;
  hasDynamicPorts: boolean;
  isGroup: boolean;
  nodeScale: number;
  endpointScale: number;
};

export type NodeCardLayout = {
  direction: NodeLayoutDirection;
  dynamic: boolean;
  sideRailLayout: boolean;
  inputPortLabelWidth: number;
  outputPortLabelWidth: number;
  verticalPortLabelWidth: number;
  socketControlWidth: number;
  inputRailWidth: number;
  outputRailWidth: number;
  verticalPortItemWidth: number;
  nodeWidth: number;
  nodeMinHeight: number;
  inlineToolbarWidth: number;
  portRowHeight: number;
  portTop: (index: number) => number;
};

export function visualTextUnits(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1.65 : 1), 0);
}

export function inlineControlPreferredWidth(spec: ParameterSpec): number {
  if (spec.kind === "boolean") return 72;
  if (spec.kind === "number") return 80;
  if (spec.kind === "select") {
    const longest = Math.max(0, ...(spec.options ?? []).map((option) => visualTextUnits(String(option.label))));
    return Math.min(126, Math.max(76, 30 + longest * 6));
  }
  return 106;
}

export function resolveNodeCardLayout(input: NodeCardLayoutInput): NodeCardLayout {
  const { inputPorts, outputPorts, inputDefaultSpecs, inlineParameters } = input;
  const dynamic = inputDefaultSpecs.length > 0 || inlineParameters.length > 0 || input.hasVariants || input.hasInputPortGroups || input.hasDynamicPorts;
  const maxPortCount = Math.max(inputPorts.length, outputPorts.length);
  const sideRailLayout = dynamic && maxPortCount > 0;
  const direction: NodeLayoutDirection = sideRailLayout ? "horizontal" : input.requestedDirection;

  const longestInput = Math.max(0, ...inputPorts.map((port) => visualTextUnits(port.label ?? "")));
  const longestOutput = Math.max(0, ...outputPorts.map((port) => visualTextUnits(port.label ?? "")));
  const inputPortLabelWidth = Math.min(126, Math.max(46, 16 + longestInput * 5.8));
  const outputPortLabelWidth = Math.min(126, Math.max(46, 16 + longestOutput * 5.8));
  const verticalPortLabelWidth = Math.min(118, Math.max(64, 20 + Math.max(longestInput, longestOutput) * 5.6));
  const socketControlWidth = Math.max(0, ...inputDefaultSpecs.map(inlineControlPreferredWidth));
  const inputRailWidth = inputPorts.length ? 13 + inputPortLabelWidth + (inputDefaultSpecs.length ? 7 + socketControlWidth : 0) : 0;
  const outputRailWidth = outputPorts.length ? 13 + outputPortLabelWidth : 0;

  const inlineToolbarWidth = inlineParameters.length
    ? input.inlineLayout === "row"
      ? Math.min(230, inlineParameters.reduce((sum, parameter) => sum + inlineControlPreferredWidth(parameter), 0) + Math.max(0, inlineParameters.length - 1) * 5)
      : Math.min(176, Math.max(...inlineParameters.map((parameter) => inlineControlPreferredWidth(parameter) + 48)))
    : 0;

  const labelUnits = visualTextUnits(input.label);
  const contentWidth = direction === "vertical"
    ? Math.min(286, Math.max(150, 88 + labelUnits * 9.2, inlineToolbarWidth + 18))
    : Math.min(272, Math.max(146, 82 + labelUnits * 8.8, inlineToolbarWidth + 18));
  const verticalPortItemWidth = Math.max(verticalPortLabelWidth, socketControlWidth || 0, 78);
  const portDrivenWidth = direction === "vertical"
    ? Math.max(contentWidth, maxPortCount ? 24 + maxPortCount * (verticalPortItemWidth + 10) : contentWidth)
    : Math.max(contentWidth + inputRailWidth + outputRailWidth + 16, 184);
  const widthCap = direction === "vertical" ? 720 : 520;
  const baseWidth = Math.min(widthCap, Math.max(input.isGroup ? 230 : 0, portDrivenWidth));

  const inlineRows = inlineParameters.length ? (input.inlineLayout === "row" ? 1 : inlineParameters.length) : 0;
  const basePortRowHeight = inputDefaultSpecs.length ? 34 : dynamic ? 30 : 28;
  const minimumHandleRowHeight = Math.ceil((16 * input.endpointScale + 6) / Math.max(0.01, input.nodeScale));
  const portRowHeight = Math.max(basePortRowHeight, minimumHandleRowHeight);
  const railHeight = maxPortCount ? 34 + maxPortCount * portRowHeight : 0;
  const contentHeight = 62 + inlineRows * 27;
  const verticalHeight = (inputDefaultSpecs.length ? 122 : 92) + inlineRows * 27;
  const baseHeight = direction === "horizontal" ? Math.max(contentHeight, railHeight) : verticalHeight;
  const portTop = (index: number) => 26 + portRowHeight * (index + 0.5);

  return {
    direction,
    dynamic,
    sideRailLayout,
    inputPortLabelWidth,
    outputPortLabelWidth,
    verticalPortLabelWidth,
    socketControlWidth,
    inputRailWidth,
    outputRailWidth,
    verticalPortItemWidth,
    nodeWidth: baseWidth * input.nodeScale,
    nodeMinHeight: baseHeight * input.nodeScale,
    inlineToolbarWidth,
    portRowHeight,
    portTop,
  };
}
