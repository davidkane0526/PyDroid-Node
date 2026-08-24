from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .values import _resolve_columns


def column_math(table: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    columns = _resolve_columns(table, params.get("columns"))
    if not columns:
        raise ValueError("Column math requires at least one target column")
    operation = str(params.get("operation", "multiply"))
    if operation not in {"add", "subtract", "multiply", "divide", "power", "absolute", "negate"}:
        raise ValueError(f"Unsupported column math operation: {operation}")
    operand = float(params.get("operand", 1))
    if not np.isfinite(operand):
        raise ValueError("Column math operand must be finite")
    if operation == "divide" and operand == 0:
        raise ValueError("Column math cannot divide by zero")

    value = table.copy()
    for column in columns:
        numeric = pd.to_numeric(value[column], errors="raise")
        if operation == "add": value[column] = numeric + operand
        elif operation == "subtract": value[column] = numeric - operand
        elif operation == "multiply": value[column] = numeric * operand
        elif operation == "divide": value[column] = numeric / operand
        elif operation == "power": value[column] = numeric.pow(operand)
        elif operation == "absolute": value[column] = numeric.abs()
        else: value[column] = -numeric
    return value
