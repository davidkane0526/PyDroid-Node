from __future__ import annotations

import ast
import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import pandas as pd

def _decode_json_compatible(text: str, label: str = "JSON") -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError as original:
        # Older imported nodes sometimes contain Python literal dictionaries
        # (single quotes/True/None). Accept those without weakening execution:
        # literal_eval cannot call functions or access names.
        try:
            return ast.literal_eval(text)
        except (SyntaxError, ValueError):
            start = max(0, original.pos - 45); end = min(len(text), original.pos + 45)
            excerpt = text[start:end].replace("\n", " ")
            raise ValueError(f"{label} 格式错误（字符 {original.pos}）：{original.msg}；附近内容：{excerpt!r}") from original

def _require_table(value: Any, operation: str) -> pd.DataFrame:
    if not isinstance(value, pd.DataFrame):
        raise ValueError(f"{operation} requires a table input")
    return value

def _column_reference_items(raw: Any) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return list(raw)
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return [raw]
    text = str(raw).strip()
    if not text:
        return []
    if text.startswith("["):
        parsed = _decode_json_compatible(text, "列引用")
        if not isinstance(parsed, list):
            raise ValueError("Column references must be a JSON array or comma-separated values")
        return parsed
    return [item.strip() for item in text.split(",") if item.strip()]

def _column_index(raw: Any) -> int:
    if isinstance(raw, bool):
        raise ValueError(f"Invalid column index: {raw}")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        if raw.is_integer():
            return int(raw)
        raise ValueError(f"Invalid column index: {raw}")
    text = str(raw).strip()
    try:
        value = float(text)
    except ValueError as exception:
        raise ValueError(f"Invalid column index: {text}") from exception
    if not value.is_integer():
        raise ValueError(f"Invalid column index: {text}")
    return int(value)

def _parse_columns(raw: Any, column_count: int) -> list[int]:
    items = _column_reference_items(raw)
    if not items:
        return list(range(column_count))
    columns = [_column_index(item) for item in items]
    invalid = [column for column in columns if column < 0 or column >= column_count]
    if invalid:
        raise ValueError(f"Column indexes out of range: {invalid}")
    return columns

def _resolve_column(frame: pd.DataFrame, raw: Any) -> Any:
    value = str(raw).strip()
    if value in frame.columns:
        return value
    try:
        index = _column_index(raw)
    except ValueError as exception:
        raise ValueError(f"Unknown column: {value}") from exception
    if index < 0 or index >= len(frame.columns):
        raise ValueError(f"Column index out of range: {index}")
    return frame.columns[index]

def _resolve_columns(frame: pd.DataFrame, raw: Any) -> list[Any]:
    return [_resolve_column(frame, item) for item in _column_reference_items(raw)]

def _rename_columns(frame: pd.DataFrame, raw: Any) -> pd.DataFrame:
    text = str(raw or "").strip()
    if not text:
        raise ValueError("Column names are required")
    if text.startswith("{"):
        mapping = _decode_json_compatible(text, "列名映射")
        if not isinstance(mapping, dict):
            raise ValueError("Column mapping must be a JSON object")
        resolved = {_resolve_column(frame, key): str(value) for key, value in mapping.items()}
        return frame.rename(columns=resolved)
    names = [item.strip() for item in text.split(",")]
    if len(names) != len(frame.columns) or any(not name for name in names):
        raise ValueError(f"Expected {len(frame.columns)} non-empty column names, received {len(names)}")
    renamed = frame.copy()
    renamed.columns = names
    return renamed

def _optional_float(raw: Any) -> float | None:
    if raw is None or str(raw).strip() == "":
        return None
    return float(raw)

def _round_half_away(value: float, ndigits: int = 0) -> float:
    """Round half away from zero (the conventional 四舍五入), unlike Python's
    built-in round which uses banker's rounding (round-half-to-even)."""
    quantum = Decimal(1).scaleb(-ndigits)
    return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))

def _scalar_value(raw: Any) -> Any:
    text = str(raw)
    try:
        return _decode_json_compatible(text, "参数")
    except (ValueError, TypeError):
        return text

def _parameter_list(raw: Any, numeric_when_possible: bool = False) -> list[Any]:
    if raw is None or str(raw).strip() == "":
        return []
    if isinstance(raw, list):
        items = raw
    else:
        text = str(raw).strip()
        if text.startswith("["):
            items = _decode_json_compatible(text, "列表参数")
            if not isinstance(items, list):
                raise ValueError("Expected a JSON array or comma-separated values")
        else:
            items = [item.strip() for item in text.split(",") if item.strip()]
    if numeric_when_possible and items and all(str(item).lstrip("-").isdigit() for item in items):
        return [int(item) for item in items]
    return [str(item) for item in items]

def _as_bool(raw: Any) -> bool:
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)

def _single_value(value: Any) -> Any:
    if isinstance(value, pd.DataFrame):
        if value.shape != (1, 1): raise ValueError("转换为单值要求表格恰好为 1 行 × 1 列")
        return value.iat[0, 0]
    if isinstance(value, pd.Series):
        if len(value) != 1: raise ValueError("转换为单值要求 Series 恰好包含 1 项")
        return value.iloc[0]
    return value
