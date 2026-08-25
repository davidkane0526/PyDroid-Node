def execute(params, upstream, context):
    value = float(upstream or 0)
    if params.get("mode") == "shift":
        preset = params.get("preset")
        offset = 1 if preset == "plus1" else 5 if preset == "plus5" else float(params.get("offset", 0))
        return value + offset
    preset = params.get("preset")
    factor = 2 if preset == "double" else 3 if preset == "triple" else float(params.get("factor", 1))
    return value * factor
