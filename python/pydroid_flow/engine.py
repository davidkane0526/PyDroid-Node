from __future__ import annotations

import importlib.metadata
import json
import sys

from .engine_parts.custom_function import allow_all_custom_imports, analyze_signature_json
from .engine_parts.workflow_execution import execute_workflow

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
