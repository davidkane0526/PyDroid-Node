function execute(params, upstream) {
  const value = Number(upstream ?? 0);
  const operand = Number(params.operand ?? 0);
  return String(params.operation ?? "divide") === "add" ? value + operand : value / operand;
}
