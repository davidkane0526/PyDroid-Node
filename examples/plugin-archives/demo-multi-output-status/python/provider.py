def execute(params, upstream, context):
    import pandas as pd
    rows = max(1, int(params.get("rows", 5)))
    scale = float(params.get("scale", 2))
    label = str(params.get("label", "sample"))
    table = pd.DataFrame({"index": list(range(rows)), "value": [index * scale for index in range(rows)]})
    return {"outputs": {"table": table, "count": rows, "label": label}, "tableResult": table}
