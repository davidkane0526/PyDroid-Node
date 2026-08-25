function execute(params, upstream) {
  const value = Number(upstream ?? 0);
  if (params.mode === "shift") {
    const offset = params.preset === "plus1" ? 1 : params.preset === "plus5" ? 5 : Number(params.offset ?? 0);
    return value + offset;
  }
  const factor = params.preset === "double" ? 2 : params.preset === "triple" ? 3 : Number(params.factor ?? 1);
  return value * factor;
}
