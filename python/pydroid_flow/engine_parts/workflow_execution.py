from __future__ import annotations

import ast
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
from .graph import _contained_node_ids, _container_children, _data_edges, _edge_value, _ordered_nodes, _upstream_inputs, _upstream_tables, _upstream_value
from .node_dispatch import _execute_node
from .notebook_execution import _execute_notebook_cell
from .presentation import _preview, _printable, _semantic_value
from .state import decode_workspace_state, encode_workspace_state
from .values import _decode_json_compatible, _require_table

MAX_WORKFLOW_NODES = 2_000
MAX_WORKFLOW_EDGES = 10_000
MAX_INPUT_FILES = 500
MAX_INPUT_TEXT_CHARS = 64 * 1024 * 1024
MAX_WORKFLOW_JSON_CHARS = 16 * 1024 * 1024
MAX_INPUT_FILES_JSON_CHARS = 96 * 1024 * 1024
_CACHEABLE_NODE_PREFIXES = ("table.", "pandas.", "convert.", "plot.", "analysis.", "pulse.", "python.", "generate.")
_VISUAL_STRUCTURE_TYPES = {"logic.if_value", "logic.for_each_value", "logic.while_state"}


def _generic_truthy(value: Any) -> bool:
    """Cross-runtime truthiness used by generic control-flow nodes."""
    if value is None:
        return False
    if isinstance(value, pd.DataFrame):
        return not value.empty
    if isinstance(value, (pd.Series, np.ndarray, list, tuple, set, frozenset, dict, str, bytes)):
        return len(value) > 0
    if isinstance(value, (bool, int, float, np.integer, np.floating)):
        return bool(value)
    return True


def _generic_not_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, pd.DataFrame):
        return len(value.index) > 0
    if isinstance(value, (pd.Series, np.ndarray, list, tuple, set, frozenset, dict, str, bytes)):
        return len(value) > 0
    return _generic_truthy(value)


def _generic_iterable_items(value: Any) -> list[Any]:
    if isinstance(value, pd.DataFrame):
        return [value.iloc[[index]].copy().reset_index(drop=True) for index in range(len(value))]
    if isinstance(value, (pd.Series, pd.Index)):
        return value.tolist()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, dict):
        return list(value.keys())
    if isinstance(value, (list, tuple, set, frozenset, range, str)):
        return list(value)
    raise ValueError("For Each structure requires a list, tuple, table, text, range, set, or object input")


def _new_notebook_namespace(csv_text: str, input_files: list[dict[str, Any]]) -> dict[str, Any]:
    notebook_inputs = [io.StringIO(item.get("text", "")) for item in input_files] or ([io.StringIO(csv_text)] if csv_text else [])
    return {"__builtins__": builtins.__dict__, "pd": pd, "np": np, "plt": plt, "math": math, "csv_text": csv_text, "input_files": notebook_inputs}


def _initialize_notebook_context(workflow: dict[str, Any], namespace: dict[str, Any]) -> None:
    """Execute hoisted Notebook setup in original source order.

    Context entries are deliberately restricted by the compiler to the leading
    setup region.  Imports and safe function definitions are executed exactly as
    Python source; workflow parameters are assigned from their original literal
    expression so tuple/list/string semantics are preserved.
    """
    environment = workflow.get("environment") if isinstance(workflow.get("environment"), dict) else {}
    steps: list[tuple[int, int, int, str, str]] = []
    for item in environment.get("pythonImports", []) if isinstance(environment.get("pythonImports"), list) else []:
        if isinstance(item, dict) and isinstance(item.get("source"), str):
            steps.append((int(item.get("cellIndex", 0)), int(item.get("operationIndex", 0)), 0, "source", item["source"]))
    for item in workflow.get("parameters", []) if isinstance(workflow.get("parameters"), list) else []:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            expression = item.get("expression")
            if not isinstance(expression, str) or not expression.strip():
                expression = repr(_decode_json_compatible(item.get("value")))
            steps.append((int(item.get("cellIndex", 0)), int(item.get("operationIndex", 0)), 1, "source", f"{item['name']} = {expression}"))
    for item in environment.get("pythonDefinitions", []) if isinstance(environment.get("pythonDefinitions"), list) else []:
        if isinstance(item, dict) and isinstance(item.get("source"), str):
            steps.append((int(item.get("cellIndex", 0)), int(item.get("operationIndex", 0)), 2, "source", item["source"]))
    for _cell, _operation, _kind, _mode, source in sorted(steps):
        _execute_notebook_cell(source, namespace)

