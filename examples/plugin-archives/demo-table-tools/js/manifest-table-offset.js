function execute(params, upstream, context, api) {
  const amount = Number(params.amount ?? 0);
  return upstream.setColumn('value', upstream.column('value').map((value) => Number(value ?? 0) + amount));
}
