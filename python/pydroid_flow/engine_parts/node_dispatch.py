from __future__ import annotations

from typing import Any

import pandas as pd

from .nodes import HANDLERS


def _execute_node(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    """Dispatch one node to its domain handler.

    Keep this function deliberately small: node implementations belong under
    ``engine_parts/nodes`` so runtime growth does not recreate the monolithic
    engine.py/node_dispatch.py architecture that Phase 6 is removing.
    """
    for supported_types, handler in HANDLERS:
        if node_type in supported_types:
            return handler(node_type, params, upstream, csv_text, input_files, variables)
    raise ValueError(f"Unsupported node type: {node_type}")
