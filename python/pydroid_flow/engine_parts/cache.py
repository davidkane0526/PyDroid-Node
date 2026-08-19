from __future__ import annotations

import hashlib
import io
import json
from typing import Any

import pandas as pd

_node_result_cache: dict[str, tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]] = {}
_CACHEABLE_FRAME_LIMIT = 20_000

def _clear_node_result_cache() -> None:
    _node_result_cache.clear()

def _serialize_cache_value(value: Any) -> Any:
    if isinstance(value, pd.DataFrame):
        return {"__dataframe__": value.to_json(date_format="iso", default_handler=str)}
    if isinstance(value, pd.Series):
        return {"__series__": value.to_json(date_format="iso", default_handler=str)}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return {"__opaque__": repr(value)}

def _deserialize_cache_value(value: Any) -> Any:
    if isinstance(value, dict) and "__dataframe__" in value:
        return pd.read_json(io.StringIO(value["__dataframe__"]))
    if isinstance(value, dict) and "__series__" in value:
        return pd.read_json(io.StringIO(value["__series__"]), typ="series")
    if isinstance(value, dict) and "__opaque__" in value:
        return value["__opaque__"]
    return value

def save_node_result_cache(path: str) -> None:
    """Persist the execution cache to a JSON file (best-effort)."""
    try:
        payload = {
            key: {
                "outputs": {name: _serialize_cache_value(item) for name, item in entry[0].items()},
                "table_result": _serialize_cache_value(entry[1]) if entry[1] is not None else None,
                "plot_result": entry[2],
                "export_result": entry[3],
            }
            for key, entry in _node_result_cache.items()
        }
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)
    except (OSError, TypeError, ValueError):
        pass

def load_node_result_cache(path: str) -> None:
    """Restore a previously persisted execution cache (best-effort)."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            return
        for key, raw in payload.items():
            if not isinstance(raw, dict):
                continue
            outputs = {name: _deserialize_cache_value(item) for name, item in (raw.get("outputs") or {}).items()}
            table_result = _deserialize_cache_value(raw["table_result"]) if raw.get("table_result") is not None else None
            _node_result_cache[key] = (outputs, table_result, raw.get("plot_result"), raw.get("export_result"))
    except (OSError, TypeError, ValueError):
        pass

def _value_digest(value: Any) -> str:
    if isinstance(value, pd.DataFrame):
        if len(value) > _CACHEABLE_FRAME_LIMIT:
            # Large frames are never cached; a deliberately unstable digest forces a recompute.
            return f"uncacheable-frame:{value.shape}:{id(value)}"
        payload = value.to_json(date_format="iso", default_handler=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
    if isinstance(value, pd.Series):
        return hashlib.sha256(value.to_json().encode("utf-8")).hexdigest()
    if isinstance(value, dict):
        parts = [f"{key}:{_value_digest(item)}" for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))]
        return hashlib.sha256(("{" + ",".join(parts) + "}").encode("utf-8")).hexdigest()
    if isinstance(value, (list, tuple)):
        parts = [_value_digest(item) for item in value]
        return hashlib.sha256(("[" + ",".join(parts) + "]").encode("utf-8")).hexdigest()
    if isinstance(value, (str, int, float, bool, type(None))):
        return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()
    return hashlib.sha256(repr(value).encode("utf-8")).hexdigest()
