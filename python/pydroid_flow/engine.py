from __future__ import annotations

import base64
import io
import json
from collections import defaultdict, deque
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd


def _ordered_nodes(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])
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


def _upstream_value(node_id: str, workflow: dict[str, Any], values: dict[str, Any]) -> Any:
    sources = [
        edge["source"]
        for edge in workflow.get("edges", [])
        if edge["target"] == node_id
    ]
    if not sources:
        return None
    if len(sources) > 1:
        raise ValueError(f"Node {node_id} currently accepts only one table input")
    return values[sources[0]]


def _upstream_tables(node_id: str, workflow: dict[str, Any], values: dict[str, Any]) -> dict[str, pd.DataFrame]:
    incoming = [edge for edge in workflow.get("edges", []) if edge["target"] == node_id]
    ports: dict[str, pd.DataFrame] = {}
    fallback_ports = iter(("left", "right"))
    for edge in incoming:
        port = edge.get("targetHandle") or next(fallback_ports, "")
        if port not in {"left", "right"}:
            raise ValueError(f"Unknown concat input port: {port}")
        if port in ports:
            raise ValueError(f"Concat input {port} has more than one connection")
        ports[port] = _require_table(values[edge["source"]], f"Concat input {port}")
    if set(ports) != {"left", "right"}:
        raise ValueError("Concat requires both A and B table inputs")
    return ports


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


def _optional_float(raw: Any) -> float | None:
    if raw is None or str(raw).strip() == "":
        return None
    return float(raw)


def _as_bool(raw: Any) -> bool:
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)


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


def _preview(frame: pd.DataFrame, limit: int = 30) -> dict[str, Any]:
    head = frame.head(limit).copy()
    head = head.replace([float("inf"), float("-inf")], pd.NA)
    clean = head.astype(object).where(pd.notna(head), None)
    return {
        "columns": [str(column) for column in frame.columns],
        "rows": clean.values.tolist(),
        "totalRows": len(frame),
        "totalColumns": len(frame.columns),
    }


def _execute_node(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
) -> tuple[Any, pd.DataFrame | None, str | None, str | None]:
    table_result: pd.DataFrame | None = None
    plot_result: str | None = None
    export_result: str | None = None

    if node_type == "io.read_csv":
        value = pd.read_csv(io.StringIO(csv_text), header=None, skiprows=int(params.get("skipRows", 0)))
        value.columns = [str(index) for index in range(len(value.columns))]
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
    elif node_type == "table.difference":
        table = _require_table(upstream, "Difference")
        value = table.diff(periods=int(params.get("periods", 1)), axis=int(params.get("axis", 0)))
        table_result = value
    elif node_type == "table.filter_range":
        value = _filter_range(_require_table(upstream, "Range filter"), params)
        table_result = value
    elif node_type in {"table.group_mean", "table.group_aggregate"}:
        if node_type == "table.group_mean":
            params = {**params, "method": "mean", "startRow": 0, "endRow": params.get("groupSize", 20)}
        value = _group_aggregate(_require_table(upstream, "Group aggregate"), params)
        table_result = value
    elif node_type == "plot.line":
        table = _require_table(upstream, "Line plot")
        figure, axis = plt.subplots(figsize=(8, 4.5), dpi=120)
        table.plot(ax=axis, logy=_as_bool(params.get("logY", False)))
        axis.grid(True, alpha=0.25)
        figure.tight_layout()
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png")
        plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = plot_result
    elif node_type == "io.export_csv":
        export_result = _require_table(upstream, "Export CSV").to_csv(index=False, lineterminator="\n")
        value = export_result
    else:
        raise ValueError(f"Unsupported node type: {node_type}")

    return value, table_result, plot_result, export_result


def execute_workflow(workflow_json: str, csv_text: str) -> str:
    workflow = json.loads(workflow_json)
    values: dict[str, Any] = {}
    latest_table: pd.DataFrame | None = None
    plot_png: str | None = None
    export_csv: str | None = None

    for node in _ordered_nodes(workflow):
        node_id = node["id"]
        data = node.get("data", {})
        node_type = data.get("nodeType")
        params = data.get("parameters", {})
        try:
            upstream = (
                _upstream_tables(node_id, workflow, values)
                if node_type == "table.concat"
                else _upstream_value(node_id, workflow, values)
            )
            value, table_result, plot_result, export_result = _execute_node(
                node_type, params, upstream, csv_text
            )
        except Exception as exception:
            return json.dumps(
                {
                    "status": "error",
                    "nodeId": node_id,
                    "nodeType": node_type,
                    "message": str(exception),
                },
                ensure_ascii=False,
            )

        if table_result is not None:
            latest_table = table_result
        if plot_result is not None:
            plot_png = plot_result
        if export_result is not None:
            export_csv = export_result

        values[node_id] = value

    if latest_table is None:
        raise ValueError("Workflow did not produce a table")

    return json.dumps(
        {
            "status": "success",
            "preview": _preview(latest_table),
            "plotPngBase64": plot_png,
            "exportCsv": export_csv,
        },
        ensure_ascii=False,
        allow_nan=False,
    )
