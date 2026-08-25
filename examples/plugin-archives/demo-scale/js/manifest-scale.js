function execute(params, upstream, context, api) { return { output: Number(upstream ?? 0) * Number(params.factor ?? 1) }; }
