from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .values import _resolve_columns


_BINARY = {"add", "subtract", "multiply", "divide", "power"}
_UNARY = {"absolute", "negate", "sqrt", "square", "log10", "ln", "exp", "reciprocal", "normalize", "zscore"}


def _finite(raw: Any, label: str) -> float:
    value = float(raw)
    if not np.isfinite(value):
        raise ValueError(f"Column math {label} must be finite")
    return value


def column_transform_spec(params: dict[str, Any]) -> dict[str, Any]:
    columns = params.get("columns")
    if columns is None or (isinstance(columns, str) and not columns.strip()):
        raise ValueError("Column transform requires at least one target column")
    operation = str(params.get("operation", "multiply"))
    if operation not in _BINARY | _UNARY | {"clip"}:
        raise ValueError(f"Unsupported column math operation: {operation}")
    result: dict[str, Any] = {"columns": columns, "operation": operation}
    if operation in _BINARY | {"clip"}:
        result["operand"] = _finite(params.get("operand", 1), "operand")
    if operation == "clip":
        result["operand2"] = _finite(params.get("operand2", 1), "second operand")
        if result["operand"] > result["operand2"]:
            raise ValueError("Column math clip minimum cannot exceed maximum")
    if operation == "divide" and result["operand"] == 0:
        raise ValueError("Column math cannot divide by zero")
    return result


def column_math(table: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    transform = column_transform_spec(params)
    columns = _resolve_columns(table, transform.get("columns"))
    if not columns:
        raise ValueError("Column math requires at least one target column")
    operation = str(transform["operation"])
    operand = float(transform.get("operand", 0.0))
    operand2 = float(transform.get("operand2", 0.0))
    value = table.copy()
    for column in columns:
        numeric = pd.to_numeric(value[column], errors="raise")
        if operation == "add": value[column] = numeric + operand
        elif operation == "subtract": value[column] = numeric - operand
        elif operation == "multiply": value[column] = numeric * operand
        elif operation == "divide": value[column] = numeric / operand
        elif operation == "power": value[column] = numeric.pow(operand)
        elif operation == "absolute": value[column] = numeric.abs()
        elif operation == "negate": value[column] = -numeric
        elif operation == "sqrt":
            if (numeric.dropna() < 0).any(): raise ValueError(f"Column math sqrt requires non-negative values in {column}")
            value[column] = np.sqrt(numeric)
        elif operation == "square": value[column] = numeric.pow(2)
        elif operation == "log10":
            if (numeric.dropna() <= 0).any(): raise ValueError(f"Column math log10 requires positive values in {column}")
            value[column] = np.log10(numeric)
        elif operation == "ln":
            if (numeric.dropna() <= 0).any(): raise ValueError(f"Column math ln requires positive values in {column}")
            value[column] = np.log(numeric)
        elif operation == "exp":
            result = np.exp(numeric)
            if not np.isfinite(result.dropna().to_numpy()).all(): raise ValueError(f"Column math exp overflow in {column}")
            value[column] = result
        elif operation == "reciprocal":
            if (numeric.dropna() == 0).any(): raise ValueError(f"Column math reciprocal cannot divide by zero in {column}")
            value[column] = 1 / numeric
        elif operation == "clip": value[column] = numeric.clip(lower=operand, upper=operand2)
        elif operation == "normalize":
            minimum, maximum = numeric.min(), numeric.max()
            if maximum == minimum: raise ValueError(f"Column math cannot normalize constant column {column}")
            value[column] = (numeric - minimum) / (maximum - minimum)
        else:
            mean = numeric.mean()
            std = numeric.std(ddof=0)
            if std == 0: raise ValueError(f"Column math cannot standardize constant column {column}")
            value[column] = (numeric - mean) / std
    return value
