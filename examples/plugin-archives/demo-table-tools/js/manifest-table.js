function execute(params, upstream, context, api) {
  const count = Math.max(1, Math.trunc(Number(params.count ?? 6)));
  const start = Number(params.start ?? 1);
  const step = Number(params.step ?? 2);
  return api.Table.fromRecords(Array.from({ length: count }, (_, index) => ({ index, value: start + index * step })));
}
