from __future__ import annotations

import importlib.metadata
import json
import sys

from .engine_parts import custom_function as _custom_function_parts
from .engine_parts.analysis_nodes import _group_aggregate, _logic_expression
from .engine_parts.cache import _clear_node_result_cache, _node_result_cache, load_node_result_cache, save_node_result_cache
from .engine_parts.custom_function import analyze_signature_json
from .engine_parts.node_dispatch import _execute_node
from .engine_parts.pulse_nodes import _pulse_combine_channels, _pulse_segment_measurement
from .engine_parts.values import _round_half_away
from .engine_parts.workflow_execution import _run_with_cancel_trace, execute_workflow

# Compatibility facade: desktop_bridge and older integrations import public helpers
# from pydroid_flow.engine. Implementation lives in engine_parts after Phase 6.
_CUSTOM_ALLOW_ALL_IMPORTS = False

def allow_all_custom_imports() -> None:
    global _CUSTOM_ALLOW_ALL_IMPORTS
    _CUSTOM_ALLOW_ALL_IMPORTS = True
    _custom_function_parts.allow_all_custom_imports()

def _import_root_allowed(root: str) -> bool:
    _custom_function_parts._CUSTOM_ALLOW_ALL_IMPORTS = _CUSTOM_ALLOW_ALL_IMPORTS
    return _custom_function_parts._import_root_allowed(root)

def environment_info_json() -> str:
    packages: dict[str, str] = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if name:
            packages[name.lower()] = distribution.version
    return json.dumps(
        {
            "pythonVersion": ".".join(str(item) for item in sys.version_info[:3]),
            "packages": [{"name": name, "version": version} for name, version in sorted(packages.items())],
        },
        ensure_ascii=False,
    )
