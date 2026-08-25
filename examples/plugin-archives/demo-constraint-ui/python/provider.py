def execute(params, upstream, context):
    return float(upstream or 0) * float(params.get("gain", 1)) + float(params.get("bias", 0))
