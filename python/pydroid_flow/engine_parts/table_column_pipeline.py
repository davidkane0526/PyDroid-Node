from __future__ import annotations

from typing import Any

import pandas as pd

from .table_column_math import column_math, column_transform_spec
from .values import _require_table


def column_transform_output(params: dict[str, Any]) -> dict[str, Any]:
    return column_transform_spec(params)


def conditional_transform_output(upstream: Any, params: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(upstream, dict) or not isinstance(upstream.get("transform"), dict):
        raise ValueError("Conditional transform requires a Transform input")
    return {**upstream["transform"], "enabled": bool(params.get("condition", True))}


def column_pipeline(upstream: Any, params: dict[str, Any]) -> pd.DataFrame:
    if not isinstance(upstream, dict):
        raise ValueError("Column transform Pipeline requires named inputs")
    value = _require_table(upstream.get("input"), "Column transform Pipeline")
    expected = int(params.get("transformCount", 1))
    if expected < 1 or expected > 16:
        raise ValueError("Column transform Pipeline transformCount must be between 1 and 16")
    transforms: list[tuple[int, dict[str, Any]]] = []
    for port, item in upstream.items():
        if not str(port).startswith("transform"):
            continue
        try:
            order = int(str(port)[9:])
        except ValueError as exception:
            raise ValueError(f"Invalid Column transform Pipeline port: {port}") from exception
        if not isinstance(item, dict):
            raise ValueError(f"Column transform Pipeline input {port} must be a Transform object")
        transforms.append((order, item))
    transforms.sort(key=lambda item: item[0])
    if len(transforms) != expected:
        raise ValueError(f"Column transform Pipeline requires {expected} connected Transform inputs")
    for expected_order, (actual_order, transform) in enumerate(transforms, start=1):
        if actual_order != expected_order:
            raise ValueError("Column transform Pipeline inputs must use consecutive Transform ports")
        if transform.get("enabled", True) is False:
            continue
        value = column_math(value, transform)
    return value
