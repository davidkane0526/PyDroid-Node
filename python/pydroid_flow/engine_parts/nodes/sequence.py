from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from ..analysis_nodes import _logic_expression

NODE_TYPES = {
    "sequence.consecutive_segments",
    "sequence.filter_short_segments",
    "sequence.map_expression",
    "sequence.reduce",
    "sequence.accumulate",
}


def _sequence(value: Any) -> list[Any]:
    if isinstance(value, pd.Series):
        return value.tolist()
    if isinstance(value, np.ndarray):
        return value.reshape(-1).tolist()
    if isinstance(value, (list, tuple, set, frozenset)):
        return list(value)
    raise ValueError("Sequence node requires a list-like input")


def _sorted_unique_integers(value: Any) -> list[int]:
    items = _sequence(value)
    result: list[int] = []
    for item in items:
        if isinstance(item, bool):
            raise ValueError("Sequence node requires integer values")
        number = int(item)
        if number != item:
            raise ValueError("Sequence node requires integer values")
        result.append(number)
    return sorted(set(result))


def _numeric_sequence(value: Any) -> list[float]:
    items = _sequence(value)
    result: list[float] = []
    for item in items:
        if isinstance(item, bool) or not isinstance(item, (int, float, np.integer, np.floating)):
            raise ValueError("Sequence numeric node requires number values")
        number = float(item)
        if not np.isfinite(number):
            raise ValueError("Sequence numeric node requires finite values")
        result.append(number)
    return result


def execute(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], None, None, None]:
    del csv_text, input_files, variables

    if node_type == "sequence.map_expression":
        values = _numeric_sequence(upstream)
        expression = str(params.get("expression", "value")).strip() or "value"
        result: Any = [_logic_expression(expression, value, index) for index, value in enumerate(values)]
    elif node_type == "sequence.reduce":
        values = _numeric_sequence(upstream)
        method = str(params.get("method", "sum"))
        if method == "count":
            result = len(values)
        elif not values:
            raise ValueError(f"Reduce method {method} requires at least one value")
        elif method == "sum":
            result = float(sum(values))
        elif method == "mean":
            result = float(sum(values) / len(values))
        elif method == "min":
            result = float(min(values))
        elif method == "max":
            result = float(max(values))
        elif method == "product":
            product = 1.0
            for value in values:
                product *= value
            result = float(product)
        else:
            raise ValueError(f"Unsupported reduce method: {method}")
    elif node_type == "sequence.accumulate":
        values = _numeric_sequence(upstream)
        method = str(params.get("method", "sum"))
        result = []
        current: float | None = None
        for value in values:
            if current is None:
                current = value
            elif method == "sum":
                current += value
            elif method == "product":
                current *= value
            elif method == "min":
                current = min(current, value)
            elif method == "max":
                current = max(current, value)
            else:
                raise ValueError(f"Unsupported accumulate method: {method}")
            result.append(float(current))
    elif node_type == "sequence.consecutive_segments":
        values = _sorted_unique_integers(upstream)
        segments: list[tuple[int, int, int]] = []
        if values:
            start = end = values[0]
            for value in values[1:]:
                if value == end + 1:
                    end = value
                else:
                    segments.append((start, end, end - start + 1))
                    start = end = value
            segments.append((start, end, end - start + 1))
        result = segments
    elif node_type == "sequence.filter_short_segments":
        values = _sorted_unique_integers(upstream)
        minimum = int(params.get("minLength", 3))
        if minimum < 1:
            raise ValueError("Minimum segment length must be >= 1")
        result = []
        if values:
            start = end = values[0]
            for value in values[1:]:
                if value == end + 1:
                    end = value
                else:
                    if end - start + 1 >= minimum:
                        result.extend(range(start, end + 1))
                    start = end = value
            if end - start + 1 >= minimum:
                result.extend(range(start, end + 1))
    else:
        raise ValueError(f"Unsupported sequence node type: {node_type}")

    return {"output": result}, None, None, None
