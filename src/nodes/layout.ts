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
  verticalFormLayout: boolean;
  inputPortLabelWidth: number;
  outputPortLabelWidth: number;
  verticalPortLabelWidth: number;
  verticalFormLabelWidth: number;
  socketControlWidth: number;
  inputRailWidth: number;
  outputRailWidth: number;
  sideFormControlOffset: number;
  nodeCenterShift: number;
  verticalPortItemWidth: number;
  nodeWidth: number;
  nodeMinHeight: number;
  inlineToolbarWidth: number;
  portRowHeight: number;
  portTop: (index: number, count?: number) => number;
  verticalPortLeft: (index: number, count: number) => number;
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
  const sideRailLayout = dynamic && maxPortCount > 0 && input.requestedDirection === "horizontal";
  const verticalFormLayout = dynamic && maxPortCount > 0 && input.requestedDirection === "vertical";
  const direction: NodeLayoutDirection = input.requestedDirection;

  const longestInput = Math.max(0, ...inputPorts.map((port) => visualTextUnits(port.label ?? "")));
  const longestOutput = Math.max(0, ...outputPorts.map((port) => visualTextUnits(port.label ?? "")));
  const inputPortLabelWidth = Math.min(126, Math.max(46, 16 + longestInput * 5.8));
  const outputPortLabelWidth = Math.min(126, Math.max(46, 16 + longestOutput * 5.8));
  const verticalPortLabelWidth = Math.min(92, Math.max(46, 14 + Math.max(longestInput, longestOutput) * 5.2));
  const socketControlWidth = Math.max(0, ...inputDefaultSpecs.map(inlineControlPreferredWidth));
  const inputRailWidth = inputPorts.length ? 13 + inputPortLabelWidth + (inputDefaultSpecs.length ? 7 + socketControlWidth : 0) : 0;
  const outputRailWidth = outputPorts.length ? 13 + outputPortLabelWidth : 0;
  const sideFormControlOffset = inputDefaultSpecs.length ? (11 + inputPortLabelWidth + 7) - inputRailWidth : 0;
  const nodeCenterShift = (outputRailWidth - inputRailWidth) / 2;

  const inlineToolbarWidth = inlineParameters.length
    ? input.inlineLayout === "row"
      ? Math.min(230, inlineParameters.reduce((sum, parameter) => sum + inlineControlPreferredWidth(parameter), 0) + Math.max(0, inlineParameters.length - 1) * 5)
      : Math.min(176, Math.max(...inlineParameters.map((parameter) => inlineControlPreferredWidth(parameter) + 48)))
    : 0;

  const longestFormLabel = Math.max(0, ...inputDefaultSpecs.map((parameter) => visualTextUnits(parameter.label ?? "")), ...inlineParameters.map((parameter) => visualTextUnits(parameter.label ?? "")));
  const verticalFormLabelWidth = Math.min(104, Math.max(58, 18 + longestFormLabel * 5.4));
  const verticalFormControlWidth = Math.max(104, socketControlWidth, inlineParameters.length ? Math.max(...inlineParameters.map(inlineControlPreferredWidth)) : 0);

  const labelUnits = visualTextUnits(input.label);
  const contentWidth = direction === "vertical"
    ? Math.min(276, Math.max(164, 92 + labelUnits * 8.6, inlineToolbarWidth + 24))
    : Math.min(248, Math.max(132, 62 + labelUnits * 7.4, inlineToolbarWidth + 14));

  const verticalFormPreferredWidth = verticalFormLayout
    ? Math.max(236, verticalFormLabelWidth + verticalFormControlWidth + 42)
    : 0;
  const verticalPortStripWidth = maxPortCount
    ? Math.min(352, 28 + maxPortCount * Math.min(78, Math.max(52, verticalPortLabelWidth)))
    : 0;
  const verticalWidth = Math.min(360, Math.max(contentWidth, verticalFormPreferredWidth, verticalPortStripWidth));
  const sharedSimplePortInset = Math.max(inputPortLabelWidth, outputPortLabelWidth) + 10;
  const compactInputInset = inputPorts.length ? sharedSimplePortInset : 0;
  const compactOutputInset = outputPorts.length ? sharedSimplePortInset : 0;
  const compactBodyWidth = Math.min(196, Math.max(112, 48 + labelUnits * 6.8));
  const simpleHorizontalWidth = Math.min(320, Math.max(compactBodyWidth + compactInputInset + compactOutputInset, input.isGroup ? 224 : 210));
  // Side-rail cards do not need a second full-width center column for the title.
  // The header spans the whole card; width is therefore driven by the two rails plus a modest breathing gap,
  // with the title only acting as a minimum-width floor.
  const dynamicHeaderWidth = Math.min(310, Math.max(176, 58 + labelUnits * 8.2));
  const dynamicRailWidth = inputRailWidth + outputRailWidth + 82;
  const dynamicHorizontalWidth = Math.min(430, Math.max(dynamicRailWidth, dynamicHeaderWidth, input.isGroup ? 230 : 208));
  const horizontalWidth = sideRailLayout ? dynamicHorizontalWidth : simpleHorizontalWidth;
  const baseWidth = direction === "vertical" ? Math.max(input.isGroup ? 230 : 0, verticalWidth) : horizontalWidth;
  const verticalPortItemWidth = maxPortCount
    ? Math.max(34, Math.min(verticalPortLabelWidth, (baseWidth - 24) / maxPortCount))
    : Math.max(verticalPortLabelWidth, 64);

  const inlineRows = inlineParameters.length ? (input.inlineLayout === "row" ? 1 : inlineParameters.length) : 0;
  const sideInlineRows = sideRailLayout ? inlineParameters.length : 0;
  const socketRows = inputDefaultSpecs.length;
  const basePortRowHeight = inputDefaultSpecs.length ? 34 : dynamic ? 30 : 28;
  const minimumHandleRowHeight = Math.ceil((16 * input.endpointScale + 6) / Math.max(0.01, input.nodeScale));
  const portRowHeight = Math.max(basePortRowHeight, minimumHandleRowHeight);
  const sideHeaderReserve = sideRailLayout ? 40 : 0;
  const sideInlineReserve = sideInlineRows ? sideInlineRows * 28 + 5 : 0;
  const sidePortStart = sideHeaderReserve + sideInlineReserve;
  const railHeight = maxPortCount
    ? sideRailLayout
      ? sidePortStart + maxPortCount * portRowHeight + 10
      : 34 + maxPortCount * portRowHeight
    : 0;
  const contentHeight = 62 + (sideRailLayout ? 0 : inlineRows * 27);
  const verticalFormRows = socketRows + inlineRows;
  const verticalHeight = verticalFormLayout
    ? 104 + verticalFormRows * 29
    : (inputDefaultSpecs.length ? 122 : 92) + inlineRows * 27;
  const baseHeight = direction === "horizontal" ? Math.max(contentHeight, railHeight) : verticalHeight;
  const portTop = (index: number, count = maxPortCount) => {
    const safeCount = Math.max(1, count);
    const occupiedHeight = safeCount * portRowHeight;
    const centeredInset = (baseHeight - occupiedHeight) / 2;
    const topInset = sideRailLayout ? Math.max(sidePortStart, centeredInset) : Math.max(17, centeredInset);
    return topInset + portRowHeight * (index + 0.5);
  };
  const verticalPortLeft = (index: number, count: number) => count > 0 ? ((index + 1) * 100) / (count + 1) : 50;

  return {
    direction,
    dynamic,
    sideRailLayout,
    verticalFormLayout,
    inputPortLabelWidth,
    outputPortLabelWidth,
    verticalPortLabelWidth,
    verticalFormLabelWidth,
    socketControlWidth,
    inputRailWidth,
    outputRailWidth,
    sideFormControlOffset,
    nodeCenterShift,
    verticalPortItemWidth,
    nodeWidth: baseWidth * input.nodeScale,
    nodeMinHeight: baseHeight * input.nodeScale,
    inlineToolbarWidth,
    portRowHeight,
    portTop,
    verticalPortLeft,
  };
}
