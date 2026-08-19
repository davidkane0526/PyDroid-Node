from __future__ import annotations

import ast
import base64
import io
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

def _execute_notebook_cell(source: str, namespace: dict[str, Any]) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    tree = ast.parse(source, mode="exec")
    last_expression = tree.body.pop().value if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    stream = io.StringIO()
    before_figures = set(plt.get_fignums())
    with redirect_stdout(stream), redirect_stderr(stream):
        exec(compile(tree, "<notebook-cell>", "exec"), namespace, namespace)
        value = eval(compile(ast.Expression(last_expression), "<notebook-cell>", "eval"), namespace, namespace) if last_expression is not None else None
    table = value if isinstance(value, pd.DataFrame) else next((namespace[name] for name in reversed(list(namespace)) if isinstance(namespace[name], pd.DataFrame)), None)
    figure = value if isinstance(value, plt.Figure) else None
    if figure is None:
        new_figures = [number for number in plt.get_fignums() if number not in before_figures]
        if new_figures: figure = plt.figure(new_figures[-1])
    plot = None
    if figure is not None:
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", dpi=120, bbox_inches="tight")
        plot = base64.b64encode(buffer.getvalue()).decode("ascii")
    for number in [item for item in plt.get_fignums() if item not in before_figures]:
        plt.close(number)
    text = stream.getvalue().strip()
    if value is not None and not isinstance(value, (pd.DataFrame, plt.Figure)):
        text = f"{text}\n{repr(value)}".strip()
    output = table if table is not None else value if value is not None else text
    return {"next": output, "output": output}, table, plot, None
