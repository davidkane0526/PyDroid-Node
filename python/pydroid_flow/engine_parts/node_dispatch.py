from __future__ import annotations

from typing import Any

import pandas as pd

from .nodes import HANDLERS


_PARAMETER_SOCKET_EXCLUDED_TYPES = {"custom.python_function"}


def _bind_parameter_socket_inputs(node_type: str, params: dict[str, Any], upstream: Any) -> tuple[dict[str, Any], Any]:
    if node_type in _PARAMETER_SOCKET_EXCLUDED_TYPES or not isinstance(upstream, dict):
        return params, upstream
    merged = dict(params)
    remaining: dict[str, Any] = {}
    bound = 0
    for port, value in upstream.items():
        if port != "input" and port in merged:
            merged[port] = value
            bound += 1
        else:
            remaining[port] = value
    if not bound:
        return params, upstream
    if not remaining:
        return merged, None
    if set(remaining) == {"input"}:
        return merged, remaining["input"]
    return merged, remaining


def _execute_node(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    """Dispatch one node to its domain handler.

    Parameter sockets are generic: a named input port overrides a parameter
    with the same key, while the ordinary ``input`` port remains the node's
    data input.  Structural/function nodes keep their own multi-input binding.
    """
    params, upstream = _bind_parameter_socket_inputs(node_type, params, upstream)
    for supported_types, handler in HANDLERS:
        if node_type in supported_types:
            return handler(node_type, params, upstream, csv_text, input_files, variables)
    raise ValueError(f"Unsupported node type: {node_type}")
