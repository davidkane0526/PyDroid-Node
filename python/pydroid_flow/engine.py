from __future__ import annotations

import base64
import ast
import builtins
import hashlib
import io
import inspect
import importlib.metadata
import json
import math
import re
import sys
import time
import traceback
from contextlib import redirect_stderr, redirect_stdout
from collections import defaultdict, deque
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


MAX_WORKFLOW_NODES = 2_000
MAX_WORKFLOW_EDGES = 10_000
MAX_INPUT_FILES = 500
MAX_INPUT_TEXT_CHARS = 64 * 1024 * 1024
MAX_WORKFLOW_JSON_CHARS = 16 * 1024 * 1024
MAX_INPUT_FILES_JSON_CHARS = 96 * 1024 * 1024

# ComfyUI-style execution cache: reuse the result of a pure-function node when its
# identity, parameters and upstream inputs are unchanged. Lives for the process
# lifetime so repeated runs of an edited workflow only recompute what changed.
_node_result_cache: dict[str, tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]] = {}
_CACHEABLE_FRAME_LIMIT = 20_000
_CACHEABLE_NODE_PREFIXES = ("table.", "pandas.", "convert.", "plot.", "analysis.", "pulse.", "python.", "generate.")


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


def _decode_json_compatible(text: str, label: str = "JSON") -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError as original:
        # Older imported nodes sometimes contain Python literal dictionaries
        # (single quotes/True/None). Accept those without weakening execution:
        # literal_eval cannot call functions or access names.
        try:
            return ast.literal_eval(text)
        except (SyntaxError, ValueError):
            start = max(0, original.pos - 45); end = min(len(text), original.pos + 45)
            excerpt = text[start:end].replace("\n", " ")
            raise ValueError(f"{label} 格式错误（字符 {original.pos}）：{original.msg}；附近内容：{excerpt!r}") from original


def environment_info_json() -> str:
    packages: dict[str, str] = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if name:
            packages[name.lower()] = distribution.version
    return json.dumps(
        {
            "pythonVersion": ".".join(str(item) for item in sys.version_info[:3]),
            "packages": [
                {"name": name, "version": version}
                for name, version in sorted(packages.items())
            ],
        },
        ensure_ascii=False,
    )


def _ordered_nodes(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])
    if nodes and all("notebookCellIndex" in node.get("data", {}).get("parameters", {}) for node in nodes):
        return sorted(nodes, key=lambda node: (
            int(node.get("data", {}).get("parameters", {}).get("notebookCellIndex", 0)),
            int(node.get("data", {}).get("parameters", {}).get("notebookOperationIndex", 0)),
        ))
    by_id = {node["id"]: node for node in nodes}
    if len(by_id) != len(nodes):
        raise ValueError("Workflow node IDs must be unique")

    indegree = {node_id: 0 for node_id in by_id}
    downstream: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        source = edge["source"]
        target = edge["target"]
        if source not in by_id or target not in by_id:
            raise ValueError("Workflow contains an edge with a missing node")
        target_type = by_id[target].get("data", {}).get("nodeType")
        if target_type in {"logic.for_each_subflow", "logic.while_subflow"} and edge.get("targetHandle") == "continue":
            continue
        downstream[source].append(target)
        indegree[target] += 1

    queue = deque(node_id for node_id, count in indegree.items() if count == 0)
    ordered: list[dict[str, Any]] = []
    while queue:
        node_id = queue.popleft()
        ordered.append(by_id[node_id])
        for target in downstream[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    if len(ordered) != len(nodes):
        raise ValueError("Workflow must not contain cycles")
    return ordered


def _edge_value(edge: dict[str, Any], values: dict[str, dict[str, Any]]) -> Any:
    outputs = values[edge["source"]]
    port = edge.get("sourceHandle") or "output"
    if port not in outputs:
        raise ValueError(f"Source node {edge['source']} has no output port {port}")
    return outputs[port]


def _upstream_value(node_id: str, workflow: dict[str, Any], values: dict[str, dict[str, Any]]) -> Any:
    incoming = [edge for edge in workflow.get("edges", []) if edge["target"] == node_id]
    if not incoming:
        return None
    if len(incoming) > 1:
        raise ValueError(f"Node {node_id} currently accepts only one table input")
    return _edge_value(incoming[0], values)


def _upstream_tables(node_id: str, workflow: dict[str, Any], values: dict[str, dict[str, Any]]) -> dict[str, pd.DataFrame]:
    incoming = [edge for edge in workflow.get("edges", []) if edge["target"] == node_id]
    ports: dict[str, pd.DataFrame] = {}
    fallback_ports = iter(("left", "right"))
    for edge in incoming:
        port = edge.get("targetHandle") or next(fallback_ports, "")
        if port not in {"left", "right"}:
            raise ValueError(f"Unknown concat input port: {port}")
        if port in ports:
            raise ValueError(f"Concat input {port} has more than one connection")
        ports[port] = _require_table(_edge_value(edge, values), f"Concat input {port}")
    if set(ports) != {"left", "right"}:
        raise ValueError("Concat requires both A and B table inputs")
    return ports


def _upstream_inputs(node_id: str, workflow: dict[str, Any], values: dict[str, dict[str, Any]]) -> dict[str, Any]:
    incoming = [edge for edge in workflow.get("edges", []) if edge["target"] == node_id]
    inputs: dict[str, Any] = {}
    for edge in incoming:
        port = edge.get("targetHandle") or "input"
        if port in inputs:
            raise ValueError(f"Input {port} has more than one connection")
        inputs[port] = _edge_value(edge, values)
    return inputs


def _loop_body(workflow: dict[str, Any], loop_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    edges = workflow.get("edges", [])
    start_edges = [edge for edge in edges if edge["source"] == loop_id and edge.get("sourceHandle") == "body"]
    back_edges = [edge for edge in edges if edge["target"] == loop_id and edge.get("targetHandle") == "continue"]
    if len(start_edges) != 1 or len(back_edges) != 1:
        raise ValueError("Loop subflow requires exactly one body connection and one continue connection")
    pending = [start_edges[0]["target"]]
    body_ids: set[str] = set()
    while pending:
        node_id = pending.pop()
        if node_id == loop_id or node_id in body_ids:
            continue
        body_ids.add(node_id)
        pending.extend(edge["target"] for edge in edges if edge["source"] == node_id and edge["target"] != loop_id)
    if back_edges[0]["source"] not in body_ids:
        raise ValueError("Loop continue connection must come from the body subflow")
    body_workflow = {
        "nodes": [node for node in workflow.get("nodes", []) if node["id"] in body_ids],
        "edges": [edge for edge in edges if edge["source"] in body_ids and edge["target"] in body_ids],
    }
    return _ordered_nodes(body_workflow), back_edges[0]


def _all_loop_body_ids(workflow: dict[str, Any]) -> set[str]:
    result: set[str] = set()
    for node in workflow.get("nodes", []):
        if node.get("data", {}).get("nodeType") in {"logic.for_each_subflow", "logic.while_subflow"}:
            try:
                body, _ = _loop_body(workflow, node["id"])
                result.update(item["id"] for item in body)
            except ValueError:
                # The loop node itself will report a precise wiring error when executed.
                pass
    return result


def _contained_node_ids(workflow: dict[str, Any]) -> set[str]:
    return {str(node["id"]) for node in workflow.get("nodes", []) if node.get("parentId")}


def _container_children(workflow: dict[str, Any], container_id: str, branch: str) -> list[dict[str, Any]]:
    children = [node for node in workflow.get("nodes", []) if node.get("parentId") == container_id and node.get("data", {}).get("branch", "body") == branch]
    return sorted(children, key=lambda node: (float(node.get("position", {}).get("x", 0)), float(node.get("position", {}).get("y", 0))))


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


def _require_table(value: Any, operation: str) -> pd.DataFrame:
    if not isinstance(value, pd.DataFrame):
        raise ValueError(f"{operation} requires a table input")
    return value


def _parse_columns(raw: Any, column_count: int) -> list[int]:
    if raw is None or str(raw).strip() == "":
        return list(range(column_count))
    columns = [int(item.strip()) for item in str(raw).split(",")]
    invalid = [column for column in columns if column < 0 or column >= column_count]
    if invalid:
        raise ValueError(f"Column indexes out of range: {invalid}")
    return columns


def _resolve_column(frame: pd.DataFrame, raw: Any) -> Any:
    value = str(raw).strip()
    if value in frame.columns:
        return value
    try:
        index = int(value)
    except ValueError as exception:
        raise ValueError(f"Unknown column: {value}") from exception
    if index < 0 or index >= len(frame.columns):
        raise ValueError(f"Column index out of range: {index}")
    return frame.columns[index]


def _resolve_columns(frame: pd.DataFrame, raw: Any) -> list[Any]:
    if raw is None or not str(raw).strip():
        return []
    return [_resolve_column(frame, item) for item in str(raw).split(",") if item.strip()]


def _rename_columns(frame: pd.DataFrame, raw: Any) -> pd.DataFrame:
    text = str(raw or "").strip()
    if not text:
        raise ValueError("Column names are required")
    if text.startswith("{"):
        mapping = _decode_json_compatible(text, "列名映射")
        if not isinstance(mapping, dict):
            raise ValueError("Column mapping must be a JSON object")
        resolved = {_resolve_column(frame, key): str(value) for key, value in mapping.items()}
        return frame.rename(columns=resolved)
    names = [item.strip() for item in text.split(",")]
    if len(names) != len(frame.columns) or any(not name for name in names):
        raise ValueError(f"Expected {len(frame.columns)} non-empty column names, received {len(names)}")
    renamed = frame.copy()
    renamed.columns = names
    return renamed


def _optional_float(raw: Any) -> float | None:
    if raw is None or str(raw).strip() == "":
        return None
    return float(raw)


def _round_half_away(value: float, ndigits: int = 0) -> float:
    """Round half away from zero (the conventional 四舍五入), unlike Python's
    built-in round which uses banker's rounding (round-half-to-even)."""
    quantum = Decimal(1).scaleb(-ndigits)
    return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def _scalar_value(raw: Any) -> Any:
    text = str(raw)
    try:
        return _decode_json_compatible(text, "参数")
    except (ValueError, TypeError):
        return text


def _parameter_list(raw: Any, numeric_when_possible: bool = False) -> list[Any]:
    if raw is None or str(raw).strip() == "":
        return []
    if isinstance(raw, list):
        items = raw
    else:
        text = str(raw).strip()
        if text.startswith("["):
            items = _decode_json_compatible(text, "列表参数")
            if not isinstance(items, list):
                raise ValueError("Expected a JSON array or comma-separated values")
        else:
            items = [item.strip() for item in text.split(",") if item.strip()]
    if numeric_when_possible and items and all(str(item).lstrip("-").isdigit() for item in items):
        return [int(item) for item in items]
    return [str(item) for item in items]


def _read_csv(csv_text: str, params: dict[str, Any]) -> pd.DataFrame:
    separator = str(params.get("separator", ","))
    separator = "\t" if separator == "\\t" else separator
    if not separator:
        raise ValueError("CSV separator cannot be empty")

    header_raw = str(params.get("header", "none")).strip().lower()
    header: Any = None if header_raw in {"", "none"} else "infer" if header_raw == "infer" else int(header_raw)
    engine = str(params.get("engine", "c") or "c")
    skip_footer = int(params.get("skipFooter", 0) or 0)
    if skip_footer and engine == "c":
        engine = "python"

    kwargs: dict[str, Any] = {
        "sep": separator,
        "header": header,
        "engine": engine,
        "skipinitialspace": _as_bool(params.get("skipInitialSpace", False)),
        "skipfooter": skip_footer,
        "keep_default_na": _as_bool(params.get("keepDefaultNa", True)),
        "na_filter": _as_bool(params.get("naFilter", True)),
        "skip_blank_lines": _as_bool(params.get("skipBlankLines", True)),
        "dayfirst": _as_bool(params.get("dayFirst", False)),
        "cache_dates": _as_bool(params.get("cacheDates", True)),
        "decimal": str(params.get("decimal", ".") or "."),
        "quotechar": str(params.get("quoteChar", "\"") or "\""),
        "quoting": int(params.get("quoting", 0) or 0),
        "doublequote": _as_bool(params.get("doubleQuote", True)),
        "on_bad_lines": str(params.get("onBadLines", "error") or "error"),
    }

    names = _parameter_list(params.get("names"))
    use_columns = _parameter_list(params.get("useColumns"), numeric_when_possible=True)
    na_values = _parameter_list(params.get("naValues"))
    true_values = _parameter_list(params.get("trueValues"))
    false_values = _parameter_list(params.get("falseValues"))
    parse_dates = _parameter_list(params.get("parseDates"), numeric_when_possible=True)
    if names:
        kwargs["names"] = names
    if use_columns:
        kwargs["usecols"] = use_columns
    if na_values:
        kwargs["na_values"] = na_values
    if true_values:
        kwargs["true_values"] = true_values
    if false_values:
        kwargs["false_values"] = false_values
    if parse_dates:
        kwargs["parse_dates"] = parse_dates

    dtype_text = str(params.get("dtype", "") or "").strip()
    if dtype_text:
        kwargs["dtype"] = _decode_json_compatible(dtype_text, "dtype 参数") if dtype_text.startswith("{") else dtype_text

    index_column = str(params.get("indexColumn", "") or "").strip()
    if index_column:
        kwargs["index_col"] = int(index_column) if index_column.lstrip("-").isdigit() else index_column

    skip_rows = params.get("skipRows", 0)
    if str(skip_rows).strip() not in {"", "0"}:
        text = str(skip_rows).strip()
        kwargs["skiprows"] = _parameter_list(text, numeric_when_possible=True) if "," in text or text.startswith("[") else int(text)

    optional_numbers = {"nRows": "nrows"}
    for parameter, pandas_name in optional_numbers.items():
        raw = params.get(parameter)
        if raw is not None and str(raw).strip() not in {"", "0"}:
            kwargs[pandas_name] = int(raw)

    optional_strings = {
        "dateFormat": "date_format", "thousands": "thousands", "escapeChar": "escapechar",
        "comment": "comment", "lineTerminator": "lineterminator", "dialect": "dialect",
    }
    for parameter, pandas_name in optional_strings.items():
        value = str(params.get(parameter, "") or "")
        if value:
            kwargs[pandas_name] = value

    if engine == "c":
        kwargs["low_memory"] = _as_bool(params.get("lowMemory", True))
        float_precision = str(params.get("floatPrecision", "") or "")
        if float_precision:
            kwargs["float_precision"] = float_precision

    frame = pd.read_csv(io.StringIO(csv_text), **kwargs)
    frame.columns = [str(column) for column in frame.columns]
    return frame


def _read_csv_batch(input_files: list[dict[str, Any]], params: dict[str, Any]) -> pd.DataFrame:
    if not input_files:
        raise ValueError("Batch CSV input requires at least one selected file")
    source_column = str(params.get("sourceColumn", "source_file")).strip() or "source_file"
    metadata_column = str(params.get("metadataColumn", "Vg_V")).strip()
    filename_pattern = str(params.get("filenamePattern", r"vg\s*=\s*([-+]?\d+(?:\.\d+)?)\s*v")).strip()
    on_error = str(params.get("onError", "error"))
    frames: list[pd.DataFrame] = []
    errors: list[str] = []
    for item in input_files:
        name = str(item.get("name", "unnamed.csv"))
        text = item.get("text")
        if not isinstance(text, str):
            errors.append(f"{name}: missing text content")
            continue
        try:
            frame = _read_csv(text, params)
            frame[source_column] = name
            if metadata_column and filename_pattern:
                match = re.search(filename_pattern, name, flags=re.IGNORECASE)
                if not match:
                    raise ValueError(f"filename does not match pattern {filename_pattern!r}")
                captured = match.group(1) if match.groups() else match.group(0)
                try:
                    captured = float(captured)
                except ValueError:
                    pass
                frame[metadata_column] = captured
            frames.append(frame)
        except Exception as exception:
            errors.append(f"{name}: {exception}")
    if errors and on_error == "error":
        raise ValueError("Batch CSV errors: " + "; ".join(errors))
    if not frames:
        raise ValueError("No CSV file could be read")
    return pd.concat(frames, ignore_index=True)


def _as_bool(raw: Any) -> bool:
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)


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


def _single_value(value: Any) -> Any:
    if isinstance(value, pd.DataFrame):
        if value.shape != (1, 1): raise ValueError("转换为单值要求表格恰好为 1 行 × 1 列")
        return value.iat[0, 0]
    if isinstance(value, pd.Series):
        if len(value) != 1: raise ValueError("转换为单值要求 Series 恰好包含 1 项")
        return value.iloc[0]
    return value


def _simple_annotation_kind(name: str) -> str:
    normalized = name.strip(" '\"").replace(" ", "").lower()
    aliases = {
        "dataframe": "table", "pd.dataframe": "table", "pandas.dataframe": "table",
        "series": "table", "pd.series": "table", "pandas.series": "table",
        "ndarray": "table", "np.ndarray": "table", "numpy.ndarray": "table",
        "table": "table", "int": "number", "float": "number", "number": "number",
        "str": "text", "string": "text", "text": "text", "bool": "boolean",
        "boolean": "boolean", "plot": "plot", "image": "plot", "csv": "csv",
        "list": "list", "typing.list": "list", "sequence": "list",
        "set": "list", "typing.set": "list", "frozenset": "list",
        "dict": "object", "typing.dict": "object", "mapping": "object", "object": "object",
        "any": "any", "typing.any": "any",
    }
    return aliases.get(normalized, "")


def _annotation_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_annotation_name(node.value)}.{node.attr}"
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""