def _execute_container_graph(
    workflow: dict[str, Any], children: list[dict[str, Any]], seed: Any, csv_text: str,
    input_files: list[dict[str, Any]], variables: dict[str, Any] | None = None,
    root_workflow: dict[str, Any] | None = None, call_stack: tuple[str, ...] = (),
    notebook_namespace: dict[str, Any] | None = None,
) -> Any:
    child_ids = {child["id"] for child in children}
    internal_edges = [edge for edge in _data_edges(workflow) if edge["source"] in child_ids and edge["target"] in child_ids]
    internal_workflow = {"nodes": children, "edges": internal_edges}
    values: dict[str, dict[str, Any]] = {}
    ordered = _ordered_nodes(internal_workflow)
    notebook_namespace = notebook_namespace or _new_notebook_namespace(csv_text, input_files)
    for child in ordered:
        data = child.get("data", {})
        child_type = data.get("nodeType")
        params = _bind_notebook_parameters(data.get("parameters", {}), notebook_namespace)
        has_internal_input = any(edge["target"] == child["id"] for edge in internal_edges)
        base_upstream = _node_upstream(child["id"], child_type, internal_workflow, values) if has_internal_input else seed
        # Notebook-lowered children may consume a named variable unrelated to the
        # structure seed.  When there is no real internal edge, explicit compiler
        # bindings are authoritative; otherwise the current item/state remains the seed.
        if not has_internal_input and _notebook_binding_map(params, "notebookInputBindingsJson"):
            base_upstream = None
        upstream = _bind_notebook_inputs(child_type, params, base_upstream, notebook_namespace)
        if child_type in _VISUAL_STRUCTURE_TYPES:
            outputs = _execute_visual_structure(child, workflow, upstream, csv_text, input_files, variables, root_workflow, call_stack, notebook_namespace, params)
        elif child_type == "notebook.code_cell":
            outputs, _, _, _ = _execute_notebook_cell(str(params.get("source", "")), notebook_namespace)
        elif child_type == "notebook.markdown_cell":
            text = str(params.get("source", ""))
            outputs = {"next": text, "output": text}
        elif child_type == "function.call":
            outputs, _, _, _ = _execute_function_call(child, upstream, root_workflow or workflow, csv_text, input_files, variables, call_stack, notebook_namespace)
        elif child_type == "function.map":
            outputs, _, _, _ = _execute_function_map(child, upstream, root_workflow or workflow, csv_text, input_files, variables, call_stack, notebook_namespace)
        else:
            outputs, _, _, _ = _execute_node(child_type, params, upstream, csv_text, input_files, variables)
        _sync_notebook_outputs(params, outputs, notebook_namespace)
        values[child["id"]] = outputs
    if not ordered:
        return seed
    sinks = [child for child in ordered if not any(edge["source"] == child["id"] for edge in internal_edges)]
    if len(sinks) > 1:
        raise ValueError("Structure branch must have exactly one output node; found multiple unconnected sinks")
    selected = sinks[0] if sinks else ordered[-1]
    outputs = values[selected["id"]]
    return outputs.get("output", next(iter(outputs.values()), seed))

