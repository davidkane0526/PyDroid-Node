function execute(params, upstream, context, api) {
  const rows = Math.max(1, Math.trunc(Number(params.rows ?? 5)));
  const scale = Number(params.scale ?? 2);
  const label = String(params.label ?? "sample");
  const table = api.Table.fromRecords(Array.from({ length: rows }, (_, index) => ({ index, value: index * scale })));
  return { outputs: { table, count: rows, label }, tableResult: table, plotResult: null, exportResult: null };
}
