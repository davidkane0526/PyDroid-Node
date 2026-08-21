from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

NODE_TYPES = {
    "sequence.consecutive_segments",
    "sequence.filter_short_segments",
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


def execute(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], None, None, None]:
    del csv_text, input_files, variables
    values = _sorted_unique_integers(upstream)

    if node_type == "sequence.consecutive_segments":
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
        result: Any = segments
    elif node_type == "sequence.filter_short_segments":
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
