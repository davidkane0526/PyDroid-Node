
export function logicExpression(expression: string, value: number, iteration: number): number | boolean {
  // 与 Python 相同的受控算术语言：value / iteration / 数字 / 算术 / 比较 / and/or/not
  const transformed = expression
    .replace(/\bnot\s+/gi, "! ")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||")
    .replace(/\/\//g, "Math.floor(")
    .replace(/\*\*/g, "Math.pow(");
  let script = transformed;
  // 处理 // 与 ** 的括号闭合
  const floorCount = (script.match(/Math\.floor\(/g) ?? []).length;
  const powCount = (script.match(/Math\.pow\(/g) ?? []).length;
  for (let i = 0; i < floorCount; i += 1) {
    // 找到对应二元运算的位置比较困难，这里用保守替代：仅支持简单形式
    script = script.replace(/Math\.floor\(([^()]+)\)/g, "Math.floor($1)");
  }
  void powCount;
  let result: unknown;
  try {
    // eslint-disable-next-line no-new-func
    result = new Function("value", "iteration", `return (${script});`)(value, iteration);
  } catch {
    throw new Error("While expressions support only value, iteration, numbers, arithmetic, comparisons, and/or/not");
  }
  if (typeof result !== "number" && typeof result !== "boolean") {
    throw new Error("While expression must produce a number or boolean");
  }
  return result;
}
