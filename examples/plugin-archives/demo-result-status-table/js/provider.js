function execute(params, upstream, context, api) {
  const rows = Math.max(2, Math.trunc(Number(params.rows ?? 6)));
  const scale = Number(params.scale ?? 2);
  return api.Table.fromRecords(Array.from({ length: rows }, (_, index) => ({ index, value: index * scale })));
}
