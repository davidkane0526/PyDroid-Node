def execute(params, upstream, context):
    value = float(upstream or 0)
    operand = float(params.get("operand", 0))
    return value + operand if str(params.get("operation", "divide")) == "add" else value / operand
