def execute(params, upstream, context):
    count = max(1, int(params.get('count', 6)))
    start = float(params.get('start', 1))
    step = float(params.get('step', 2))
    return pd.DataFrame({'index': list(range(count)), 'value': [start + i * step for i in range(count)]})
