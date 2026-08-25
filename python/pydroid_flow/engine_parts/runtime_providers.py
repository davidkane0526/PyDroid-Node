from __future__ import annotations

import base64
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pandas as pd


PythonRuntimeProvider = Callable[[dict[str, Any], Any, dict[str, Any]], Any]


class PythonRuntimeResources:
    def __init__(self, items: list[dict[str, Any]] | None = None) -> None:
        self._items = {str(item.get("path", "")): item for item in (items or [])}

    def list(self) -> list[str]:
        return list(self._items.keys())

    def bytes(self, path: str) -> bytes:
        item = self._items.get(path)
        if item is None:
            raise ValueError(f"Plugin resource not found: {path}")
        return base64.b64decode(str(item.get("base64", "")))

    def text(self, path: str) -> str:
        return self.bytes(path).decode("utf-8")

    def data_url(self, path: str) -> str:
        item = self._items.get(path)
        if item is None:
            raise ValueError(f"Plugin resource not found: {path}")
        mime_type = str(item.get("mimeType", "application/octet-stream"))
        return f"data:{mime_type};base64,{item.get('base64', '')}"


@dataclass(frozen=True)
class LoadedPythonRuntimeProvider:
    execute: PythonRuntimeProvider
    resources: PythonRuntimeResources


def load_python_runtime_providers(workflow: dict[str, Any]) -> dict[str, LoadedPythonRuntimeProvider]:
    container = workflow.get("runtimeProviders")
    items = container.get("python", []) if isinstance(container, dict) else []
    if not isinstance(items, list):
        raise ValueError("runtimeProviders.python must be an array")
    providers: dict[str, LoadedPythonRuntimeProvider] = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Python Runtime Provider descriptor must be an object")
        node_type = str(item.get("nodeType", "")).strip()
        source = str(item.get("source", "")).strip()
        entrypoint = str(item.get("entrypoint", "execute")).strip() or "execute"
        if not node_type or not source:
            raise ValueError("Python Runtime Provider requires nodeType and source")
        if node_type in providers:
            raise ValueError(f"Duplicate Python Runtime Provider: {node_type}")
        namespace: dict[str, Any] = {"pd": pd}
        exec(compile(source, f"<runtime-provider:{node_type}>", "exec"), namespace, namespace)
        provider = namespace.get(entrypoint)
        if not callable(provider):
            raise ValueError(f"Python Runtime Provider entrypoint is not callable: {node_type}.{entrypoint}")
        resources = item.get("resources", [])
        if not isinstance(resources, list):
            raise ValueError(f"Python Runtime Provider resources must be an array: {node_type}")
        providers[node_type] = LoadedPythonRuntimeProvider(provider, PythonRuntimeResources(resources))
    return providers


def execute_python_runtime_provider(
    provider: LoadedPythonRuntimeProvider,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    result = provider.execute(
        params,
        upstream,
        {
            "csvText": csv_text,
            "inputFiles": input_files,
            "variables": variables or {},
            "resources": provider.resources,
        },
    )
    if isinstance(result, pd.DataFrame):
        return {"output": result}, result, None, None
    if isinstance(result, dict) and "outputs" in result:
        outputs = result.get("outputs")
        if not isinstance(outputs, dict):
            raise ValueError("Python Runtime Provider outputs must be an object")
        table_result = result.get("tableResult")
        if table_result is not None and not isinstance(table_result, pd.DataFrame):
            raise ValueError("Python Runtime Provider tableResult must be a DataFrame")
        plot_result = result.get("plotResult")
        export_result = result.get("exportResult")
        return outputs, table_result, plot_result, export_result
    if isinstance(result, dict):
        table_result = next((value for value in result.values() if isinstance(value, pd.DataFrame)), None)
        return result, table_result, None, None
    return {"output": result}, None, None, None
