from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

import pandas as pd

from .values import _require_table

_NOTEBOOK_VISUAL_EDGE_ROLES = {"notebook-order", "notebook-variable", "notebook-parameter", "notebook-provenance"}

def _is_data_edge(edge: dict[str, Any]) -> bool:
    data = edge.get("data")
    role = data.get("role") if isinstance(data, dict) else None
    return role not in _NOTEBOOK_VISUAL_EDGE_ROLES

def _data_edges(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    return [edge for edge in workflow.get("edges", []) if isinstance(edge, dict) and _is_data_edge(edge)]

def _ordered_nodes(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = workflow.get("nodes", [])
    edges = _data_edges(workflow)
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
    incoming = [edge for edge in _data_edges(workflow) if edge["target"] == node_id]
    if not incoming:
        return None
    if len(incoming) > 1:
        raise ValueError(f"Node {node_id} currently accepts only one table input")
    return _edge_value(incoming[0], values)

def _upstream_tables(node_id: str, workflow: dict[str, Any], values: dict[str, dict[str, Any]]) -> dict[str, pd.DataFrame]:
    incoming = [edge for edge in _data_edges(workflow) if edge["target"] == node_id]
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
    incoming = [edge for edge in _data_edges(workflow) if edge["target"] == node_id]
    inputs: dict[str, Any] = {}
    for edge in incoming:
        port = edge.get("targetHandle") or "input"
        if port in inputs:
            raise ValueError(f"Input {port} has more than one connection")
        inputs[port] = _edge_value(edge, values)
    return inputs

def _loop_body(workflow: dict[str, Any], loop_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    edges = _data_edges(workflow)
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
