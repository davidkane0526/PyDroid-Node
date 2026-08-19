from __future__ import annotations

import base64
from typing import Any

import numpy as np
import pandas as pd

_STATE_TYPE = "__pydroid_state_type__"


def _json_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int, float)):
        if isinstance(value, float) and not np.isfinite(value):
            return None
        return value
    if isinstance(value, np.generic):
        return _json_scalar(value.item())
    if isinstance(value, (pd.Timestamp, pd.Timedelta)):
        return str(value)
    return value


def encode_state_value(value: Any) -> Any:
    if isinstance(value, pd.DataFrame):
        return {
            _STATE_TYPE: "table",
            "columns": [str(column) for column in value.columns],
            "rows": [[encode_state_value(cell) for cell in row] for row in value.itertuples(index=False, name=None)],
        }
    if isinstance(value, bytes):
        return {_STATE_TYPE: "bytes", "base64": base64.b64encode(value).decode("ascii")}
    if isinstance(value, tuple):
        return {_STATE_TYPE: "tuple", "items": [encode_state_value(item) for item in value]}
    if isinstance(value, list):
        return [encode_state_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): encode_state_value(item) for key, item in value.items()}
    scalar = _json_scalar(value)
    if scalar is not value or scalar is None or isinstance(scalar, (str, bool, int, float)):
        return scalar
    raise ValueError(f"Workspace state does not support value type {type(value).__name__}")


def decode_state_value(value: Any) -> Any:
    if isinstance(value, list):
        return [decode_state_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    kind = value.get(_STATE_TYPE)
    if kind == "table":
        columns = value.get("columns", [])
        rows = value.get("rows", [])
        if not isinstance(columns, list) or not isinstance(rows, list):
            raise ValueError("Invalid workspace table state")
        return pd.DataFrame([[decode_state_value(cell) for cell in row] for row in rows], columns=[str(item) for item in columns])
    if kind == "bytes":
        encoded = value.get("base64", "")
        if not isinstance(encoded, str):
            raise ValueError("Invalid workspace bytes state")
        return base64.b64decode(encoded.encode("ascii"))
    if kind == "tuple":
        items = value.get("items", [])
        if not isinstance(items, list):
            raise ValueError("Invalid workspace tuple state")
        return tuple(decode_state_value(item) for item in items)
    return {str(key): decode_state_value(item) for key, item in value.items()}


def decode_workspace_state(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("Workspace state must be an object")
    if len(raw) > 1_000:
        raise ValueError("Workspace state is limited to 1000 variables")
    return {str(name): decode_state_value(value) for name, value in raw.items()}


def encode_workspace_state(state: dict[str, Any]) -> dict[str, Any]:
    if len(state) > 1_000:
        raise ValueError("Workspace state is limited to 1000 variables")
    return {str(name): encode_state_value(value) for name, value in state.items()}
