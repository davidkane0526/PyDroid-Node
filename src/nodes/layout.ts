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
  isPrimitive?: boolean;
  nodeScale: number;
  endpointScale: number;
};

export type NodeCardLayout = {
  direction: NodeLayoutDirection;
  dynamic: boolean;
  sideRailLayout: boolean;
  verticalFormLayout: boolean;
  primitiveLayout: boolean;
  inputPortLabelWidth: number;
  outputPortLabelWidth: number;
  verticalPortLabelWidth: number;
  verticalFormLabelWidth: number;
  socketControlWidth: number;
  inputRailWidth: number;
  outputRailWidth: number;
  sideFormControlOffset: number;
  sideFormTop: number;
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
  if (spec.kind === "color") return 94;
  if (spec.kind === "datetime") return 142;
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
  const primitiveLayout = Boolean(input.isPrimitive);
  const sideRailLayout = !primitiveLayout && dynamic && maxPortCount > 0 && input.requestedDirection === "horizontal";
  const verticalFormLayout = !primitiveLayout && dynamic && maxPortCount > 0 && input.requestedDirection === "vertical";
  const direction: NodeLayoutDirection = input.requestedDirection;

  const longestInput = Math.max(0, ...inputPorts.map((port) => visualTextUnits(port.label ?? "")));
  const longestOutput = Math.max(0, ...outputPorts.map((port) => visualTextUnits(port.label ?? "")));
  const inputPortLabelWidth = Math.min(126, Math.max(46, 16 + longestInput * 5.8));
  const outputPortLabelWidth = Math.min(126, Math.max(46, 16 + longestOutput * 5.8));
  const verticalPortLabelWidth = Math.min(92, Math.max(46, 14 + Math.max(longestInput, longestOutput) * 5.2));
  const inputDefaultControlWidth = Math.max(0, ...inputDefaultSpecs.map(inlineControlPreferredWidth));
  const inlineParameterControlWidth = Math.max(0, ...inlineParameters.map(inlineControlPreferredWidth));
  // Horizontal dynamic cards use one shared form-control column. Socket defaults and
  // inline parameters must never look like two unrelated density systems.
  const socketControlWidth = sideRailLayout
    ? Math.max(inputDefaultSpecs.length || inlineParameters.length ? 96 : 0, inputDefaultControlWidth, inlineParameterControlWidth)
    : inputDefaultControlWidth;
  const inputRailWidth = !primitiveLayout && (inputPorts.length || inlineParameters.length) ? 13 + inputPortLabelWidth + (inputDefaultSpecs.length || inlineParameters.length ? 7 + socketControlWidth : 0) : 0;
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
  // Horizontal dynamic cards are content-driven in both dimensions. The rails already
  // account for every label/control, so the center only needs a small collision-safe gap.
  // Do not reserve a decorative empty center column: it makes form-heavy nodes look hollow.
  const dynamicHeaderWidth = Math.min(286, Math.max(164, 52 + labelUnits * 7.8));
  const dynamicRailGap = 10;
  const dynamicRailWidth = inputRailWidth + outputRailWidth + dynamicRailGap;
  const dynamicHorizontalWidth = Math.min(340, Math.max(dynamicRailWidth, dynamicHeaderWidth, input.isGroup ? 242 : 190));
  const horizontalWidth = sideRailLayout ? dynamicHorizontalWidth : simpleHorizontalWidth;
  const primitiveSpec = inlineParameters[0];
  const primitiveKind = primitiveSpec?.kind ?? "text";
  const primitiveControlWidth = inlineParameters.length ? Math.max(...inlineParameters.map(inlineControlPreferredWidth)) : 72;
  // Primitive cards are micro value sources, not small inspector forms. Their card width
  // follows the real title/control footprint and deliberately omits redundant output-label budget.
  const primitiveWidthFloor = primitiveKind === "datetime" ? 132
    : primitiveKind === "color" ? 98
      : primitiveKind === "text" ? 100
        : 88;
  const primitiveWidthCeiling = primitiveKind === "datetime" ? 142
    : primitiveKind === "color" ? 108
      : primitiveKind === "text" ? 112
        : 98;
  const primitiveWidth = Math.min(primitiveWidthCeiling, Math.max(primitiveWidthFloor, primitiveControlWidth + 8, 44 + labelUnits * 5.4));
  const baseWidth = primitiveLayout ? primitiveWidth : direction === "vertical" ? Math.max(input.isGroup ? 230 : 0, verticalWidth) : horizontalWidth;
  const verticalPortItemWidth = maxPortCount
    ? Math.max(34, Math.min(verticalPortLabelWidth, (baseWidth - 24) / maxPortCount))
    : Math.max(verticalPortLabelWidth, 64);

  const inlineRows = inlineParameters.length ? (input.inlineLayout === "row" ? 1 : inlineParameters.length) : 0;
  const sideInlineRows = sideRailLayout ? inlineParameters.length : 0;
  const socketRows = inputDefaultSpecs.length;
  const basePortRowHeight = dynamic ? 31 : 28;
  const minimumHandleRowHeight = Math.ceil((16 * input.endpointScale + 6) / Math.max(0.01, input.nodeScale));
  const portRowHeight = Math.max(basePortRowHeight, minimumHandleRowHeight);
  const sideHeaderReserve = sideRailLayout ? (input.isGroup ? 50 : 36) : 0;
  const sideRailRows = sideRailLayout ? Math.max(outputPorts.length, inputPorts.length + sideInlineRows) : maxPortCount;
  const railHeight = sideRailRows
    ? sideRailLayout
      ? sideHeaderReserve + sideRailRows * portRowHeight + 8
      : 34 + sideRailRows * portRowHeight
    : 0;
  const simpleTitleWidth = Math.max(86, compactBodyWidth - 18);
  const estimatedTitleWidth = Math.max(0, labelUnits * 8.4);
  const measuredSimpleTitleLines = Math.max(1, Math.min(3, Math.ceil(estimatedTitleWidth / simpleTitleWidth)));
  // Mixed CJK/Latin titles around this length wrap earlier in the real 16 px canvas font
  // than the lightweight width estimate suggests. Reserve the second line intentionally
  // instead of letting type/title/meta collapse vertically at runtime.
  const simpleTitleLines = sideRailLayout ? 1 : Math.max(labelUnits > 10 ? 2 : 1, measuredSimpleTitleLines);
  // Simple horizontal cards use real content height. Their vertical rhythm must account for
  // type/title/meta spacing instead of only stretching the outer shell. Long titles gain a
  // full extra text row, while every simple card keeps enough baseline breathing room.
  const longSimpleTitleExtra = !sideRailLayout && labelUnits > 10 ? 6 : 0;
  const simpleHorizontalContentHeight = 84 + longSimpleTitleExtra + (simpleTitleLines - 1) * 20 + inlineRows * 29;

  // The top-right run control shares the right edge with output handles. For static/simple
  // horizontal cards, reserve enough vertical distance so the first output endpoint can never
  // overlap the 20 px run button, even with endpointScale > 1 or nodeScale < 1. Port positions
  // for these cards are percentage-distributed, so the first output center is H/(count + 1).
  const runButtonBottom = 25; // CSS: top 5 px + 20 px control height
  const runEndpointGap = 6;
  const endpointRadius = 8 * input.endpointScale;
  const simpleOutputClearanceHeight = !sideRailLayout && direction === "horizontal" && outputPorts.length
    ? ((runButtonBottom + runEndpointGap + endpointRadius) * (outputPorts.length + 1)) / Math.max(0.01, input.nodeScale)
    : 0;
  const contentHeight = sideRailLayout ? (input.isGroup ? 94 : 62) : Math.max(simpleHorizontalContentHeight, simpleOutputClearanceHeight);
  const verticalFormRows = socketRows + inlineRows;
  const verticalHeight = verticalFormLayout
    ? 104 + verticalFormRows * 29
    : (inputDefaultSpecs.length ? 122 : 92) + inlineRows * 27;
  const primitiveHeight = direction === "horizontal" ? 56 : 60;
  const baseHeight = primitiveLayout ? primitiveHeight : direction === "horizontal" ? Math.max(contentHeight, railHeight) : verticalHeight;
  const portTop = (index: number, count = maxPortCount) => {
    const safeCount = Math.max(1, count);
    const occupiedHeight = safeCount * portRowHeight;
    const centeredInset = (baseHeight - occupiedHeight) / 2;
    const topInset = sideRailLayout ? Math.max(sideHeaderReserve, centeredInset) : Math.max(17, centeredInset);
    return topInset + portRowHeight * (index + 0.5);
  };
  // Inline parameters are appended after the actual input-port rows. This avoids
  // crowding an inline selector into the first data-port row while keeping the same grid.
  const sideFormTop = sideRailLayout && inlineParameters.length
    ? inputPorts.length === 0
      ? Math.max(sideHeaderReserve, (baseHeight - 23) / 2)
      : Math.max(sideHeaderReserve, (baseHeight - inputPorts.length * portRowHeight) / 2)
        + inputPorts.length * portRowHeight
        + Math.max(0, (portRowHeight - 23) / 2)
    : sideHeaderReserve;
  const verticalPortLeft = (index: number, count: number) => count > 0 ? ((index + 1) * 100) / (count + 1) : 50;

  return {
    direction,
    dynamic,
    sideRailLayout,
    verticalFormLayout,
    primitiveLayout,
    inputPortLabelWidth,
    outputPortLabelWidth,
    verticalPortLabelWidth,
    verticalFormLabelWidth,
    socketControlWidth,
    inputRailWidth,
    outputRailWidth,
    sideFormControlOffset,
    sideFormTop,
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
