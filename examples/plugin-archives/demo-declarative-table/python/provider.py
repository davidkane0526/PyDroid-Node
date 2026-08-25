def execute(params, upstream, context):
    rows = max(1, int(params.get("rows", 6)))
    scale = float(params.get("scale", 2))
    include_squared = bool(params.get("includeSquared", True))
    values = [index * scale for index in range(rows)]
    data = {"index": list(range(rows)), "value": values}
    if include_squared:
        data["squared"] = [value * value for value in values]
    return pd.DataFrame(data)
