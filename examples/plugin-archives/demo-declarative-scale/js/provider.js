function execute(params, upstream) {
  if (!params.enabled) return Number(upstream ?? 0);
  return Number(upstream ?? 0) * Number(params.factor ?? 1) + Number(params.offset ?? 0);
}
