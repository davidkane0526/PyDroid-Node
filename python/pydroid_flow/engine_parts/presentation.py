from __future__ import annotations

import base64
import json
import math
from typing import Any

import numpy as np
import pandas as pd

from .values import _as_bool

def _apply_scientific_notation(axis: Any, params: dict[str, Any], *, x: bool = True, y: bool = True) -> None:
    """Use compact scientific labels for numeric linear axes when requested."""
    if not _as_bool(params.get("scientificNotation", True)):
        return
    for axis_name, enabled in (("x", x), ("y", y)):
        if not enabled:
            continue
        try:
            scale = axis.get_xscale() if axis_name == "x" else axis.get_yscale()
            if scale != "linear":
                continue
            axis.ticklabel_format(axis=axis_name, style="sci", scilimits=(-3, 4), useMathText=True)
        except (AttributeError, TypeError, ValueError):
            # Matplotlib raises on categorical axes because they do not use ScalarFormatter.
            continue

def _printable(value: Any, limit: int = 8_000, max_rows: int = 20, mode: str = "pretty", include_type: bool = True, encoding: str = "utf-8", encoding_errors: str = "replace", bytes_format: str = "decode") -> str:
    if mode == "repr": text = repr(value)
    elif mode == "text": text = str(value)
    elif mode == "json":
        if isinstance(value, pd.DataFrame): normalized = value.to_dict(orient="records")
        elif isinstance(value, pd.Series): normalized = value.tolist()
        elif isinstance(value, np.ndarray): normalized = value.tolist()
        else: normalized = value
        text = json.dumps(normalized, ensure_ascii=False, indent=2, default=str)
    elif isinstance(value, pd.DataFrame):
        text = f"DataFrame · {len(value)} 行 × {len(value.columns)} 列\n{value.head(max_rows).to_string(index=False)}" if include_type else value.head(max_rows).to_string(index=False)
    elif isinstance(value, pd.Series):
        text = f"Series · {len(value)} 项\n{value.head(max_rows).to_string(index=False)}" if include_type else value.head(max_rows).to_string(index=False)
    elif isinstance(value, np.ndarray):
        prefix = f"ndarray · shape={value.shape} · dtype={value.dtype}\n" if include_type else ""
        text = prefix + np.array2string(value, threshold=max(20, max_rows * 6))
    elif isinstance(value, (dict, list, tuple, set)):
        normalized = list(value) if isinstance(value, set) else value
        try: text = json.dumps(normalized, ensure_ascii=False, indent=2, default=str)
        except (TypeError, ValueError): text = repr(value)
        if include_type: text = f"{type(value).__name__} · {len(value)} 项\n{text}"
    elif isinstance(value, bytes):
        if bytes_format == "hex": rendered = value.hex(" ")
        elif bytes_format == "base64": rendered = base64.b64encode(value).decode("ascii")
        elif bytes_format == "repr": rendered = repr(value)
        else:
            try: rendered = value.decode(encoding, errors=encoding_errors)
            except (LookupError, UnicodeDecodeError) as exception: raise ValueError(f"无法按 {encoding} 解码字节：{exception}") from exception
        text = f"bytes · {len(value)} 字节 · {bytes_format}/{encoding}\n{rendered}" if include_type else rendered
    elif hasattr(value, "savefig"):
        text = f"Matplotlib Figure · {value!r}" if include_type else repr(value)
    else:
        text = str(value) if isinstance(value, str) else repr(value)
    return text if len(text) <= limit else text[:limit] + f"\n… 已截断，原始长度 {len(text)} 字符"

def _semantic_value(value: Any) -> Any:
    """Return a JSON-safe semantic value for runtime parity and API consumers.

    Human-readable node preview text is intentionally kept separate because its
    formatting may differ between runtimes without changing workflow semantics.
    """
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, pd.DataFrame):
        return [{str(key): _semantic_value(item) for key, item in row.items()} for row in value.to_dict(orient="records")]
    if isinstance(value, pd.Series):
        return [_semantic_value(item) for item in value.tolist()]
    if isinstance(value, dict):
        return {str(key): _semantic_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_semantic_value(item) for item in value]
    if hasattr(value, "item"):
        try:
            return _semantic_value(value.item())
        except (TypeError, ValueError):
            pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except (TypeError, ValueError):
            pass
    return str(value)

def _preview(frame: pd.DataFrame, limit: int = 500) -> dict[str, Any]:
    head = frame.head(limit).copy()
    head = head.replace([float("inf"), float("-inf")], pd.NA)
    clean = head.astype(object).where(pd.notna(head), None)
    def json_value(value: Any) -> Any:
        if value is None or isinstance(value, (str, bool, int)):
            return value
        if isinstance(value, float):
            return value if math.isfinite(value) else None
        if hasattr(value, "item"):
            try:
                return json_value(value.item())
            except (TypeError, ValueError):
                pass
        if hasattr(value, "isoformat"):
            try:
                return value.isoformat()
            except (TypeError, ValueError):
                pass
        return str(value)

    return {
        "columns": [str(column) for column in frame.columns],
        "rows": [[json_value(value) for value in row] for row in clean.values.tolist()],
        "totalRows": len(frame),
        "totalColumns": len(frame.columns),
    }