def _subscript_arguments(node: ast.Subscript) -> list[ast.AST]:
    return list(node.slice.elts) if isinstance(node.slice, ast.Tuple) else [node.slice]


def _annotation_descriptor(annotation: Any) -> dict[str, Any]:
    if annotation is inspect.Parameter.empty or annotation is inspect.Signature.empty:
        return {}
    if annotation is pd.DataFrame:
        return {"kind": "table"}
    if annotation in {int, float}:
        return {"kind": "number", "number_type": annotation.__name__}
    if annotation is str:
        return {"kind": "text"}
    if annotation is bool:
        return {"kind": "boolean"}
    raw = str(annotation).strip()
    try:
        expression = ast.parse(raw, mode="eval").body
    except SyntaxError:
        return {"kind": _simple_annotation_kind(raw)} if _simple_annotation_kind(raw) else {}

    def describe(node: ast.AST) -> dict[str, Any]:
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            members = [node.left, node.right]
            non_null = [member for member in members if _annotation_name(member).lower() not in {"none", "nonetype"}]
            if len(non_null) != 1:
                return {}
            return {**describe(non_null[0]), "optional": True}
        if isinstance(node, ast.Subscript):
            generic = _annotation_name(node.value).lower()
            arguments = _subscript_arguments(node)
            if generic in {"optional", "typing.optional"} and len(arguments) == 1:
                return {**describe(arguments[0]), "optional": True}
            if generic in {"union", "typing.union"}:
                non_null = [member for member in arguments if _annotation_name(member).lower() not in {"none", "nonetype"}]
                return {**describe(non_null[0]), "optional": True} if len(non_null) == 1 else {}
            if generic in {"list", "typing.list", "sequence", "typing.sequence"} and len(arguments) == 1:
                item = describe(arguments[0])
                return {"kind": "list", "item_kind": item.get("kind"), "item_number_type": item.get("number_type")}
            if generic in {"dict", "typing.dict", "mapping"}:
                return {"kind": "object"}
            if generic in {"set", "typing.set", "frozenset"}:
                return {"kind": "list"}
            if generic in {"literal", "typing.literal"}:
                try:
                    choices = [ast.literal_eval(member) for member in arguments]
                except (ValueError, TypeError):
                    return {}
                return {"kind": "literal", "choices": choices}
            if generic in {"tuple", "typing.tuple"}:
                outputs = []
                for index, member in enumerate(arguments):
                    declaration = _annotation_name(member)
                    if ":" in declaration:
                        port, annotation_name = (part.strip() for part in declaration.split(":", 1))
                        descriptor = {"kind": _simple_annotation_kind(annotation_name), "port": port}
                    else:
                        descriptor = {**describe(member), "port": f"output{index + 1}"}
                    if not descriptor.get("kind") or not descriptor["port"].isidentifier():
                        return {}
                    outputs.append(descriptor)
                if len({output["port"] for output in outputs}) != len(outputs):
                    return {}
                return {"kind": "tuple", "outputs": outputs} if all(output.get("kind") for output in outputs) else {}
        name = _annotation_name(node)
        kind = _simple_annotation_kind(name)
        descriptor: dict[str, Any] = {"kind": kind} if kind else {}
        if name.strip(" '\"").lower() in {"float", "number"}:
            descriptor["number_type"] = "float"
        elif name.strip(" '\"").lower() == "int":
            descriptor["number_type"] = "int"
        return descriptor

    return describe(expression)


