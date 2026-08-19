from __future__ import annotations

import builtins
import hashlib
import io
import json
import math
import sys
import time
import traceback
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .cache import _node_result_cache, _value_digest
from .graph import _all_loop_body_ids, _contained_node_ids, _container_children, _edge_value, _loop_body, _ordered_nodes, _upstream_inputs, _upstream_tables, _upstream_value
from .node_dispatch import _execute_node
from .notebook_execution import _execute_notebook_cell
from .presentation import _preview, _printable, _semantic_value
from .values import _decode_json_compatible, _require_table

MAX_WORKFLOW_NODES = 2_000
MAX_WORKFLOW_EDGES = 10_000
MAX_INPUT_FILES = 500
MAX_INPUT_TEXT_CHARS = 64 * 1024 * 1024
MAX_WORKFLOW_JSON_CHARS = 16 * 1024 * 1024
MAX_INPUT_FILES_JSON_CHARS = 96 * 1024 * 1024
_CACHEABLE_NODE_PREFIXES = ("table.", "pandas.", "convert.", "plot.", "analysis.", "pulse.", "python.", "generate.")

def _execute_container_graph(workflow: dict[str, Any], children: list[dict[str, Any]], seed: Any, csv_text: str, input_files: list[dict[str, Any]], variables: dict[str, Any] | None = None) -> Any:
    child_ids = {child["id"] for child in children}
    internal_edges = [edge for edge in workflow.get("edges", []) if edge["source"] in child_ids and edge["target"] in child_ids]
    internal_workflow = {"nodes": children, "edges": internal_edges}
    values: dict[str, dict[str, Any]] = {}
    ordered = _ordered_nodes(internal_workflow)
    for child in ordered:
        data = child.get("data", {})
        child_type = data.get("nodeType")
        if child_type in {"logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"}:
            raise ValueError("Nested visual structures are not supported in this build")
        has_internal_input = any(edge["target"] == child["id"] for edge in internal_edges)
        upstream = _node_upstream(child["id"], child_type, internal_workflow, values) if has_internal_input else seed
        outputs, _, _, _ = _execute_node(child_type, data.get("parameters", {}), upstream, csv_text, input_files, variables)
        values[child["id"]] = outputs
    if not ordered:
        return seed
    sinks = [child for child in ordered if not any(edge["source"] == child["id"] for edge in internal_edges)]
    if len(sinks) > 1:
        raise ValueError("Structure branch must have exactly one output node; found multiple unconnected sinks")
    selected = sinks[0] if sinks else ordered[-1]
    outputs = values[selected["id"]]
    return outputs.get("output", next(iter(outputs.values()), seed))

def _execute_visual_structure(node: dict[str, Any], workflow: dict[str, Any], upstream: Any, csv_text: str, input_files: list[dict[str, Any]], variables: dict[str, Any] | None = None) -> dict[str, Any]:
    node_type = node.get("data", {}).get("nodeType")
    params = node.get("data", {}).get("parameters", {})
    table = _require_table(upstream, "Structure input")
    if node_type == "logic.if_subflow":
        condition = str(params.get("condition", "")).strip()
        if not condition: raise ValueError("If structure requires a condition")
        working = table.reset_index(drop=True)
        matching = working.query(condition)
        true_seed = matching.reset_index(drop=True)
        false_seed = working.loc[~working.index.isin(matching.index)].reset_index(drop=True)
        return {
            "true": _execute_container_graph(workflow, _container_children(workflow, node["id"], "true"), true_seed, csv_text, input_files, variables),
            "false": _execute_container_graph(workflow, _container_children(workflow, node["id"], "false"), false_seed, csv_text, input_files, variables),
        }
    body = _container_children(workflow, node["id"], "body")
    maximum = int(params.get("maxIterations", 100))
    if node_type == "logic.for_each_subflow":
        if len(table) > maximum: raise ValueError(f"For structure exceeds maxIterations={maximum}")
        rows = [_execute_container_graph(workflow, body, table.iloc[[index]].copy().reset_index(drop=True), csv_text, input_files, variables) for index in range(len(table))]
        if any(not isinstance(item, pd.DataFrame) for item in rows):
            raise ValueError("For structure body must return a table for every row")
        done = pd.concat(rows, ignore_index=True) if rows else table.iloc[0:0].copy()
        return {"done": done, "output": done}
    condition = str(params.get("condition", "")).strip()
    current = table.copy()
    for _ in range(maximum):
        if current.query(condition).empty: return {"done": current.reset_index(drop=True), "output": current.reset_index(drop=True)}
        current = _require_table(_execute_container_graph(workflow, body, current, csv_text, input_files, variables), "While structure body")
    raise ValueError(f"While structure reached maxIterations={maximum}")