def _execute_visual_structure(
    node: dict[str, Any], workflow: dict[str, Any], upstream: Any, csv_text: str,
    input_files: list[dict[str, Any]], variables: dict[str, Any] | None = None,
    root_workflow: dict[str, Any] | None = None, call_stack: tuple[str, ...] = (),
    notebook_namespace: dict[str, Any] | None = None, params_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    node_type = node.get("data", {}).get("nodeType")
    params = params_override if params_override is not None else node.get("data", {}).get("parameters", {})
    notebook_namespace = notebook_namespace or _new_notebook_namespace(csv_text, input_files)

    if node_type == "logic.if_value":
        inputs = upstream if isinstance(upstream, dict) else {"condition": upstream}
        condition = inputs.get("condition")
        seed = inputs.get("input", condition)
        selected = _generic_truthy(condition)
        if bool(params.get("invert", False)):
            selected = not selected
        branch = "true" if selected else "false"
        result = _execute_container_graph(workflow, _container_children(workflow, node["id"], branch), seed, csv_text, input_files, variables, root_workflow, call_stack, notebook_namespace)
        return {"true": result if branch == "true" else None, "false": result if branch == "false" else None, "done": result, "output": result}

    if node_type == "logic.for_each_value":
        items = _generic_iterable_items(upstream)
        maximum = int(params.get("maxIterations", 10000))
        if maximum < 1 or maximum > 100_000:
            raise ValueError("For Each maxIterations must be between 1 and 100000")
        if len(items) > maximum:
            raise ValueError(f"For Each structure has {len(items)} items, exceeding maxIterations={maximum}")
        body = _container_children(workflow, node["id"], "body")
        results: list[Any] = []
        item_variable = str(params.get("itemVariable", "")).strip()
        index_variable = str(params.get("indexVariable", "")).strip()
        for iteration, item in enumerate(items):
            if item_variable:
                notebook_namespace[item_variable] = item
            if index_variable:
                notebook_namespace[index_variable] = iteration
            results.append(_execute_container_graph(workflow, body, item, csv_text, input_files, variables, root_workflow, call_stack, notebook_namespace))
        done: Any = results
        last = results[-1] if results else None
        last_item = items[-1] if items else None
        return {"done": done, "last": last, "lastItem": last_item, "output": done}

    if node_type == "logic.while_state":
        current = upstream
        maximum = int(params.get("maxIterations", 100))
        if maximum < 1 or maximum > 10_000:
            raise ValueError("While State maxIterations must be between 1 and 10000")
        mode = str(params.get("conditionMode", "expression"))
        condition = str(params.get("condition", "value < 10")).strip()
        body = _container_children(workflow, node["id"], "body")
        state_variable = str(params.get("stateVariable", "")).strip()
        index_variable = str(params.get("indexVariable", "")).strip()
        iterations = 0
        for iteration in range(maximum):
            if mode == "truthy":
                keep_going = _generic_truthy(current)
            elif mode == "notEmpty":
                keep_going = _generic_not_empty(current)
            elif mode == "expression":
                if isinstance(current, (int, float, np.integer, np.floating)) and not isinstance(current, bool) and np.isfinite(float(current)):
                    scalar = float(current)
                else:
                    raise ValueError("While State expression mode requires a finite numeric state")
                keep_going = bool(_logic_expression(condition, scalar, iteration))
            else:
                raise ValueError(f"Unsupported While State conditionMode: {mode}")
            if not keep_going:
                return {"done": current, "iterations": iterations, "output": current}
            if state_variable:
                notebook_namespace[state_variable] = current
            if index_variable:
                notebook_namespace[index_variable] = iteration
            current = _execute_container_graph(workflow, body, current, csv_text, input_files, variables, root_workflow, call_stack, notebook_namespace)
            iterations += 1
        # Re-evaluate once at the safety boundary so a loop that naturally stops
        # exactly after the final body execution succeeds instead of reporting a false limit error.
        if mode == "truthy":
            still_running = _generic_truthy(current)
        elif mode == "notEmpty":
            still_running = _generic_not_empty(current)
        else:
            scalar = float(current) if isinstance(current, (int, float, np.integer, np.floating)) and not isinstance(current, bool) and np.isfinite(float(current)) else None
            still_running = scalar is not None and bool(_logic_expression(condition, scalar, maximum))
        if still_running:
            raise ValueError(f"While State reached maxIterations={maximum}")
        return {"done": current, "iterations": iterations, "output": current}

    raise ValueError(f"Unsupported visual structure: {node_type}")

def _node_upstream(node_id: str, node_type: str, workflow: dict[str, Any], values: dict[str, dict[str, Any]]) -> Any:
    if node_type in {"table.concat", "table.merge_rows"}:
        return _upstream_tables(node_id, workflow, values)
    if node_type in {"table.concat_many", "pulse.combine_channels", "pulse.segment_measurement"}:
        return _upstream_inputs(node_id, workflow, values)
    if node_type in {"custom.python_function", "ui.alert", "function.call", "function.map", "logic.if_value", "logic.compare", "logic.switch", "math.operation", "logic.boolean_math"}:
        return _upstream_inputs(node_id, workflow, values)
    incoming = [edge for edge in _data_edges(workflow) if edge.get("target") == node_id]
    if any((edge.get("targetHandle") or "input") != "input" for edge in incoming):
        return _upstream_inputs(node_id, workflow, values)
    return _upstream_value(node_id, workflow, values)


def _notebook_binding_map(params: dict[str, Any], key: str) -> dict[str, str]:
    raw = params.get(key)
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(port): str(name) for port, name in parsed.items() if str(port) and str(name)}


