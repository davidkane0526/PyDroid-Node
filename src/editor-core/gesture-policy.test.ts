import { describe, expect, it } from "vitest";
import { gestureTargetForNodeType, inputProfileForPointer, resolveGesturePolicy } from "./gesture-policy";

describe("editor gesture policy", () => {
  it("keeps desktop and mobile interaction definitions independent", () => {
    expect(resolveGesturePolicy("desktop", "node").longPress).toBe("none");
    expect(resolveGesturePolicy("mobile", "node").longPress).toBe("enter-multi-select");
    expect(resolveGesturePolicy("desktop", "canvas").dragThresholdPx).toBeLessThan(resolveGesturePolicy("mobile", "canvas").dragThresholdPx);
  });

  it("keeps node and group gestures intentionally different", () => {
    expect(resolveGesturePolicy("mobile", "node").longPress).toBe("enter-multi-select");
    expect(resolveGesturePolicy("mobile", "group").longPress).toBe("enter-multi-select");
    expect(resolveGesturePolicy("desktop", "node").doubleTap).toBe("open-context-menu");
    expect(resolveGesturePolicy("desktop", "group").doubleTap).toBe("open-group");
    expect(gestureTargetForNodeType("workflow.group")).toBe("group");
    expect(gestureTargetForNodeType("python.print")).toBe("node");
  });

  it("maps coarse/non-mouse pointers to the mobile profile", () => {
    expect(inputProfileForPointer("mouse", false)).toBe("desktop");
    expect(inputProfileForPointer("touch", false)).toBe("mobile");
    expect(inputProfileForPointer("pen", false)).toBe("mobile");
    expect(inputProfileForPointer("mouse", true)).toBe("mobile");
  });
});
