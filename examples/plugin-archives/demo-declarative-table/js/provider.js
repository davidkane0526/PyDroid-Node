function execute(params, upstream, context, api) {
  const rows = Math.max(1, Math.trunc(Number(params.rows ?? 6)));
  const scale = Number(params.scale ?? 2);
  const includeSquared = Boolean(params.includeSquared);
  return api.Table.fromRecords(Array.from({ length: rows }, (_, index) => {
    const value = index * scale;
    return includeSquared ? { index, value, squared: value * value } : { index, value };
  }));
}