def _bind_notebook_inputs(node_type: str, params: dict[str, Any], upstream: Any, namespace: dict[str, Any]) -> Any:
    """Bridge variables produced by code carriers into native workflow nodes.

    Analyzed notebooks deliberately avoid fake data edges across a code/native
    boundary: ``notebook.code_cell.next`` is a generic display value and may not
    be the exact Python variable consumed later.  The compiler records explicit
    port->variable bindings instead; this helper resolves them from the shared
    notebook namespace at execution time.
    """
    bindings = _notebook_binding_map(params, "notebookInputBindingsJson")
    resolved = {port: namespace[name] for port, name in bindings.items() if name in namespace}
    raw_literals = params.get("notebookLiteralInputsJson")
    if isinstance(raw_literals, str) and raw_literals.strip():
        try:
            parsed_literals = json.loads(raw_literals)
            if isinstance(parsed_literals, dict):
                for port, value in parsed_literals.items():
                    resolved.setdefault(str(port), value)
        except (TypeError, ValueError):
            pass
    raw_expressions = params.get("notebookExpressionInputsJson")
    if isinstance(raw_expressions, str) and raw_expressions.strip():
        try:
            parsed_expressions = json.loads(raw_expressions)
            if isinstance(parsed_expressions, dict):
                for port, expression in parsed_expressions.items():
                    if isinstance(expression, str) and expression.strip():
                        resolved.setdefault(str(port), eval(compile(ast.parse(expression, mode="eval"), "<notebook-input>", "eval"), namespace, namespace))
        except (SyntaxError, TypeError, ValueError, NameError, AttributeError, KeyError, IndexError):
            pass
    if not resolved:
        return upstream
    if node_type in _FUNCTION_MULTI_INPUT_TYPES:
        merged = dict(upstream) if isinstance(upstream, dict) else {}
        for port, value in resolved.items():
            merged.setdefault(port, value)
        return merged
    # Standard nodes have a single data input.  Prefer a real graph edge when
    # present; otherwise use the compiler-recorded namespace variable.
    if upstream is not None:
        return upstream
    return next(iter(resolved.values()))


def _bind_notebook_parameters(params: dict[str, Any], namespace: dict[str, Any]) -> dict[str, Any]:
    """Resolve Notebook variables/expressions into ordinary native-node parameters.

    This keeps the NodeSpec contract literal and deterministic for normal
    workflows, while imported notebooks may preserve expressions such as
    ``Read_sample + Set_sample`` without falling back to a function black box.
    """
    merged = dict(params)
    bindings = _notebook_binding_map(params, "notebookParameterBindingsJson")
    for key, variable in bindings.items():
        if variable in namespace:
            merged[key] = namespace[variable]
    raw_expressions = params.get("notebookParameterExpressionsJson")
    if isinstance(raw_expressions, str) and raw_expressions.strip():
        try:
            expressions = json.loads(raw_expressions)
        except (TypeError, ValueError):
            expressions = {}
        if isinstance(expressions, dict):
            for key, expression in expressions.items():
                if not isinstance(expression, str) or not expression.strip():
                    continue
                merged[str(key)] = eval(compile(ast.parse(expression, mode="eval"), "<notebook-parameter>", "eval"), namespace, namespace)
    return merged


def _sync_notebook_outputs(params: dict[str, Any], outputs: dict[str, Any], namespace: dict[str, Any]) -> None:
    """Publish native-node outputs back into the shared Python namespace."""
    bindings = _notebook_binding_map(params, "notebookOutputBindingsJson")
    for variable, port in bindings.items():
        if port in outputs:
            namespace[variable] = outputs[port]

_FUNCTION_MULTI_INPUT_TYPES = {
    "table.concat", "table.merge_rows", "pulse.combine_channels", "pulse.segment_measurement",
    "custom.python_function", "ui.alert", "function.call", "function.map", "logic.if_value",
}

