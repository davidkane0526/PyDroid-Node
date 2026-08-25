def execute(params, upstream, context):
    return {'output': float(upstream or 0) * float(params.get('factor', 1))}
