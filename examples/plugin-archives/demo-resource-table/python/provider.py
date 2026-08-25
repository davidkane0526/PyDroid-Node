from io import StringIO

def execute(params, upstream, context):
    return pd.read_csv(StringIO(context["resources"].text("resources/data.csv")))