def _parse_list_parameter(raw: Any, item_kind: str, number_type: str | None = None) -> list[Any]:
    if isinstance(raw, list):
        items = raw
    else:
        text = str(raw).strip()
        if text.startswith("["):
            parsed = _decode_json_compatible(text, "列表参数")
            if not isinstance(parsed, list):
                raise ValueError("List parameter must be a JSON array or comma-separated values")
            items = parsed
        else:
            items = [item.strip() for item in text.split(",") if item.strip()]
    if item_kind == "number":
        converter = float if number_type == "float" else int
        return [converter(item) for item in items]
    if item_kind == "boolean":
        return [_as_bool(item) for item in items]
    if item_kind == "text":
        return [str(item) for item in items]
    raise ValueError("List item type is not supported")


def _convert_custom_parameter(raw: Any, descriptor: dict[str, Any]) -> Any:
    kind = descriptor.get("kind")
    if kind == "number":
        return float(raw) if descriptor.get("number_type") == "float" else int(raw)
    if kind == "boolean":
        return _as_bool(raw)
    if kind == "text":
        return str(raw)
    if kind == "object":
        if isinstance(raw, (dict, list)):
            return raw
        text = str(raw).strip()
        if not text:
            return None
        return _decode_json_compatible(text, "对象参数")
    if kind == "list":
        if not descriptor.get("item_kind"):
            # Bare list/set annotation without a concrete item type.
            return _parse_list_parameter(raw, "text")
        return _parse_list_parameter(raw, descriptor.get("item_kind", ""), descriptor.get("item_number_type"))
    if kind == "literal":
        choices = descriptor.get("choices", [])
        for choice in choices:
            if str(choice) == str(raw):
                return choice
        raise ValueError(f"Value {raw!r} is not one of {choices}")
    raise ValueError(f"Unsupported custom parameter type: {kind}")


def _coerce_custom_output(value: Any, descriptor: dict[str, Any]) -> Any:
    """Normalise annotated return values into the port type the node declares."""
    kind = descriptor.get("kind")
    if kind == "table":
        if isinstance(value, pd.Series):
            return value.to_frame()
        if isinstance(value, np.ndarray):
            return pd.DataFrame(value)
    if kind == "list" and isinstance(value, (set, frozenset)):
        return list(value)
    return value


def _validate_custom_output(value: Any, descriptor: dict[str, Any], port: str) -> None:
    kind = descriptor.get("kind")
    if kind == "table" and not isinstance(value, pd.DataFrame):
        raise ValueError(f"Output {port} declared table but did not return a DataFrame")
    if kind == "number" and not isinstance(value, (int, float)):
        raise ValueError(f"Output {port} declared number but returned {type(value).__name__}")
    if kind in {"text", "csv"} and not isinstance(value, str):
        raise ValueError(f"Output {port} declared {kind} but returned {type(value).__name__}")
    if kind == "boolean" and not isinstance(value, bool):
        raise ValueError(f"Output {port} declared boolean but returned {type(value).__name__}")
    if kind == "list" and not isinstance(value, (list, tuple, set, frozenset)):
        raise ValueError(f"Output {port} declared list but returned {type(value).__name__}")


_CUSTOM_ALLOWED_IMPORTS = {
    "numpy", "pandas", "scipy", "matplotlib", "math", "json", "re",
    "collections", "itertools", "functools", "statistics", "typing",
    "datetime", "decimal", "fractions", "random", "string", "textwrap",
    "copy", "heapq", "bisect", "operator", "numbers", "warnings",
    "sklearn", "PIL", "cv2", "openpyxl", "xlrd", "scipy", "networkx",
}

# 系统级危险模块：即使桌面端放宽 import 也始终禁止。
_CUSTOM_FORBIDDEN_IMPORTS = {
    "os", "sys", "subprocess", "shutil", "socket", "importlib", "builtins",
    "ctypes", "multiprocessing", "threading", "pathlib", "tempfile",
}

# 移动端（Chaquopy）只能安装预编译 Android wheel 的库，保持严格白名单；
# 桌面端（pip 自由）可通过 allow_all_custom_imports() 放宽到"仅禁止危险模块"。
_CUSTOM_ALLOW_ALL_IMPORTS = False


def allow_all_custom_imports() -> None:
    """桌面端调用：放宽自定义节点 import 为仅禁止系统级危险模块。"""
    global _CUSTOM_ALLOW_ALL_IMPORTS
    _CUSTOM_ALLOW_ALL_IMPORTS = True


def _import_root_allowed(root: str) -> bool:
    if root in _CUSTOM_FORBIDDEN_IMPORTS:
        return False
    if _CUSTOM_ALLOW_ALL_IMPORTS:
        return True
    return root in _CUSTOM_ALLOWED_IMPORTS