def _function_definition_for_call(node: dict[str, Any], workflow: dict[str, Any], call_stack: tuple[str, ...]) -> dict[str, Any]:
    params = node.get("data", {}).get("parameters", {})
    function_id = str(params.get("functionId", "")).strip()
    try:
        version = int(params.get("functionVersion", 0))
    except (TypeError, ValueError) as exception:
        raise ValueError("Function call has an invalid functionVersion") from exception
    if not function_id:
        raise ValueError("Function call is missing functionId")
    definition = next((item for item in workflow.get("functions", []) if isinstance(item, dict) and item.get("id") == function_id), None)
    if definition is None:
        raise ValueError(f"Function {function_id} is not available in this workflow")
    if int(definition.get("version", 0)) != version:
        raise ValueError(f"Function {definition.get('name', function_id)} version mismatch: call requests v{version}, document provides v{definition.get('version', 0)}")
    if function_id in call_stack:
        raise ValueError(f"Recursive function call is not allowed: {' -> '.join((*call_stack, function_id))}")
    if len(call_stack) >= 32:
        raise ValueError("Function call depth exceeds 32")
    return definition

def _function_node_upstream(
    node: dict[str, Any], workflow: dict[str, Any], values: dict[str, dict[str, Any]], external: dict[str, Any],
) -> Any:
    inputs: dict[str, Any] = {}
    for edge in _data_edges(workflow):
        if edge.get("target") != node["id"]:
            continue
        port = edge.get("targetHandle") or "input"
        if port in inputs:
            raise ValueError(f"Function node {node['id']} input {port} has more than one connection")
        inputs[port] = _edge_value(edge, values)
    for port, value in external.items():
        if port in inputs:
            raise ValueError(f"Function node {node['id']} input {port} is wired both internally and externally")
        inputs[port] = value
    node_type = node.get("data", {}).get("nodeType")
    if node_type in _FUNCTION_MULTI_INPUT_TYPES:
        return inputs
    if not inputs:
        return None
    if any(port != "input" for port in inputs):
        return inputs
    if len(inputs) > 1:
        raise ValueError(f"Function node {node['id']} currently accepts only one input")
    return next(iter(inputs.values()))

def _function_output_value(outputs: dict[str, Any], handle: Any) -> Any:
    port = str(handle or "output")
    if port not in outputs:
        raise ValueError(f"Function output source has no port {port}")
    return outputs[port]