def _node_upstream(node_id: str, node_type: str, workflow: dict[str, Any], values: dict[str, dict[str, Any]]) -> Any:
    if node_type in {"table.concat", "logic.merge_rows"}:
        return _upstream_tables(node_id, workflow, values)
    if node_type in {"pulse.combine_channels", "pulse.segment_measurement"}:
        return _upstream_inputs(node_id, workflow, values)
    if node_type in {"custom.python_function", "ui.alert"}:
        return _upstream_inputs(node_id, workflow, values)
    return _upstream_value(node_id, workflow, values)

def _execute_loop_subflow(
    loop_node: dict[str, Any], workflow: dict[str, Any], values: dict[str, dict[str, Any]],
    csv_text: str, input_files: list[dict[str, Any]], variables: dict[str, Any] | None = None,
) -> pd.DataFrame:
    loop_id = loop_node["id"]
    data = loop_node.get("data", {})
    node_type = data.get("nodeType")
    params = data.get("parameters", {})
    entry_edges = [
        edge for edge in workflow.get("edges", [])
        if edge["target"] == loop_id and edge.get("targetHandle") in {None, "input"}
    ]
    if len(entry_edges) != 1:
        raise ValueError("Loop subflow requires exactly one initial input connection")
    initial = _require_table(_edge_value(entry_edges[0], values), "Loop initial input")
    body_nodes, back_edge = _loop_body(workflow, loop_id)
    maximum = int(params.get("maxIterations", 100))
    if maximum < 1 or maximum > 100_000:
        raise ValueError("Loop maxIterations must be between 1 and 100000")

    def execute_body(seed: pd.DataFrame) -> pd.DataFrame:
        local_values = dict(values)
        local_values[loop_id] = {"body": seed, "done": seed, "output": seed}
        for body_node in body_nodes:
            body_id = body_node["id"]
            body_data = body_node.get("data", {})
            body_type = body_data.get("nodeType")
            if body_type in {"logic.for_each_subflow", "logic.while_subflow"}:
                raise ValueError("Nested loop subflows are not supported yet")
            upstream = _node_upstream(body_id, body_type, workflow, local_values)
            outputs, _, _, _ = _execute_node(body_type, body_data.get("parameters", {}), upstream, csv_text, input_files, variables)
            local_values[body_id] = outputs
        return _require_table(_edge_value(back_edge, local_values), "Loop continue output")

    if node_type == "logic.for_each_subflow":
        if len(initial) > maximum:
            raise ValueError(f"For subflow has {len(initial)} rows, exceeding maxIterations={maximum}")
        results = [execute_body(initial.iloc[[index]].copy().reset_index(drop=True)) for index in range(len(initial))]
        return pd.concat(results, ignore_index=True) if results else initial.iloc[0:0].copy()

    condition = str(params.get("condition", "")).strip()
    if not condition:
        raise ValueError("While subflow requires a pandas query condition")
    current = initial.copy()
    for _ in range(maximum):
        if current.query(condition).empty:
            return current.reset_index(drop=True)
        current = execute_body(current)
    if not current.query(condition).empty:
        raise ValueError(f"While subflow reached maxIterations={maximum}")
    return current.reset_index(drop=True)

