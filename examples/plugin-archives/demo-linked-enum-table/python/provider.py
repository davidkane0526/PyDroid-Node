def execute(params, upstream, context):
    import pandas as pd
    rows = max(2, int(params.get("rows", 6)))
    profile = str(params.get("profile", "linear"))
    series = str(params.get("series", "value"))
    scale = float(params.get("scale", 2))
    power = max(2, int(params.get("power", 2)))
    values = []
    for index in range(rows):
        if profile == "polynomial":
            exponent = 3 if series == "cube" else 2 if series == "square" else power
            values.append(index ** exponent)
        else:
            values.append(index * (2 if series == "double" else scale))
    return pd.DataFrame({"index": list(range(rows)), "selected": values})