def _validate_custom_imports(tree: ast.AST) -> None:
    """移动端白名单、桌面端仅禁止危险模块；两者都拒绝系统级危险模块。"""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if not _import_root_allowed(root):
                    raise ValueError(f"自定义节点不能导入 {alias.name!r}；允许的模块：{', '.join(sorted(_CUSTOM_ALLOWED_IMPORTS))}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            root = module.split(".")[0]
            if not _import_root_allowed(root):
                raise ValueError(f"自定义节点不能从 {module!r} 导入；允许的模块：{', '.join(sorted(_CUSTOM_ALLOWED_IMPORTS))}")


def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    """供自定义函数使用的受限 __import__，按平台策略放行模块。"""
    root = name.split(".")[0]
    if not _import_root_allowed(root):
        raise ImportError(f"自定义节点不能导入 {name!r}")
    return __import__(name, globals, locals, fromlist, level)


def _execute_custom_function(code: str, upstream: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    tree = ast.parse(code, mode="exec")
    _validate_custom_imports(tree)
    if any(isinstance(node, (ast.Global, ast.Nonlocal)) for node in ast.walk(tree)):
        raise ValueError("Custom functions cannot modify global/nonlocal state")
    functions = [node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    if len(functions) != 1 or any(isinstance(node, ast.AsyncFunctionDef) for node in tree.body):
        raise ValueError("Custom node code must contain exactly one synchronous function")

    safe_builtins = {
        name: getattr(builtins, name)
        for name in (
            "abs", "all", "any", "bool", "complex", "dict", "divmod", "enumerate",
            "filter", "float", "frozenset", "getattr", "hasattr", "int", "isinstance",
            "issubclass", "len", "list", "map", "max", "min", "pow", "range", "reversed",
            "round", "set", "sorted", "str", "sum", "tuple", "zip",
        )
    }
    safe_builtins["__import__"] = _restricted_import
    # Align the custom-function namespace with the notebook cell namespace so the
    # same Python idioms work in both: pandas + numpy + math are always available.
    namespace: dict[str, Any] = {"__builtins__": safe_builtins, "pd": pd, "np": np, "math": math}
    exec(compile(tree, "<custom-node>", "exec"), namespace, namespace)
    function = namespace[functions[0]]
    signature = inspect.signature(function)
    provided: dict[str, Any] = {}
    for name, parameter in signature.parameters.items():
        if parameter.kind in {inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD}:
            raise ValueError("Custom functions do not support *args/**kwargs parameters")
        descriptor = _annotation_descriptor(parameter.annotation)
        kind = descriptor.get("kind")
        if not kind or kind == "tuple":
            raise ValueError(f"Parameter {name} has no supported type annotation; use table/plot/csv/number/text/boolean/list/Literal/Any (or Optional[...])")
        if kind in {"table", "plot", "csv", "any"}:
            if name in upstream:
                provided[name] = upstream[name]
            elif parameter.default is inspect.Parameter.empty:
                if descriptor.get("optional"):
                    provided[name] = None
                else:
                    raise ValueError(f"Required input {name} is not connected")
            continue
        if name not in params or params[name] in {None, ""}:
            if parameter.default is inspect.Parameter.empty:
                if descriptor.get("optional"):
                    provided[name] = None
                else:
                    raise ValueError(f"Required parameter {name} has no value")
            continue
        provided[name] = _convert_custom_parameter(params[name], descriptor)

    output_descriptor = _annotation_descriptor(signature.return_annotation)
    if not output_descriptor.get("kind"):
        raise ValueError("Custom function return value has no supported type annotation; use table/plot/csv/number/text/boolean/list/Any (or tuple['a:table', ...])")
    positional_arguments: list[Any] = []
    keyword_arguments: dict[str, Any] = {}
    for name, parameter in signature.parameters.items():
        if parameter.kind == inspect.Parameter.POSITIONAL_ONLY:
            if name in provided:
                positional_arguments.append(provided[name])
            elif parameter.default is not inspect.Parameter.empty:
                positional_arguments.append(parameter.default)
        elif name in provided:
            keyword_arguments[name] = provided[name]
    value = function(*positional_arguments, **keyword_arguments)
    if output_descriptor["kind"] == "tuple":
        descriptors = output_descriptor["outputs"]
        if not isinstance(value, tuple) or len(value) != len(descriptors):
            raise ValueError(f"Custom function must return a tuple with {len(descriptors)} values")
        coerced = [_coerce_custom_output(item, descriptor) for item, descriptor in zip(value, descriptors, strict=True)]
        outputs = {descriptor.get("port", f"output{index + 1}"): item for index, (descriptor, item) in enumerate(zip(descriptors, coerced, strict=True))}
        for port, item, descriptor in zip(outputs, coerced, descriptors, strict=True):
            _validate_custom_output(item, descriptor, port)
        return outputs
    value = _coerce_custom_output(value, output_descriptor)
    _validate_custom_output(value, output_descriptor, "output")
    return {"output": value}


def analyze_signature_json(code: str) -> str:
    """Parse a custom Python function signature into the same JSON shape the
    frontend's parsePythonFunctionSignature produces, so the Python runtime can
    serve as the single source of truth whenever it is reachable."""
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        return json.dumps({"error": f"syntax: {error.msg}"}, ensure_ascii=False)
    functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    if len(functions) != 1 or any(isinstance(node, ast.AsyncFunctionDef) for node in tree.body):
        return json.dumps({"error": "Custom node code must contain exactly one synchronous function"}, ensure_ascii=False)
    fn = functions[0]

    def descriptor_for(annotation: ast.AST | None) -> dict[str, Any]:
        if annotation is None:
            return {}
        return _annotation_descriptor(ast.unparse(annotation))

    input_ports: list[dict[str, Any]] = []
    parameters: list[dict[str, Any]] = []
    if fn.args.vararg or fn.args.kwarg:
        return json.dumps({"error": "自定义节点不支持 *args/**kwargs 可变参数"}, ensure_ascii=False)

    def add_argument(arg: ast.arg, default: str | None) -> str | None:
        descriptor = descriptor_for(arg.annotation)
        kind = descriptor.get("kind")
        if not kind:
            return f"参数 {arg.arg} 缺少受支持的类型标注"
        optional = bool(descriptor.get("optional"))
        required = default is None and not optional
        if kind in {"table", "plot", "csv", "any"}:
            input_ports.append({"id": arg.arg, "label": arg.arg, "valueType": kind, "required": required})
            return None
        parameter_kind = (
            "select" if kind == "literal" else
            "boolean" if kind == "boolean" else
            "number" if kind == "number" else
            "list" if kind == "list" else
            "textarea" if kind == "object" else
            "text"
        )
        parameters.append({
            "key": arg.arg, "label": arg.arg, "kind": parameter_kind,
            "required": required, "defaultValue": default,
        })
        return None

    positional_args = [*fn.args.posonlyargs, *fn.args.args]
    positional_defaults = [None] * (len(positional_args) - len(fn.args.defaults)) + [ast.unparse(default) for default in fn.args.defaults]
    for arg, default in zip(positional_args, positional_defaults, strict=True):
        if error := add_argument(arg, default):
            return json.dumps({"error": error}, ensure_ascii=False)
    for arg, default_node in zip(fn.args.kwonlyargs, fn.args.kw_defaults, strict=True):
        default = ast.unparse(default_node) if default_node is not None else None
        if error := add_argument(arg, default):
            return json.dumps({"error": error}, ensure_ascii=False)

    return_descriptor = descriptor_for(fn.returns)
    if return_descriptor.get("kind") == "tuple":
        output_ports = [
            {"id": output.get("port", f"output{index + 1}"), "label": output.get("port", f"结果 {index + 1}"), "valueType": output.get("kind")}
            for index, output in enumerate(return_descriptor.get("outputs", []))
        ]
    elif return_descriptor.get("kind"):
        output_ports = [{"id": "output", "label": "结果", "valueType": return_descriptor["kind"]}]
    else:
        return json.dumps({"error": "函数返回值缺少受支持的类型标注"}, ensure_ascii=False)

    return json.dumps({
        "functionName": fn.name,
        "inputPorts": input_ports,
        "outputPorts": output_ports,
        "outputType": output_ports[0]["valueType"],
        "parameters": parameters,
    }, ensure_ascii=False)


def _group_aggregate(frame: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    group_size = int(params.get("groupSize", 20))
    start = int(params.get("startRow", 0))
    end_raw = params.get("endRow", "")
    end = int(end_raw) if str(end_raw).strip() else group_size
    method = str(params.get("method", "mean"))

    if group_size <= 0:
        raise ValueError("groupSize must be greater than zero")
    if start < 0 or end <= start or end > group_size:
        raise ValueError("The aggregation window must satisfy 0 <= startRow < endRow <= groupSize")
    if method not in {"mean", "median", "min", "max", "sum"}:
        raise ValueError(f"Unsupported aggregation method: {method}")

    rows: list[pd.Series] = []
    # Grouping relies on a contiguous 0-based RangeIndex; upstream nodes such as
    # table.diff / table.select_columns / table.slice keep the original index,
    # which can be non-contiguous and would silently mis-bucket the rows.
    frame = frame.reset_index(drop=True)
    for _, group in frame.groupby(frame.index // group_size):
        window = group.iloc[start:end]
        if window.empty:
            continue
        rows.append(getattr(window, method)(numeric_only=True))
    return pd.DataFrame(rows).reset_index(drop=True)


def _filter_range(frame: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    column_index = int(params.get("column", 0))
    if column_index < 0 or column_index >= len(frame.columns):
        raise ValueError(f"Filter column index out of range: {column_index}")
    minimum = _optional_float(params.get("min"))
    maximum = _optional_float(params.get("max"))
    series = pd.to_numeric(frame.iloc[:, column_index], errors="coerce")
    mask = pd.Series(True, index=frame.index)
    if minimum is not None:
        mask &= series >= minimum
    if maximum is not None:
        mask &= series <= maximum
    return frame.loc[mask].reset_index(drop=True)


def _logic_expression(expression: str, value: float, iteration: int) -> float | bool:
    """Evaluate the small arithmetic language used by the guarded while node."""
    tree = ast.parse(expression, mode="eval")
    binary = {
        ast.Add: lambda left, right: left + right,
        ast.Sub: lambda left, right: left - right,
        ast.Mult: lambda left, right: left * right,
        ast.Div: lambda left, right: left / right,
        ast.FloorDiv: lambda left, right: left // right,
        ast.Mod: lambda left, right: left % right,
        ast.Pow: lambda left, right: left**right,
    }
    comparisons = {
        ast.Lt: lambda left, right: left < right,
        ast.LtE: lambda left, right: left <= right,
        ast.Gt: lambda left, right: left > right,
        ast.GtE: lambda left, right: left >= right,
        ast.Eq: lambda left, right: left == right,
        ast.NotEq: lambda left, right: left != right,
    }

    def evaluate(node: ast.AST) -> float | bool:
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float, bool)):
            return node.value
        if isinstance(node, ast.Name) and node.id in {"value", "iteration"}:
            return value if node.id == "value" else iteration
        if isinstance(node, ast.BinOp) and type(node.op) in binary:
            return binary[type(node.op)](evaluate(node.left), evaluate(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub, ast.Not)):
            operand = evaluate(node.operand)
            if isinstance(node.op, ast.UAdd):
                return +operand
            if isinstance(node.op, ast.USub):
                return -operand
            return not operand
        if isinstance(node, ast.Compare):
            left = evaluate(node.left)
            for operator, comparator in zip(node.ops, node.comparators, strict=True):
                right = evaluate(comparator)
                if type(operator) not in comparisons or not comparisons[type(operator)](left, right):
                    return False
                left = right
            return True
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            # Short-circuit evaluation: only evaluate operands until the result is
            # decided, so patterns like `value != 0 and 1 / value > 0.1` no longer
            # raise ZeroDivisionError when value == 0.
            if isinstance(node.op, ast.And):
                for item in node.values:
                    if not bool(evaluate(item)):
                        return False
                return True
            for item in node.values:
                if bool(evaluate(item)):
                    return True
            return False
        raise ValueError("While expressions support only value, iteration, numbers, arithmetic, comparisons, and/or/not")

    result = evaluate(tree.body)
    if not isinstance(result, (int, float, bool)):
        raise ValueError("While expression must produce a number or boolean")
    return result


def _ter_matrix(frame: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    vg_column = _resolve_column(frame, params.get("vgColumn", "Vg_V"))
    voltage_column = _resolve_column(frame, params.get("voltageColumn", 0))
    current_column = _resolve_column(frame, params.get("currentColumn", 1))
    current_floor = float(params.get("currentFloor", 1e-15))
    mode = str(params.get("mode", "high-low"))
    if mode not in {"high-low", "down-minus-up", "up-minus-down"}:
        raise ValueError(f"Unsupported TER mode: {mode}")

    groups: list[tuple[Any, list[float], list[float], str]] = []
    detected_min = math.inf
    detected_max = -math.inf
    all_differences: list[float] = []
    source_column = str(params.get("sourceColumn", "source_file")).strip()
    for vg, group in frame.groupby(vg_column, sort=True):
        cleaned = pd.DataFrame({
            "voltage": pd.to_numeric(group[voltage_column], errors="coerce"),
            "current": pd.to_numeric(group[current_column], errors="coerce"),
        }).dropna()
        if len(cleaned) < 3:
            raise ValueError(f"Vg={vg} has fewer than 3 valid samples")
        voltages = cleaned["voltage"].astype(float).tolist()
        currents = cleaned["current"].astype(float).tolist()
        differences = [abs(voltages[index] - voltages[index - 1]) for index in range(1, len(voltages))]
        all_differences.extend(item for item in differences if item > 1e-12)
        detected_min = min(detected_min, min(voltages))
        detected_max = max(detected_max, max(voltages))
        source = str(group[source_column].iloc[0]) if source_column and source_column in group.columns else ""
        groups.append((vg, voltages, currents, source))

    # Median is robust against a single noisy tiny difference; the previous
    # minimum could be collapsed by one noise spike into an absurdly small step.
    detected_step = float(np.median(all_differences)) if all_differences else math.inf
    step = _optional_float(params.get("vstep")) or detected_step
    vmin = _optional_float(params.get("vmin"))
    vmax = _optional_float(params.get("vmax"))
    low = detected_min if vmin in {None, 0} else vmin
    high = detected_max if vmax in {None, 0} else vmax
    if not math.isfinite(step) or step <= 0 or not low < 0 < high:
        raise ValueError("Unable to detect a valid Vds range and step")
    tolerance = _optional_float(params.get("tolerance")) or step / 20

    targets: list[float] = []
    target = low
    while target < -step / 2:
        targets.append(round(target, 12))
        target += step
    target = step
    while target <= high + step / 2:
        targets.append(round(target, 12))
        target += step

    records: list[dict[str, Any]] = []
    for vg, voltages, currents, source in groups:
        directions = [0] * len(voltages)
        for index in range(len(voltages)):
            if index > 0 and abs(voltages[index] - voltages[index - 1]) > tolerance:
                directions[index] = 1 if voltages[index] > voltages[index - 1] else -1
            elif index + 1 < len(voltages) and abs(voltages[index + 1] - voltages[index]) > tolerance:
                directions[index] = 1 if voltages[index + 1] > voltages[index] else -1
        for target in targets:
            matched = [index for index, measured in enumerate(voltages) if abs(measured - target) <= tolerance]
            up = [index for index in matched if directions[index] == 1]
            down = [index for index in matched if directions[index] == -1]
            i_up = currents[up[0]] if up else math.nan
            i_down = currents[down[0]] if down else math.nan
            r_up = abs(target / i_up) if math.isfinite(i_up) and abs(i_up) > current_floor else math.nan
            r_down = abs(target / i_down) if math.isfinite(i_down) and abs(i_down) > current_floor else math.nan
            ter = math.nan
            if math.isfinite(r_up) and math.isfinite(r_down):
                if mode == "down-minus-up" and r_up != 0:
                    ter = (r_down - r_up) / r_up * 100
                elif mode == "up-minus-down" and r_down != 0:
                    ter = (r_up - r_down) / r_down * 100
                elif mode == "high-low":
                    r_low, r_high = sorted((r_up, r_down))
                    if r_low != 0:
                        ter = (r_high - r_low) / r_low * 100
            records.append({
                "Vg_V": float(vg), "Vds_V": target, "I_up_A": i_up, "I_down_A": i_down,
                "R_up_ohm": r_up, "R_down_ohm": r_down, "TER_percent": ter,
                **({"source_file": source} if source else {}),
            })
    return pd.DataFrame(records).sort_values(["Vg_V", "Vds_V"]).reset_index(drop=True)


def _pulse_waveform(params: dict[str, Any]) -> pd.DataFrame:
    voltage_max = float(params.get("voltageMax", 3))
    voltage_step = abs(float(params.get("voltageStep", 0.2)))
    read_voltage = float(params.get("readVoltage", 0.1))
    pulse_time = float(params.get("pulseTime", 0.01))
    read_time = float(params.get("readTime", 0.01))
    time_shift = float(params.get("timeShift", 0))
    cycles = float(params.get("cycles", 1))
    ratio = float(params.get("ratio", 1))
    if not math.isfinite(voltage_max) or voltage_max == 0 or not math.isfinite(voltage_step) or voltage_step <= 0:
        raise ValueError("Pulse waveform requires a non-zero voltage maximum and a positive voltage step")
    if any(not math.isfinite(value) or value < 0 for value in (pulse_time, read_time)) or pulse_time + read_time <= 0:
        raise ValueError("Pulse and read times must be finite and their sum must be positive")
    if cycles not in {0.25, 0.5} and (not cycles.is_integer() or cycles < 1 or cycles > 100):
        raise ValueError("Pulse cycles must be 0.25, 0.5, or an integer from 1 to 100")
    direction = 1.0 if voltage_max > 0 else -1.0
    magnitudes = list(np.arange(min(voltage_step, abs(voltage_max)), abs(voltage_max) + voltage_step * 0.01, voltage_step))
    if not magnitudes or not math.isclose(magnitudes[-1], abs(voltage_max), rel_tol=0, abs_tol=voltage_step * 0.01): magnitudes.append(abs(voltage_max))
    levels = [direction * min(value, abs(voltage_max)) for value in magnitudes]
    quarter = levels
    half = quarter + [-value for value in quarter]
    sequence = quarter if cycles == 0.25 else half if cycles == 0.5 else half + list(reversed(half))
    sequence *= int(cycles) if cycles >= 1 else 1
    if len(sequence) * 2 > 100_000: raise ValueError("Pulse waveform exceeds the 100000-row safety limit")
    rows: list[dict[str, Any]] = []
    moment = time_shift
    for index, level in enumerate(sequence):
        moment += read_time
        rows.append({"sequence": index, "time_s": moment, "voltage_V": read_voltage * ratio, "phase": "read"})
        moment += pulse_time
        rows.append({"sequence": index, "time_s": moment, "voltage_V": level * ratio, "phase": "pulse"})
    return pd.DataFrame(rows, columns=["sequence", "time_s", "voltage_V", "phase"])


def _oscillating_pulse_ramp(params: dict[str, Any]) -> pd.DataFrame:
    interval = float(params.get("interval", 0.005)); total = float(params.get("totalTime", 10))
    step = abs(float(params.get("amplitudeStep", 0.2))); fixed = float(params.get("fixedVoltage", 0.6)); gate = float(params.get("gateVoltage", 0))
    if not all(math.isfinite(value) for value in (interval, total, step, fixed, gate)) or interval <= 0 or total <= 0 or step <= 0:
        raise ValueError("Oscillating pulse interval, total time and amplitude step must be positive finite values")
    count = max(0, int(math.ceil(total / interval)) - 1)
    if count > 100_000: raise ValueError("Oscillating pulse waveform exceeds the 100000-row safety limit")
    rows = []
    magnitude = step
    sign = 1.0
    for index in range(count):
        moment = (index + 1) * interval
        if index % 2 == 0:
            rows.append({"time_s": moment, "port1_V": 0.0, "port2_V": fixed, "port3_V": gate})
        else:
            rows.append({"time_s": moment, "port1_V": sign * magnitude, "port2_V": 0.0, "port3_V": gate})
            # Advance the magnitude only after a full ±half-cycle so the ramp stays
            # symmetric: +step, -step, +2*step, -2*step, … (previously the negative
            # half was always one step larger than the positive one).
            if sign > 0:
                sign = -1.0
            else:
                sign = 1.0
                magnitude += step
    return pd.DataFrame(rows, columns=["time_s", "port1_V", "port2_V", "port3_V"])


def _pulse_combine_channels(inputs: dict[str, Any], params: dict[str, Any]) -> pd.DataFrame:
    time_name, voltage_name = str(params.get("timeColumn", "time_s")), str(params.get("voltageColumn", "voltage_V"))
    columns = {"drain": "Vd_V", "source": "Vs_V", "gate": "Vg_V"}
    prepared: list[pd.DataFrame] = []
    for port, output_column in columns.items():
        table = inputs.get(port)
        if table is None: continue
        table = _require_table(table, f"Pulse {port} waveform")
        time_column, voltage_column = _resolve_column(table, time_name), _resolve_column(table, voltage_name)
        prepared.append(pd.DataFrame({"time_s": pd.to_numeric(table[time_column], errors="coerce"), output_column: pd.to_numeric(table[voltage_column], errors="coerce")}).dropna(subset=["time_s"]).sort_values("time_s"))
    if not prepared: raise ValueError("Combine Vd / Vs / Vg requires at least one waveform")
    merged = pd.DataFrame({"time_s": sorted(set().union(*(set(frame["time_s"]) for frame in prepared)))})
    for frame in prepared: merged = pd.merge_asof(merged, frame, on="time_s", direction="backward")
    # bfill() fills the leading samples (earlier than any waveform timestamp) with
    # the first known value instead of silently forcing them to 0 via fillna(0).
    return merged.ffill().bfill().fillna(0).reset_index(drop=True)


def _pulse_segment_measurement(inputs: dict[str, Any], params: dict[str, Any]) -> pd.DataFrame:
    measurement = _require_table(inputs.get("measurement"), "Pulse measurement")
    waveform = _require_table(inputs.get("waveform"), "Pulse waveform")
    measured_time = _resolve_column(measurement, params.get("measurementTimeColumn", "time"))
    current = _resolve_column(measurement, params.get("currentColumn", "current"))
    waveform_time = _resolve_column(waveform, params.get("waveformTimeColumn", "time_s"))
    waveform_voltage = _resolve_column(waveform, params.get("waveformVoltageColumn", "voltage_V"))
    leading, trailing = int(params.get("dropLeadingRows", 0)), int(params.get("dropTrailingRows", 0))
    if leading < 0 or trailing < 0: raise ValueError("Pulse segment row trimming must not be negative")
    samples = pd.DataFrame({"time": pd.to_numeric(measurement[measured_time], errors="coerce"), "current": pd.to_numeric(measurement[current], errors="coerce")}).dropna().sort_values("time")
    events = waveform.copy()
    events["_time"] = pd.to_numeric(events[waveform_time], errors="coerce")
    events["_voltage"] = pd.to_numeric(events[waveform_voltage], errors="coerce")
    events = events.dropna(subset=["_time"]).sort_values("_time").reset_index(drop=True)
    if events.empty: raise ValueError("Pulse waveform contains no valid time values")
    rows: list[dict[str, Any]] = []
    times = samples["time"].to_numpy()
    for index, event in events.iterrows():
        start = int(np.searchsorted(times, event["_time"], side="left"))
        end_time = float(events.iloc[index + 1]["_time"]) if index + 1 < len(events) else math.inf
        end = int(np.searchsorted(times, end_time, side="left"))
        raw_segment = samples.iloc[start:end]["current"]
        trimmed = raw_segment.iloc[leading: None if trailing == 0 else -trailing]
        if (leading or trailing) and len(trimmed) == 0 and len(raw_segment) > 0:
            raise ValueError(f"Pulse segment {index} has only {len(raw_segment)} samples, fewer than the {leading + trailing} rows to drop; reduce dropLeadingRows/dropTrailingRows")
        segment = trimmed.dropna()
        rows.append({"sequence": int(event.get("sequence", index)), "phase": str(event.get("phase", "pulse")), "waveform_time_s": float(event["_time"]), "voltage_V": float(event["_voltage"]), "sample_count": int(len(segment)), "mean_current_A": float(segment.mean()) if len(segment) else math.nan})
    return pd.DataFrame(rows)


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


def _execute_node(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    table_result: pd.DataFrame | None = None
    plot_result: str | None = None
    export_result: str | None = None

    def selected_file() -> dict[str, Any]:
        if not input_files: raise ValueError("该读取节点需要先选择或拖入文件")
        index = int(params.get("fileIndex", 0))
        if index < 0 or index >= len(input_files): raise ValueError(f"文件序号 {index} 超出范围；当前共 {len(input_files)} 个文件")
        return input_files[index]

    if node_type == "io.read_text":
        value = str(selected_file().get("text", ""))
    elif node_type == "io.read_json":
        value = _decode_json_compatible(str(selected_file().get("text", "")), "JSON 文件")
    elif node_type == "io.read_table":
        item = selected_file(); text = str(item.get("text", "")); name = str(item.get("name", "")).lower()
        if name.endswith(".json"):
            decoded = _decode_json_compatible(text, "JSON 表格")
            value = pd.DataFrame(decoded if isinstance(decoded, list) else [decoded])
        else:
            separator = str(params.get("separator", "auto"))
            if separator == "auto": separator = "\t" if name.endswith((".tsv", ".dat")) and "\t" in text.partition("\n")[0] else None
            value = pd.read_csv(io.StringIO(text), sep=separator, engine="python" if separator is None else "c", header=0 if _as_bool(params.get("header", True)) else None)
        table_result = value
    elif node_type == "io.read_image":
        item = selected_file(); encoded = str(item.get("base64", ""))
        if not encoded: raise ValueError("图片读取需要原始二进制内容；请重新选择图片文件")
        image = plt.imread(io.BytesIO(base64.b64decode(encoded)))
        figure, axis = plt.subplots(figsize=(8, 6)); axis.imshow(image); axis.axis("off")
        buffer = io.BytesIO(); figure.savefig(buffer, format="png", dpi=120, bbox_inches="tight"); plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii"); value = figure
    elif node_type == "io.read_csv":
        value = _read_csv(csv_text, params)
        table_result = value
    elif node_type == "io.read_csv_batch":
        value = _read_csv_batch(input_files, params)
        table_result = value
    elif node_type == "generate.empty_list":
        value = []
    elif node_type == "generate.empty_table":
        raw_columns = params.get("columns", "")
        if isinstance(raw_columns, list):
            columns = [str(item).strip() for item in raw_columns if str(item).strip()]
        else:
            text = str(raw_columns or "").strip()
            if text.startswith("["):
                try:
                    decoded = json.loads(text)
                    columns = [str(item).strip() for item in decoded] if isinstance(decoded, list) else []
                except Exception:
                    columns = [item.strip() for item in text.split(",") if item.strip()]
            else:
                columns = [item.strip() for item in text.split(",") if item.strip()]
        value = pd.DataFrame(columns=columns)
        table_result = value
    elif node_type == "generate.random_table":
        count = int(params.get("count", 100))
        if count < 1 or count > 1_000_000:
            raise ValueError("Random table count must be between 1 and 1,000,000")
        distribution = str(params.get("distribution", "uniform"))
        seed = int(params.get("seed", 0))
        rng = np.random.default_rng(seed)
        if distribution == "normal":
            mean = float(params.get("mean", 0))
            std = float(params.get("std", 1))
            if std < 0:
                raise ValueError("Random normal std must be non-negative")
            values = rng.normal(mean, std, size=count)
        elif distribution == "integer":
            minimum = int(float(params.get("min", 0)))
            maximum = int(float(params.get("max", 1)))
            if maximum < minimum:
                raise ValueError("Random integer max must be greater than or equal to min")
            values = rng.integers(minimum, maximum + 1, size=count)
        else:
            minimum = float(params.get("min", 0))
            maximum = float(params.get("max", 1))
            if maximum < minimum:
                raise ValueError("Random uniform max must be greater than or equal to min")
            values = rng.uniform(minimum, maximum, size=count)
        index_column = str(params.get("indexColumn", "index") or "index").strip() or "index"
        value_column = str(params.get("valueColumn", "value") or "value").strip() or "value"
        if index_column == value_column:
            raise ValueError("Random table indexColumn and valueColumn must be different")
        value = pd.DataFrame({index_column: np.arange(count), value_column: values})
        table_result = value
    elif node_type == "table.concat":
        axis = int(params.get("axis", 0))
        if axis not in {0, 1}:
            raise ValueError("Concat axis must be 0 or 1")
        value = pd.concat(
            [upstream["left"], upstream["right"]],
            axis=axis,
            ignore_index=_as_bool(params.get("ignoreIndex", axis == 0)),
        )
        table_result = value
    elif node_type == "table.select_columns":
        table = _require_table(upstream, "Select columns")
        value = table.iloc[:, _parse_columns(params.get("columns"), len(table.columns))]
        table_result = value
    elif node_type == "table.absolute":
        value = _require_table(upstream, "Absolute value").abs()
        table_result = value
    elif node_type == "table.transpose":
        value = _require_table(upstream, "Transpose").transpose().reset_index(drop=True)
        table_result = value
    elif node_type == "table.slice":
        table = _require_table(upstream, "Slice")
        def slice_part(prefix: str) -> slice:
            start = params.get(f"{prefix}Start")
            stop = params.get(f"{prefix}Stop")
            step = int(params.get(f"{prefix}Step", 1) or 1)
            if step == 0: raise ValueError("Slice step cannot be zero")
            return slice(None if start in {None, ""} else int(start), None if stop in {None, ""} else int(stop), step)
        value = table.iloc[slice_part("row"), slice_part("column")].copy()
        table_result = value
    elif node_type == "table.reset_index":
        value = _require_table(upstream, "Reset index").reset_index(drop=_as_bool(params.get("drop", True)))
        table_result = value
    elif node_type == "table.periodic_window":
        table = _require_table(upstream, "Periodic window")
        group_size = int(params.get("groupSize", 75)); count = int(params.get("count", 25))
        if group_size < 1 or count < 1: raise ValueError("Periodic window sizes must be positive")
        position = str(params.get("position", "start"))
        offset = group_size - count if position == "end" else int(params.get("offset", 0)) if position == "offset" else 0
        rows = [row for base in range(0, len(table), group_size) for row in range(base + offset, min(base + offset + count, len(table)))]
        value = table.iloc[rows].reset_index(drop=True)
        table_result = value
    elif node_type == "table.periodic_tail_mean":
        table = _require_table(upstream, "Periodic tail mean")
        group_size = int(params.get("groupSize", 25)); tail_rows = int(params.get("tailRows", 10))
        if group_size < 1 or tail_rows < 1: raise ValueError("Periodic mean sizes must be positive")
        chunks = [table.iloc[start:start + group_size].tail(tail_rows).mean(numeric_only=True) for start in range(0, len(table), group_size) if len(table.iloc[start:start + group_size])]
        value = pd.DataFrame(chunks).reindex(columns=table.select_dtypes(include="number").columns)
        table_result = value
    elif node_type == "table.sort_index":
        value = _require_table(upstream, "Sort index").sort_index(axis=int(params.get("axis", 0)), ascending=_as_bool(params.get("ascending", True)))
        table_result = value
    elif node_type == "table.difference":
        table = _require_table(upstream, "Difference")
        value = table.diff(periods=int(params.get("periods", 1)), axis=int(params.get("axis", 0)))
        table_result = value
    elif node_type == "table.filter_range":
        value = _filter_range(_require_table(upstream, "Range filter"), params)
        table_result = value
    elif node_type == "table.rename_columns":
        value = _rename_columns(_require_table(upstream, "Rename columns"), params.get("names"))
        table_result = value
    elif node_type == "table.pivot":
        table = _require_table(upstream, "Pivot")
        index = _resolve_columns(table, params.get("index")); columns = _resolve_columns(table, params.get("columns")); values = _resolve_columns(table, params.get("values"))
        if len(index) != 1 or len(columns) != 1 or len(values) != 1: raise ValueError("Pivot requires one row key, column key, and value column")
        aggregate = str(params.get("aggregate", "mean"))
        if aggregate not in {"mean", "first", "max", "min"}: raise ValueError("Unsupported pivot aggregate")
        value = table.pivot_table(index=index[0], columns=columns[0], values=values[0], aggfunc=aggregate).sort_index().sort_index(axis=1)
        value.columns = [str(column) for column in value.columns]
        if _as_bool(params.get("resetIndex", True)): value = value.reset_index()
        table_result = value
    elif node_type == "pandas.dropna":
        table = _require_table(upstream, "Drop missing values")
        how = str(params.get("how", "any"))
        if how not in {"any", "all"}:
            raise ValueError("Drop missing values supports only any or all")
        subset = _resolve_columns(table, params.get("subset")) or None
        value = table.dropna(how=how, subset=subset).reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.fillna":
        table = _require_table(upstream, "Fill missing values")
        method = str(params.get("method", "value"))
        if method == "forward":
            value = table.ffill()
        elif method == "backward":
            value = table.bfill()
        elif method == "value":
            value = table.fillna(_scalar_value(params.get("value", "0")))
        else:
            raise ValueError(f"Unsupported fill method: {method}")
        table_result = value
    elif node_type == "pandas.sort_values":
        table = _require_table(upstream, "Sort values")
        columns = _resolve_columns(table, params.get("columns"))
        if not columns:
            raise ValueError("Sort values requires at least one column")
        na_position = str(params.get("naPosition", "last"))
        if na_position not in {"first", "last"}:
            raise ValueError("naPosition must be first or last")
        value = table.sort_values(by=columns, ascending=_as_bool(params.get("ascending", True)), na_position=na_position).reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.head":
        value = _require_table(upstream, "Head").head(int(params.get("n", 5))).reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.tail":
        value = _require_table(upstream, "Tail").tail(int(params.get("n", 5))).reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.drop_duplicates":
        table = _require_table(upstream, "Drop duplicates")
        subset = _resolve_columns(table, params.get("subset")) or None
        keep_raw = str(params.get("keep", "first"))
        keep: Any = False if keep_raw == "false" else keep_raw
        value = table.drop_duplicates(subset=subset, keep=keep, ignore_index=_as_bool(params.get("ignoreIndex", True)))
        table_result = value
    elif node_type == "pandas.sample":
        table = _require_table(upstream, "Sample")
        fraction = _optional_float(params.get("fraction"))
        sample_kwargs: dict[str, Any] = {
            "replace": _as_bool(params.get("replace", False)),
            "random_state": int(params.get("randomState", 0)),
            "ignore_index": _as_bool(params.get("ignoreIndex", True)),
        }
        if fraction is None:
            sample_kwargs["n"] = int(params.get("n", 5))
        else:
            sample_kwargs["frac"] = fraction
        value = table.sample(**sample_kwargs)
        table_result = value
    elif node_type == "pandas.round":
        value = _require_table(upstream, "Round").round(decimals=int(params.get("decimals", 2)))
        table_result = value
    elif node_type == "pandas.describe":
        table = _require_table(upstream, "Describe")
        percentiles = [float(item) for item in _parameter_list(params.get("percentiles"))]
        include_text = str(params.get("include", "") or "").strip()
        exclude_text = str(params.get("exclude", "") or "").strip()
        include: Any = "all" if include_text == "all" else _parameter_list(include_text) or None
        exclude: Any = _parameter_list(exclude_text) or None
        value = table.describe(percentiles=percentiles or None, include=include, exclude=exclude).reset_index().rename(columns={"index": "statistic"})
        table_result = value
    elif node_type == "pandas.query":
        table = _require_table(upstream, "Query")
        expression = str(params.get("expression", "")).strip()
        if not expression:
            raise ValueError("Query expression is required")
        value = table.query(expression).reset_index(drop=True)
        table_result = value
    elif node_type == "logic.if_rows":
        table = _require_table(upstream, "Conditional branch")
        condition = str(params.get("condition", "")).strip()
        if not condition:
            raise ValueError("Conditional branch requires a condition")
        working = table.reset_index(drop=True)
        matching = working.query(condition)
        rejected = working.loc[~working.index.isin(matching.index)]
        outputs = {"true": matching.reset_index(drop=True), "false": rejected.reset_index(drop=True)}
        return outputs, outputs["true"], plot_result, export_result
    elif node_type == "logic.merge_rows":
        left = _require_table(upstream["left"], "Branch merge A")
        right = _require_table(upstream["right"], "Branch merge B")
        ignore_index = _as_bool(params.get("ignoreIndex", True))
        value = pd.concat([left, right], axis=0, ignore_index=ignore_index)
        if not ignore_index and _as_bool(params.get("sortIndex", False)):
            value = value.sort_index()
        table_result = value
    elif node_type == "logic.for_range":
        start = int(params.get("start", 0))
        stop = int(params.get("stop", 10))
        step = int(params.get("step", 1))
        if step == 0:
            raise ValueError("For range step must not be zero")
        values = list(range(start, stop, step))
        if len(values) > 100_000:
            raise ValueError("For range is limited to 100000 iterations")
        value = pd.DataFrame({"iteration": range(len(values)), "value": values})
        table_result = value
    elif node_type == "logic.while_number":
        current = float(params.get("start", 0))
        condition = str(params.get("condition", "value < 10")).strip()
        update = str(params.get("update", "value + 1")).strip()
        maximum = int(params.get("maxIterations", 100))
        if not condition or not update or maximum < 1 or maximum > 10_000:
            raise ValueError("While requires expressions and maxIterations between 1 and 10000")
        rows: list[dict[str, float | int]] = []
        for iteration in range(maximum):
            if not bool(_logic_expression(condition, current, iteration)):
                break
            rows.append({"iteration": iteration, "value": current})
            next_value = _logic_expression(update, current, iteration)
            if isinstance(next_value, bool):
                raise ValueError("While update expression must produce a number")
            current = float(next_value)
        else:
            if bool(_logic_expression(condition, current, maximum)):
                raise ValueError(f"While reached the safety limit of {maximum} iterations")
        value = pd.DataFrame(rows, columns=["iteration", "value"])
        table_result = value
    elif node_type in {"table.group_mean", "table.group_aggregate"}:
        if node_type == "table.group_mean":
            params = {**params, "method": "mean", "startRow": 0, "endRow": params.get("groupSize", 20)}
        value = _group_aggregate(_require_table(upstream, "Group aggregate"), params)
        table_result = value
    elif node_type == "table.groupby_aggregate":
        table = _require_table(upstream, "Groupby aggregate")
        group_by = _resolve_columns(table, params.get("groupBy"))
        if not group_by:
            raise ValueError("Groupby aggregate requires at least one grouping column")
        method = str(params.get("method", "mean"))
        if method not in {"mean", "median", "sum", "min", "max", "std", "count"}:
            raise ValueError(f"Unsupported groupby method: {method}")
        grouped = table.groupby(group_by, sort=True)
        if method == "count":
            value = grouped.size().reset_index(name="count")
        else:
            value = getattr(grouped, method)(numeric_only=True).reset_index()
        table_result = value
    elif node_type == "analysis.ter_matrix":
        value = _ter_matrix(_require_table(upstream, "TER matrix"), params)
        table_result = value
    elif node_type == "analysis.linear_fit":
        from scipy import stats
        table = _require_table(upstream, "Linear fit")
        x_column = _resolve_column(table, params.get("xColumn"))
        y_column = _resolve_column(table, params.get("yColumn"))
        x = pd.to_numeric(table[x_column], errors="coerce")
        y = pd.to_numeric(table[y_column], errors="coerce")
        mask = x.notna() & y.notna()
        if int(mask.sum()) < 2:
            raise ValueError("Linear fit requires at least two valid (x, y) points")
        slope, intercept, r_value, p_value, std_err = stats.linregress(x[mask], y[mask])
        value = pd.DataFrame({"slope": [slope], "intercept": [intercept], "r_value": [r_value], "p_value": [p_value], "std_err": [std_err]})
        table_result = value
    elif node_type == "pulse.generate_waveform":
        value = _pulse_waveform(params)
        table_result = value
    elif node_type == "pulse.generate_oscillating_ramp":
        value = _oscillating_pulse_ramp(params)
        table_result = value
    elif node_type == "pulse.combine_channels":
        value = _pulse_combine_channels(upstream, params)
        table_result = value
    elif node_type == "pulse.segment_measurement":
        value = _pulse_segment_measurement(upstream, params)
        table_result = value
    elif node_type == "plot.line":
        table = _require_table(upstream, "Line plot")
        x_column = _resolve_column(table, params["xColumn"]) if str(params.get("xColumn", "")).strip() else None
        y_columns = _resolve_columns(table, params.get("yColumns"))
        figure_width = float(params.get("figureWidth", 8))
        figure_height = float(params.get("figureHeight", 4.5))
        dpi = int(params.get("dpi", 120))
        if not 2 <= figure_width <= 30 or not 2 <= figure_height <= 30 or not 48 <= dpi <= 600:
            raise ValueError("Plot size or DPI is outside the supported range")
        figure, axis = plt.subplots(figsize=(figure_width, figure_height), dpi=dpi)
        try:
            table.plot(
                ax=axis,
                x=x_column,
                y=y_columns or None,
                logx=_as_bool(params.get("logX", False)),
                logy=_as_bool(params.get("logY", False)),
                legend=_as_bool(params.get("legend", True)),
                linestyle=str(params.get("lineStyle", "-")),
                marker=str(params.get("marker", "")) or None,
                linewidth=float(params.get("lineWidth", 1.5)),
            )
            title = str(params.get("title", "")).strip()
            x_label = str(params.get("xLabel", "")).strip()
            y_label = str(params.get("yLabel", "")).strip()
            if title:
                axis.set_title(title)
            if x_label:
                axis.set_xlabel(x_label)
            if y_label:
                axis.set_ylabel(y_label)
            axis.grid(_as_bool(params.get("grid", True)), alpha=0.25)
            _apply_scientific_notation(axis, params, x=True, y=True)
            figure.tight_layout()
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png")
        finally:
            plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = plot_result
    elif node_type in {"plot.scatter", "plot.bar", "plot.histogram", "plot.box", "plot.area"}:
        table = _require_table(upstream, node_type)
        kind = {"plot.scatter": "scatter", "plot.bar": "bar", "plot.histogram": "hist", "plot.box": "box", "plot.area": "area"}[node_type]
        x_column = _resolve_column(table, params["xColumn"]) if str(params.get("xColumn", "")).strip() else None
        y_columns = _resolve_columns(table, params.get("yColumns"))
        numeric = table.select_dtypes(include="number")
        if kind in {"hist", "box"} and numeric.empty: raise ValueError(f"{node_type} requires numeric columns")
        figure, axis = plt.subplots(figsize=(float(params.get("figureWidth", 8)), float(params.get("figureHeight", 4.5))), dpi=int(params.get("dpi", 120)))
        try:
            if kind == "scatter":
                if x_column is None or len(y_columns) != 1: raise ValueError("Scatter plot requires one X column and one Y column")
                table.plot(kind=kind, ax=axis, x=x_column, y=y_columns[0], s=float(params.get("pointSize", 24)), alpha=float(params.get("alpha", 0.8)))
            elif kind == "hist":
                numeric[y_columns] if y_columns else numeric
                (numeric[y_columns] if y_columns else numeric).plot(kind=kind, ax=axis, bins=int(params.get("bins", 20)), alpha=float(params.get("alpha", 0.8)))
            elif kind == "box":
                (numeric[y_columns] if y_columns else numeric).plot(kind=kind, ax=axis)
            else:
                table.plot(kind=kind, ax=axis, x=x_column, y=y_columns or None, legend=_as_bool(params.get("legend", True)), alpha=float(params.get("alpha", 0.85)))
            axis.set_title(str(params.get("title", "")))
            axis.set_xlabel(str(params.get("xLabel", "")))
            axis.set_ylabel(str(params.get("yLabel", "")))
            axis.grid(_as_bool(params.get("grid", True)), alpha=.25)
            _apply_scientific_notation(axis, params, x=True, y=True)
            figure.tight_layout()
            buffer = io.BytesIO(); figure.savefig(buffer, format="png")
        finally: plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = plot_result
    elif node_type == "plot.heatmap":
        table = _require_table(upstream, "Heatmap")
        label_raw = str(params.get("rowLabelColumn", "")).strip()
        label_column = _resolve_column(table, label_raw) if label_raw else None
        labels = table[label_column].astype(str).tolist() if label_column is not None else [str(item) for item in table.index]
        matrix = table.drop(columns=[label_column]) if label_column is not None else table
        matrix = matrix.apply(pd.to_numeric, errors="coerce")
        if matrix.empty or not matrix.notna().any().any():
            raise ValueError("Heatmap requires at least one numeric value column")
        figure_width = float(params.get("figureWidth", 9))
        figure_height = float(params.get("figureHeight", 6))
        dpi = int(params.get("dpi", 160))
        if not 2 <= figure_width <= 30 or not 2 <= figure_height <= 30 or not 48 <= dpi <= 600:
            raise ValueError("Heatmap size or DPI is outside the supported range")
        x_tick_interval = int(params.get("xTickInterval", 1))
        y_tick_interval = int(params.get("yTickInterval", 1))
        x_tick_rotation = float(params.get("xTickRotation", 45))
        if x_tick_interval < 1 or y_tick_interval < 1:
            raise ValueError("Heatmap tick intervals must be at least 1")
        if not 0 <= x_tick_rotation <= 360:
            raise ValueError("Heatmap X tick rotation must be between 0 and 360 degrees")
        origin = str(params.get("origin", "lower"))
        aspect = str(params.get("aspect", "auto"))
        interpolation = str(params.get("interpolation", "nearest"))
        if origin not in {"lower", "upper"} or aspect not in {"auto", "equal"} or interpolation not in {"nearest", "none", "bilinear", "bicubic"}:
            raise ValueError("Heatmap origin, aspect, or interpolation is unsupported")
        color_min = _optional_float(params.get("colorMin"))
        color_max = _optional_float(params.get("colorMax"))
        if color_min is not None and color_max is not None and color_min >= color_max:
            raise ValueError("Heatmap colorMin must be smaller than colorMax")
        figure, axis = plt.subplots(figsize=(figure_width, figure_height), dpi=dpi, constrained_layout=True)
        try:
            image = axis.imshow(
                matrix.to_numpy(dtype=float), aspect=aspect, origin=origin, interpolation=interpolation,
                cmap=str(params.get("colorMap", "viridis")), vmin=color_min, vmax=color_max,
            )
            x_positions = list(range(0, len(matrix.columns), x_tick_interval))
            y_positions = list(range(0, len(labels), y_tick_interval))
            axis.set_xticks(x_positions, [str(matrix.columns[index]) for index in x_positions], rotation=x_tick_rotation, ha="right")
            axis.set_yticks(y_positions, [labels[index] for index in y_positions])
            axis.set_title(str(params.get("title", "")).strip())
            axis.set_xlabel(str(params.get("xLabel", "")).strip())
            axis.set_ylabel(str(params.get("yLabel", "")).strip())
            if _as_bool(params.get("showColorBar", True)):
                colorbar = figure.colorbar(image, ax=axis, pad=0.02)
                colorbar.set_label(str(params.get("colorBarLabel", "")).strip())
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
        finally:
            plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = plot_result
    elif node_type == "io.export_csv":
        export_result = _require_table(upstream, "Export CSV").to_csv(index=False, lineterminator="\n")
        value = export_result
    elif node_type == "convert.to_text":
        value = _printable(upstream) if _as_bool(params.get("pretty", True)) else str(upstream)
    elif node_type == "convert.to_number":
        raw = _single_value(upstream)
        number = float(raw)
        value = _round_half_away(number) if _as_bool(params.get("integer", False)) else number
    elif node_type == "convert.to_boolean":
        raw = _single_value(upstream)
        if isinstance(raw, str):
            token = raw.strip().lower()
            if token in {"true", "1", "yes", "y", "是", "真"}: value = True
            elif token in {"false", "0", "no", "n", "否", "假", "", "none", "null"}: value = False
            else: raise ValueError(f"无法将文本 {raw!r} 转换为布尔值")
        else: value = bool(raw)
    elif node_type == "convert.to_table":
        if isinstance(upstream, pd.DataFrame): value = upstream.copy()
        elif isinstance(upstream, pd.Series): value = upstream.to_frame()
        elif _as_bool(params.get("csvText", False)) and isinstance(upstream, str): value = pd.read_csv(io.StringIO(upstream))
        elif isinstance(upstream, dict):
            try: value = pd.DataFrame(upstream)
            except ValueError: value = pd.DataFrame([upstream])
        elif isinstance(upstream, (list, tuple, np.ndarray)): value = pd.DataFrame(upstream)
        else: value = pd.DataFrame({"value": [upstream]})
        table_result = value
    elif node_type == "convert.table_to_records":
        value = _require_table(upstream, "Table to records").to_dict(orient="records")
    elif node_type == "convert.table_to_csv":
        value = _require_table(upstream, "Table to CSV").to_csv(index=_as_bool(params.get("includeIndex", False)), lineterminator="\n")
    elif node_type == "convert.json_parse":
        value = json.loads(str(upstream))
    elif node_type == "convert.json_stringify":
        value = json.dumps(upstream, ensure_ascii=False, indent=max(0, min(8, int(params.get("indent", 2)))), default=str)
    elif node_type == "python.len":
        value = len(upstream)
    elif node_type == "python.round":
        if not isinstance(upstream, (int, float)):
            raise ValueError("Python round requires a numeric input")
        value = _round_half_away(upstream, int(params.get("digits", 0)))
    elif node_type == "python.print":
        prefix = str(params.get("prefix", "")).strip()
        rendered = _printable(upstream, max(100, int(params.get("maxChars", 8000))), max(1, int(params.get("maxRows", 20))), str(params.get("format", "pretty")), _as_bool(params.get("includeType", True)), str(params.get("encoding", "utf-8")), str(params.get("encodingErrors", "replace")), str(params.get("bytesFormat", "decode")))
        # Keep the node a transparent tap in the workflow: it reports a bounded
        # printable value while passing the original object to downstream nodes.
        rendered = (f"{prefix}：" if prefix else "") + rendered + str(params.get("end", ""))
        return {"output": upstream, "__print__": rendered}, table_result, plot_result, export_result
    elif node_type == "ui.alert":
        content = upstream.get("content") if isinstance(upstream, dict) else upstream
        rendered = f"{str(params.get('title', '提示')).strip()}：{str(params.get('message', '')).strip()}"
        if content is not None:
            rendered += "\n" + _printable(content, 4000, 20, "pretty", True)
        response = params.get("response")
        reported = f"{rendered}\n选择：{response!r}"
        return {"output": response, "__print__": reported[:1000]}, table_result, plot_result, export_result
    elif node_type == "ui.input_dialog":
        raw_value = params.get("value", "")
        input_kind = str(params.get("inputKind", "text"))
        if input_kind == "number":
            try:
                value = float(raw_value)
                if value.is_integer(): value = int(value)
            except (TypeError, ValueError):
                raise ValueError("弹窗输入节点需要有效数值")
        elif input_kind == "boolean":
            value = _as_bool(raw_value)
        elif input_kind == "json":
            try: value = json.loads(str(raw_value))
            except json.JSONDecodeError as exception: raise ValueError(f"弹窗输入的 JSON 无效：{exception.msg}") from exception
        elif input_kind == "table":
            text = str(raw_value).strip()
            try:
                value = pd.DataFrame(json.loads(text))
            except (json.JSONDecodeError, TypeError, ValueError):
                value = pd.read_csv(io.StringIO(text), sep=None, engine="python")
            table_result = value
        else:
            value = str(raw_value)
    elif node_type == "variable.set":
        name = str(params.get("name", "")).strip()
        if not name: raise ValueError("Set variable requires a name")
        if variables is not None:
            variables[name] = upstream
        value = upstream
    elif node_type == "variable.get":
        name = str(params.get("name", "")).strip()
        if not name: raise ValueError("Get variable requires a name")
        if variables is None or name not in variables:
            raise ValueError(f"Variable {name!r} is not defined; add a 设置变量 node before reading it")
        value = variables[name]
    elif node_type == "custom.python_function":
        outputs = _execute_custom_function(str(params.get("code", "")), upstream, params)
        table_result = next((item for item in outputs.values() if isinstance(item, pd.DataFrame)), None)
        return outputs, table_result, plot_result, export_result
    else:
        raise ValueError(f"Unsupported node type: {node_type}")

    return {"output": value}, table_result, plot_result, export_result


def _execute_notebook_cell(source: str, namespace: dict[str, Any]) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    tree = ast.parse(source, mode="exec")
    last_expression = tree.body.pop().value if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    stream = io.StringIO()
    before_figures = set(plt.get_fignums())
    with redirect_stdout(stream), redirect_stderr(stream):
        exec(compile(tree, "<notebook-cell>", "exec"), namespace, namespace)
        value = eval(compile(ast.Expression(last_expression), "<notebook-cell>", "eval"), namespace, namespace) if last_expression is not None else None
    table = value if isinstance(value, pd.DataFrame) else next((namespace[name] for name in reversed(list(namespace)) if isinstance(namespace[name], pd.DataFrame)), None)
    figure = value if isinstance(value, plt.Figure) else None
    if figure is None:
        new_figures = [number for number in plt.get_fignums() if number not in before_figures]
        if new_figures: figure = plt.figure(new_figures[-1])
    plot = None
    if figure is not None:
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", dpi=120, bbox_inches="tight")
        plot = base64.b64encode(buffer.getvalue()).decode("ascii")
    for number in [item for item in plt.get_fignums() if item not in before_figures]:
        plt.close(number)
    text = stream.getvalue().strip()
    if value is not None and not isinstance(value, (pd.DataFrame, plt.Figure)):
        text = f"{text}\n{repr(value)}".strip()
    output = table if table is not None else value if value is not None else text
    return {"next": output, "output": output}, table, plot, None


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


def execute_workflow(workflow_json: str, csv_text: str, input_files_json: str = "[]") -> str:
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
        node_id = node["id"]
        if node_id in loop_body_ids:
            continue
        data = node.get("data", {})
        node_type = data.get("nodeType")
        params = data.get("parameters", {})
        node_started = time.perf_counter()
        try:
            if isinstance(params.get("notebookSource"), str):
                outputs, table_result, plot_result, export_result = _execute_notebook_cell(str(params["notebookSource"]), notebook_namespace)
            elif node_type == "notebook.code_cell":
                outputs, table_result, plot_result, export_result = _execute_notebook_cell(str(params.get("source", "")), notebook_namespace)
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
            node_results[node_id] = {"kind": "value", "text": str(outputs["__print__"])}
        elif plot_result is not None:
            node_results[node_id] = {"kind": "plot", "plotPngBase64": plot_result}
        elif table_result is not None:
            node_results[node_id] = {"kind": "table", "preview": _preview(table_result, limit=200)}
        elif export_result is not None:
            node_results[node_id] = {"kind": "value", "text": f"CSV · {len(export_result)} characters"}
        else:
            display = outputs.get("output", next(iter(outputs.values()), None))
            if display is not None:
                node_results[node_id] = {"kind": "value", "text": _printable(display, 4_000)}

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