def _error_response(
    message: str,
    node_id: str = "__workflow__",
    node_type: str = "workflow",
    *,
    node_results: dict[str, dict[str, Any]] | None = None,
    node_timings_ms: dict[str, float] | None = None,
    execution_order: list[str] | None = None,
    preview: dict[str, Any] | None = None,
    debug_traceback: str | None = None,
) -> str:
    return json.dumps({
        "status": "error", "nodeId": node_id, "nodeType": node_type, "message": message,
        "nodeResults": node_results or {}, "nodeTimingsMs": node_timings_ms or {},
        "executionOrder": execution_order or [], "preview": preview,
        "debugTraceback": debug_traceback,
    }, ensure_ascii=False)

def _flatten_workflow_groups(workflow: dict[str, Any]) -> dict[str, Any]:
    """Resolve persisted visual-group ports before executing the shared workflow."""
    nodes = workflow.get("nodes", [])
    groups = {
        node["id"]: node for node in nodes
        if isinstance(node, dict) and node.get("data", {}).get("nodeType") == "workflow.group"
    }
    flat_edges = [dict(edge) for edge in workflow.get("edges", [])]
    for _ in range(len(groups) + 1):
        changed = False
        next_edges: list[dict[str, Any]] = []
        for edge in flat_edges:
            target_group = groups.get(edge.get("target"))
            if target_group is not None:
                port = next((item for item in target_group.get("data", {}).get("groupInputs", []) if isinstance(item, dict) and item.get("id") == edge.get("targetHandle")), None)
                if port is None:
                    raise ValueError(f"Group {target_group['id']} has no input port {edge.get('targetHandle')!r}")
                rewritten = dict(edge)
                rewritten["target"] = port.get("internalNodeId")
                rewritten["targetHandle"] = port.get("internalHandle") or None
                next_edges.append(rewritten)
                changed = True
                continue
            source_group = groups.get(edge.get("source"))
            if source_group is not None:
                port = next((item for item in source_group.get("data", {}).get("groupOutputs", []) if isinstance(item, dict) and item.get("id") == edge.get("sourceHandle")), None)
                if port is None:
                    raise ValueError(f"Group {source_group['id']} has no output port {edge.get('sourceHandle')!r}")
                rewritten = dict(edge)
                rewritten["source"] = port.get("internalNodeId")
                rewritten["sourceHandle"] = port.get("internalHandle") or None
                next_edges.append(rewritten)
                changed = True
                continue
            next_edges.append(edge)
        flat_edges = next_edges
        if not changed:
            break
    else:
        raise ValueError("Workflow groups are nested too deeply or contain a port cycle")
    flat_nodes: list[dict[str, Any]] = []
    for node in nodes:
        if node.get("data", {}).get("nodeType") == "workflow.group":
            continue
        data = dict(node.get("data", {}))
        data.pop("canvasParentId", None)
        flat_node = dict(node)
        flat_node["data"] = data
        flat_nodes.append(flat_node)
    return {**workflow, "nodes": flat_nodes, "edges": flat_edges}

def _android_execution_cancelled(execution_id: str) -> bool:
    if not execution_id:
        return False
    try:
        from com.dk.pydroidflow import PythonExecutionCancellation  # type: ignore[import-not-found]
        return bool(PythonExecutionCancellation.isCancelled(execution_id))
    except Exception:
        return False

def _raise_if_execution_cancelled(execution_id: str) -> None:
    if _android_execution_cancelled(execution_id):
        raise KeyboardInterrupt("PyDroid workflow execution cancelled")

def _run_with_cancel_trace(execution_id: str, callback):
    if not execution_id:
        return callback()
    try:
        from com.dk.pydroidflow import PythonExecutionCancellation  # type: ignore[import-not-found]
    except Exception:
        return callback()
    previous = sys.gettrace()
    counter = 0
    def trace(frame, event, arg):
        nonlocal counter
        counter += 1
        if counter % 32 == 0 and PythonExecutionCancellation.isCancelled(execution_id):
            raise KeyboardInterrupt("PyDroid workflow execution cancelled")
        return trace
    sys.settrace(trace)
    try:
        return callback()
    finally:
        sys.settrace(previous)

