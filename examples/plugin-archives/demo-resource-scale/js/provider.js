function execute(params, upstream, context, api) {
  const config = JSON.parse(api.resources.text("resources/config.json"));
  return Number(upstream ?? 0) * Number(config.factor);
}
