def execute(params, upstream, context):
    import pandas as pd
    rows = max(2, int(params.get("rows", 6)))
    scale = float(params.get("scale", 2))
    return pd.DataFrame({"index": list(range(rows)), "value": [index * scale for index in range(rows)]})
