function execute(params, upstream) {
  return Number(upstream ?? 0) * Number(params.gain ?? 1) + Number(params.bias ?? 0);
}
