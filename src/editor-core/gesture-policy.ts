export type EditorInputProfile = "desktop" | "mobile";
export type GestureTargetKind = "node" | "group" | "canvas" | "resource" | "tab";
export type GestureAction =
  | "select"
  | "toggle-selection"
  | "open-context-menu"
  | "open-group"
  | "enter-multi-select"
  | "pan-canvas"
  | "marquee-select"
  | "pinch-zoom"
  | "move"
  | "rename"
  | "reorder"
  | "none";

export type GesturePolicy = {
  tap: GestureAction;
  doubleTap: GestureAction;
  longPress: GestureAction;
  contextMenu: GestureAction;
  drag: GestureAction;
  longPressMs: number | null;
  dragThresholdPx: number;
  suppressContextAfterDragMs: number;
};

const DESKTOP: Record<GestureTargetKind, GesturePolicy> = {
  node: {
    tap: "select",
    doubleTap: "open-context-menu",
    longPress: "none",
    contextMenu: "open-context-menu",
    drag: "move",
    longPressMs: null,
    dragThresholdPx: 3,
    suppressContextAfterDragMs: 0,
  },
  group: {
    tap: "select",
    doubleTap: "open-group",
    longPress: "none",
    contextMenu: "open-context-menu",
    drag: "move",
    longPressMs: null,
    dragThresholdPx: 3,
    suppressContextAfterDragMs: 0,
  },
  canvas: {
    tap: "none",
    doubleTap: "none",
    longPress: "none",
    contextMenu: "open-context-menu",
    drag: "pan-canvas",
    longPressMs: null,
    dragThresholdPx: 3,
    suppressContextAfterDragMs: 0,
  },
  resource: {
    tap: "select",
    doubleTap: "none",
    longPress: "none",
    contextMenu: "open-context-menu",
    drag: "move",
    longPressMs: null,
    dragThresholdPx: 4,
    suppressContextAfterDragMs: 0,
  },
  tab: {
    tap: "select",
    doubleTap: "rename",
    longPress: "none",
    contextMenu: "open-context-menu",
    drag: "reorder",
    longPressMs: null,
    dragThresholdPx: 3,
    suppressContextAfterDragMs: 0,
  },
};

const MOBILE: Record<GestureTargetKind, GesturePolicy> = {
  node: {
    tap: "select",
    doubleTap: "open-context-menu",
    longPress: "enter-multi-select",
    contextMenu: "none",
    drag: "move",
    longPressMs: 550,
    dragThresholdPx: 10,
    suppressContextAfterDragMs: 900,
  },
  group: {
    tap: "select",
    doubleTap: "open-group",
    longPress: "enter-multi-select",
    contextMenu: "none",
    drag: "move",
    longPressMs: 520,
    dragThresholdPx: 10,
    suppressContextAfterDragMs: 900,
  },
  canvas: {
    tap: "none",
    doubleTap: "none",
    longPress: "marquee-select",
    contextMenu: "none",
    drag: "pan-canvas",
    longPressMs: 520,
    dragThresholdPx: 10,
    suppressContextAfterDragMs: 0,
  },
  resource: {
    tap: "select",
    doubleTap: "none",
    longPress: "open-context-menu",
    contextMenu: "none",
    drag: "move",
    longPressMs: 710,
    dragThresholdPx: 8,
    suppressContextAfterDragMs: 420,
  },
  tab: {
    tap: "select",
    doubleTap: "none",
    longPress: "open-context-menu",
    contextMenu: "none",
    drag: "reorder",
    longPressMs: 500,
    dragThresholdPx: 9,
    suppressContextAfterDragMs: 0,
  },
};

const PROFILES: Record<EditorInputProfile, Record<GestureTargetKind, GesturePolicy>> = {
  desktop: DESKTOP,
  mobile: MOBILE,
};

export function resolveGesturePolicy(profile: EditorInputProfile, target: GestureTargetKind): GesturePolicy {
  return PROFILES[profile][target];
}

export function gestureTargetForNodeType(nodeType: string): "node" | "group" {
  return nodeType === "workflow.group" ? "group" : "node";
}

export function inputProfileForPointer(pointerType: string, coarsePointer = false): EditorInputProfile {
  return pointerType === "mouse" && !coarsePointer ? "desktop" : "mobile";
}