def execute_workflow(workflow_json: str, csv_text: str, input_files_json: str = "[]", execution_id: str = "") -> str:
    if not isinstance(workflow_json, str) or len(workflow_json) > MAX_WORKFLOW_JSON_CHARS:
        raise ValueError("Workflow document is missing or exceeds the 16 MiB safety limit")
    if not isinstance(csv_text, str) or len(csv_text) > MAX_INPUT_TEXT_CHARS:
        raise ValueError("CSV input exceeds the 64 MiB safety limit")
    if not isinstance(input_files_json, str) or len(input_files_json) > MAX_INPUT_FILES_JSON_CHARS:
        raise ValueError("Multi-file input document exceeds the 96 MiB safety limit")
    try:
        workflow = _decode_json_compatible(workflow_json, "工作流 JSON")
        input_files = _decode_json_compatible(input_files_json, "输入文件 JSON")
    except ValueError as exception:
        return _error_response(str(exception))
    if not isinstance(workflow, dict):
        raise ValueError("Workflow must be a JSON object")
    nodes = workflow.get("nodes")
    edges = workflow.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ValueError("Workflow nodes and edges must be JSON arrays")
    if len(nodes) > MAX_WORKFLOW_NODES or len(edges) > MAX_WORKFLOW_EDGES:
        raise ValueError(f"Workflow exceeds the safety limit of {MAX_WORKFLOW_NODES} nodes or {MAX_WORKFLOW_EDGES} edges")
    if not isinstance(input_files, list):
        raise ValueError("inputFiles must be a JSON array")
    if len(input_files) > MAX_INPUT_FILES:
        raise ValueError(f"Multi-file input exceeds the safety limit of {MAX_INPUT_FILES} files")
    total_input_chars = 0
    for index, item in enumerate(input_files):
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("text", ""), str) or ("base64" in item and not isinstance(item.get("base64"), str)):
            raise ValueError(f"Input file {index + 1} must contain a name and readable content")
        total_input_chars += len(item.get("text", "")) + len(item.get("base64", ""))
        if total_input_chars > MAX_INPUT_TEXT_CHARS:
            raise ValueError("Combined multi-file input exceeds the 64 MiB safety limit")
    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
            raise ValueError(f"Workflow node {index + 1} has an invalid ID")
        data = node.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("nodeType"), str) or not isinstance(data.get("parameters", {}), dict):
            raise ValueError(f"Workflow node {node['id']} has invalid data or parameters")
    if any(not isinstance(edge, dict) for edge in edges):
        raise ValueError("Every workflow edge must be a JSON object")
    workflow = _flatten_workflow_groups(workflow)
    nodes = workflow["nodes"]
    edges = workflow["edges"]
    ordered_nodes = _ordered_nodes(workflow)
    values: dict[str, dict[str, Any]] = {}
    latest_table: pd.DataFrame | None = None
    latest_value: Any = None
    plot_png: str | None = None
    export_csv: str | None = None
    exports: list[dict[str, str]] = []
    node_results: dict[str, dict[str, Any]] = {}
    node_timings_ms: dict[str, float] = {}
    execution_order: list[str] = []
    loop_body_ids = _all_loop_body_ids(workflow) | _contained_node_ids(workflow)
    notebook_inputs = [io.StringIO(item.get("text", "")) for item in input_files] or ([io.StringIO(csv_text)] if csv_text else [])
    notebook_namespace: dict[str, Any] = {"__builtins__": builtins.__dict__, "pd": pd, "np": np, "plt": plt, "math": math, "csv_text": csv_text, "input_files": notebook_inputs}
    variables: dict[str, Any] = {}

    for node in ordered_nodes:
        _raise_if_execution_cancelled(execution_id)
        node_id = node["id"]
        if node_id in loop_body_ids:
            continue
        data = node.get("data", {})
        node_type = data.get("nodeType")
        params = data.get("parameters", {})
        node_started = time.perf_counter()
        try:
            if isinstance(params.get("notebookSource"), str):
                outputs, table_result, plot_result, export_result = _run_with_cancel_trace(execution_id, lambda: _execute_notebook_cell(str(params["notebookSource"]), notebook_namespace))
            elif node_type == "notebook.code_cell":
                outputs, table_result, plot_result, export_result = _run_with_cancel_trace(execution_id, lambda: _execute_notebook_cell(str(params.get("source", "")), notebook_namespace))
            elif node_type == "notebook.markdown_cell":
                text = str(params.get("source", ""))
                outputs, table_result, plot_result, export_result = {"next": text, "output": text}, None, None, None
            elif node_type in {"logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"}:
                if node_type == "logic.if_subflow" or any(child.get("parentId") == node_id for child in workflow.get("nodes", [])):
                    upstream = _node_upstream(node_id, node_type, workflow, values)
                    outputs = _execute_visual_structure(node, workflow, upstream, csv_text, input_files, variables)
                    table_result = next((value for value in outputs.values() if isinstance(value, pd.DataFrame)), None)
                    plot_result, export_result = None, None
                else:
                    table_result = _execute_loop_subflow(node, workflow, values, csv_text, input_files, variables)
                    outputs, plot_result, export_result = {"done": table_result, "output": table_result}, None, None
            else:
                upstream = _node_upstream(node_id, node_type, workflow, values)
                if node_type.startswith(_CACHEABLE_NODE_PREFIXES):
                    upstream_digest = _value_digest(upstream)
                    cache_key = hashlib.sha256(
                        json.dumps([node_id, node_type, params, upstream_digest], ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
                    ).hexdigest()
                    cached = _node_result_cache.get(cache_key)
                    if cached is not None:
                        outputs, table_result, plot_result, export_result = cached
                    else:
                        outputs, table_result, plot_result, export_result = _execute_node(node_type, params, upstream, csv_text, input_files, variables)
                        if len(_node_result_cache) >= 10_000:
                            _node_result_cache.clear()
                        _node_result_cache[cache_key] = (outputs, table_result, plot_result, export_result)
                else:
                    outputs, table_result, plot_result, export_result = _execute_node(
                        node_type, params, upstream, csv_text, input_files, variables
                    )
        except Exception as exception:
            node_timings_ms[node_id] = round((time.perf_counter() - node_started) * 1000, 3)
            return _error_response(
                str(exception), node_id, str(node_type), node_results=node_results,
                node_timings_ms=node_timings_ms, execution_order=execution_order,
                preview=_preview(latest_table) if latest_table is not None else None,
                debug_traceback=traceback.format_exc(),
            )

        node_timings_ms[node_id] = round((time.perf_counter() - node_started) * 1000, 3)
        execution_order.append(node_id)

        if table_result is not None:
            latest_table = table_result
        if plot_result is not None:
            plot_png = plot_result
        if export_result is not None:
            export_csv = export_result
            exports.append({
                "nodeId": node_id,
                "fileName": str(params.get("fileName", "result.csv")) or "result.csv",
                "content": export_result,
            })

        values[node_id] = outputs
        latest_value = outputs.get("output", next(iter(outputs.values()), latest_value))
        # Print and alert nodes are transparent for dataflow, but their captured
        # text must win over a table preview so every print stays visible.
        if "__print__" in outputs:
            node_results[node_id] = {"kind": "value", "text": str(outputs["__print__"]), "value": _semantic_value(outputs.get("output", outputs["__print__"]))}
        elif plot_result is not None:
            node_results[node_id] = {"kind": "plot", "plotPngBase64": plot_result}
        elif table_result is not None:
            node_results[node_id] = {"kind": "table", "preview": _preview(table_result, limit=200)}
        elif export_result is not None:
            node_results[node_id] = {"kind": "value", "text": f"CSV · {len(export_result)} characters", "value": export_result}
        else:
            display = outputs.get("output", next(iter(outputs.values()), None))
            if display is not None:
                node_results[node_id] = {"kind": "value", "text": _printable(display, 4_000), "value": _semantic_value(display)}

    if latest_table is None:
        latest_table = pd.DataFrame({"result": [_printable(latest_value)]})

    return json.dumps(
        {
            "status": "success",
            "preview": _preview(latest_table),
            "plotPngBase64": plot_png,
            "exportCsv": export_csv,
            "exports": exports,
            "nodeResults": node_results,
            "nodeTimingsMs": node_timings_ms,
            "executionOrder": execution_order,
        },
        ensure_ascii=False,
        allow_nan=False,
    )
