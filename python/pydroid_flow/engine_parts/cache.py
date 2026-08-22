from __future__ import annotations

import hashlib
from typing import Any

import pandas as pd

_node_result_cache: dict[str, tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]] = {}
_CACHEABLE_FRAME_LIMIT = 20_000


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
