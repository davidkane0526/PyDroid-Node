import { describe, expect, it } from "vitest";
import { logicExpression } from "./control";

describe("control expression parity", () => {
  it("matches Python floor division, modulo and exponentiation", () => {
    expect(logicExpression("value // 2", -5, 0)).toBe(-3);
    expect(logicExpression("value % 2", -5, 0)).toBe(1);
    expect(logicExpression("value ** 2", -5, 0)).toBe(25);
    expect(logicExpression("-2 ** 2", 0, 0)).toBe(-4);
    expect(logicExpression("2 ** 3 ** 2", 0, 0)).toBe(512);
  });

  it("short-circuits boolean branches like Python", () => {
    expect(logicExpression("value != 0 and 1 / value > 0.1", 0, 0)).toBe(false);
    expect(logicExpression("value == 0 or 1 / value > 0.1", 0, 0)).toBe(true);
    expect(logicExpression("True or unknown_name", 0, 0)).toBe(true);
  });

  it("still rejects an unsupported name when the branch is evaluated", () => {
    expect(() => logicExpression("False or unknown_name", 0, 0)).toThrow(/Unsupported name/);
  });
});
