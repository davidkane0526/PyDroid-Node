import json

def execute(params, upstream, context):
    config = json.loads(context["resources"].text("resources/config.json"))
    return float(upstream or 0) * float(config["factor"])
