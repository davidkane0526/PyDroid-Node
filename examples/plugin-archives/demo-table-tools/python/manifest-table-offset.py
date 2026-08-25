def execute(params, upstream, context):
    result = upstream.copy()
    result['value'] = result['value'] + float(params.get('amount', 0))
    return result