def _execute_function_call(
    node: dict[str, Any], upstream: Any, workflow: dict[str, Any], csv_text: str,
    input_files: list[dict[str, Any]], variables: dict[str, Any] | None,
    call_stack: tuple[str, ...] = (),
    notebook_namespace: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    definition = _function_definition_for_call(node, workflow, call_stack)
    function_id = str(definition["id"])
    inputs = definition.get("inputs", [])
    if isinstance(upstream, dict):
        call_inputs = dict(upstream)
        if len(inputs) == 1:
            port_id = str(inputs[0].get("id"))
            if port_id not in call_inputs and len(call_inputs) == 1:
                call_inputs = {port_id: next(iter(call_inputs.values()))}
    elif len(inputs) == 1:
        call_inputs = {str(inputs[0].get("id")): upstream}
    else:
        call_inputs = {}
    body = _flatten_workflow_groups({
        "nodes": definition.get("nodes", []),
        "edges": definition.get("edges", []),
        "functions": workflow.get("functions", []),
    })
    notebook_namespace = notebook_namespace or _new_notebook_namespace(csv_text, input_files)
    values: dict[str, dict[str, Any]] = {}
    external_by_node: dict[str, dict[str, Any]] = {}
    for port in inputs:
        if not isinstance(port, dict):
            raise ValueError(f"Function {definition.get('name', function_id)} has an invalid input definition")
        port_id = str(port.get("id", ""))
        if port_id not in call_inputs:
            raise ValueError(f"Function {definition.get('name', function_id)} requires input {port.get('label') or port_id}")
        node_id = str(port.get("internalNodeId", ""))
        handle = str(port.get("internalHandle") or "input")
        target = external_by_node.setdefault(node_id, {})
        if handle in target:
            raise ValueError(f"Function input mapping duplicates {node_id}.{handle}")
        target[handle] = call_inputs[port_id]

    ordered = _ordered_nodes(body)
    skipped = _contained_node_ids(body)
    latest_table: pd.DataFrame | None = None
    latest_plot: str | None = None
    latest_export: str | None = None
    next_stack = (*call_stack, function_id)
    for body_node in ordered:
        body_id = body_node["id"]
        if body_id in skipped:
            continue
        data = body_node.get("data", {})
        body_type = data.get("nodeType")
        params = data.get("parameters", {})
        upstream_value = _function_node_upstream(body_node, body, values, external_by_node.get(body_id, {}))
        upstream_value = _bind_notebook_inputs(body_type, params, upstream_value, notebook_namespace)
        if body_type == "notebook.code_cell":
            outputs, table_result, plot_result, export_result = _execute_notebook_cell(str(params.get("source", "")), notebook_namespace)
        elif body_type == "notebook.markdown_cell":
            text = str(params.get("source", ""))
            outputs, table_result, plot_result, export_result = {"next": text, "output": text}, None, None, None
        elif body_type in _VISUAL_STRUCTURE_TYPES:
            outputs = _execute_visual_structure(body_node, body, upstream_value, csv_text, input_files, variables, workflow, next_stack, notebook_namespace, params)
            table_result = next((value for value in outputs.values() if isinstance(value, pd.DataFrame)), None)
            plot_result = export_result = None
        elif body_type == "function.call":
            outputs, table_result, plot_result, export_result = _execute_function_call(body_node, upstream_value, workflow, csv_text, input_files, variables, next_stack, notebook_namespace)
        elif body_type == "function.map":
            outputs, table_result, plot_result, export_result = _execute_function_map(body_node, upstream_value, workflow, csv_text, input_files, variables, next_stack, notebook_namespace)
        else:
            outputs, table_result, plot_result, export_result = _execute_node(body_type, params, upstream_value, csv_text, input_files, variables)
        _sync_notebook_outputs(params, outputs, notebook_namespace)
        values[body_id] = outputs
        if table_result is not None:
            latest_table = table_result
        if plot_result is not None:
            latest_plot = plot_result
        if export_result is not None:
            latest_export = export_result

    outputs: dict[str, Any] = {}
    for port in definition.get("outputs", []):
        if not isinstance(port, dict):
            raise ValueError(f"Function {definition.get('name', function_id)} has an invalid output definition")
        source_id = str(port.get("internalNodeId", ""))
        source = values.get(source_id)
        if source is None:
            raise ValueError(f"Function {definition.get('name', function_id)} output {port.get('label') or port.get('id')} source did not execute")
        outputs[str(port.get("id", "output"))] = _function_output_value(source, port.get("internalHandle"))
    if "output" not in outputs and outputs:
        outputs["output"] = next(iter(outputs.values()))
    table_result = next((value for value in outputs.values() if isinstance(value, pd.DataFrame)), latest_table)
    return outputs, table_result, latest_plot, latest_export


def _execute_function_map(
    node: dict[str, Any], upstream: Any, workflow: dict[str, Any], csv_text: str,
    input_files: list[dict[str, Any]], variables: dict[str, Any] | None,
    call_stack: tuple[str, ...] = (),
    notebook_namespace: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    """Map one reusable workflow function over a named iterable input.

    This is the exact execution primitive required by the safe Notebook subset
    ``[fn(item, ...) for item in items]``.  It is intentionally not a generic
    Python-comprehension emulator: filters, multiple generators and per-item
    expressions remain in ``notebook.code_cell`` until they have an equivalent
    contract.
    """
    definition = _function_definition_for_call(node, workflow, call_stack)
    params = node.get("data", {}).get("parameters", {})
    map_input = str(params.get("mapInput", "")).strip()
    if not map_input:
        raise ValueError("Function map is missing mapInput")
    input_ids = [str(port.get("id", "")) for port in definition.get("inputs", []) if isinstance(port, dict)]
    if map_input not in input_ids:
        raise ValueError(f"Function map input {map_input} is not present in function {definition.get('name', definition.get('id'))}")
    if not isinstance(upstream, dict):
        raise ValueError("Function map requires named function inputs")
    call_inputs = dict(upstream)
    if map_input not in call_inputs:
        raise ValueError(f"Function map requires iterable input {map_input}")
    try:
        items = list(call_inputs[map_input])
    except TypeError as exception:
        raise ValueError(f"Function map input {map_input} is not iterable") from exception
    maximum = int(params.get("maxIterations", 100000))
    if maximum < 1 or maximum > 1_000_000:
        raise ValueError("Function map maxIterations must be between 1 and 1000000")
    if len(items) > maximum:
        raise ValueError(f"Function map has {len(items)} items, exceeding maxIterations={maximum}")

    function_outputs = [str(port.get("id", "output")) for port in definition.get("outputs", []) if isinstance(port, dict)] or ["output"]
    collected: list[Any] = []
    last_value: Any = None
    has_last_value = False
    latest_plot: str | None = None
    latest_export: str | None = None
    for item in items:
        iteration_inputs = dict(call_inputs)
        iteration_inputs[map_input] = item
        outputs, _, plot_result, export_result = _execute_function_call(
            node, iteration_inputs, workflow, csv_text, input_files, variables, call_stack, notebook_namespace,
        )
        if len(function_outputs) == 1:
            last_value = outputs.get(function_outputs[0])
            has_last_value = True
            collected.append(last_value)
        else:
            collected.append(tuple(outputs.get(port) for port in function_outputs))
        if plot_result is not None:
            latest_plot = plot_result
        if export_result is not None:
            latest_export = export_result

    collect_mode = str(params.get("collectMode", "list"))
    if collect_mode == "table":
        result: Any = pd.DataFrame(collected)
        table_result: pd.DataFrame | None = result
    elif collect_mode == "list":
        result = collected
        table_result = None
    else:
        raise ValueError(f"Unsupported function map collectMode: {collect_mode}")
    result_outputs: dict[str, Any] = {"output": result}
    if has_last_value and str(params.get("lastItemVariable", "")).strip():
        result_outputs["last"] = last_value
    return result_outputs, table_result, latest_plot, latest_export

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
    contained_node_ids = _contained_node_ids(workflow)
    notebook_namespace = _new_notebook_namespace(csv_text, input_files)
    _initialize_notebook_context(workflow, notebook_namespace)
    workspace_variables = decode_workspace_state(workflow.get("workspaceState"))
    variables: dict[str, Any] = {"__execution__": {}, "__workspace__": workspace_variables}

    for node in ordered_nodes:
        _raise_if_execution_cancelled(execution_id)
        node_id = node["id"]
        if node_id in contained_node_ids:
            continue
        data = node.get("data", {})
        node_type = data.get("nodeType")
        params = _bind_notebook_parameters(data.get("parameters", {}), notebook_namespace)
        node_started = time.perf_counter()
        try:
            if node_type == "notebook.code_cell":
                outputs, table_result, plot_result, export_result = _run_with_cancel_trace(execution_id, lambda: _execute_notebook_cell(str(params.get("source", "")), notebook_namespace))
            elif node_type == "notebook.markdown_cell":
                text = str(params.get("source", ""))
                outputs, table_result, plot_result, export_result = {"next": text, "output": text}, None, None, None
            elif node_type in _VISUAL_STRUCTURE_TYPES:
                upstream = _node_upstream(node_id, node_type, workflow, values)
                upstream = _bind_notebook_inputs(node_type, params, upstream, notebook_namespace)
                outputs = _execute_visual_structure(node, workflow, upstream, csv_text, input_files, variables, workflow, (), notebook_namespace, params)
                table_result = next((value for value in outputs.values() if isinstance(value, pd.DataFrame)), None)
                plot_result, export_result = None, None
            else:
                upstream = _node_upstream(node_id, node_type, workflow, values)
                upstream = _bind_notebook_inputs(node_type, params, upstream, notebook_namespace)
                if node_type == "function.call":
                    outputs, table_result, plot_result, export_result = _execute_function_call(node, upstream, workflow, csv_text, input_files, variables, (), notebook_namespace)
                elif node_type == "function.map":
                    outputs, table_result, plot_result, export_result = _execute_function_map(node, upstream, workflow, csv_text, input_files, variables, (), notebook_namespace)
                elif node_type.startswith(_CACHEABLE_NODE_PREFIXES):
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
            _sync_notebook_outputs(params, outputs, notebook_namespace)
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
            "workspaceState": encode_workspace_state(workspace_variables),
        },
        ensure_ascii=False,
        allow_nan=False,
    )
