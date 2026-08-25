function execute(params, upstream, context, api) {
  const rows = Math.max(2, Math.trunc(Number(params.rows ?? 6)));
  const profile = String(params.profile ?? "linear");
  const series = String(params.series ?? "value");
  const scale = Number(params.scale ?? 2);
  const power = Math.max(2, Math.trunc(Number(params.power ?? 2)));
  const records = Array.from({ length: rows }, (_, index) => {
    let selected;
    if (profile === "polynomial") selected = Math.pow(index, series === "cube" ? 3 : series === "square" ? 2 : power);
    else selected = index * (series === "double" ? 2 : scale);
    return { index, selected };
  });
  return api.Table.fromRecords(records);
}
