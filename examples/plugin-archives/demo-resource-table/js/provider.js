function execute(params, upstream, context, api) {
  const lines = api.resources.text("resources/data.csv").trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  const records = lines.slice(1).map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], Number(value)])));
  return api.Table.fromRecords(records);
}
