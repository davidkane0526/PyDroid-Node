def execute(params, upstream, context):
    value = float(upstream or 0)
    if not params.get("enabled", True):
        return value
    return value * float(params.get("factor", 1)) + float(params.get("offset", 0))
