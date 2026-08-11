import json
from pathlib import Path

import pytest

from pydroid_flow.engine import execute_workflow


def node(node_id, node_type, parameters=None):
    return {
        "id": node_id,
        "data": {
            "nodeType": node_type,
            "parameters": parameters or {},
        },
    }


def edge(source, target):
    return {"source": source, "target": target}


def port_edge(source, target, target_handle):
    return {"source": source, "target": target, "targetHandle": target_handle}


def execute(nodes, edges, csv_text="1,10\n2,20\n3,30\n4,40\n"):
    return json.loads(execute_workflow(json.dumps({"nodes": nodes, "edges": edges}), csv_text))


def test_select_and_group_window_mean():
    result = execute(
        [
            node("read", "io.read_csv"),
            node("select", "table.select_columns", {"columns": "1"}),
            node(
                "group",
                "table.group_aggregate",
                {"groupSize": 2, "startRow": 0, "endRow": 2, "method": "mean"},
            ),
            node("export", "io.export_csv"),
        ],
        [edge("read", "select"), edge("select", "group"), edge("group", "export")],
    )
    assert result["preview"]["rows"] == [[15.0], [35.0]]
    assert result["exportCsv"] == "1\n15.0\n35.0\n"


def test_range_filter_and_absolute_value():
    result = execute(
        [
            node("read", "io.read_csv"),
            node("filter", "table.filter_range", {"column": 0, "min": 2, "max": 3}),
            node("absolute", "table.absolute"),
        ],
        [edge("read", "filter"), edge("filter", "absolute")],
        "-1,-10\n2,-20\n3,-30\n4,-40\n",
    )
    assert result["preview"]["rows"] == [[2, 20], [3, 30]]


def test_cycle_is_rejected():
    workflow = {
        "nodes": [node("a", "io.read_csv"), node("b", "table.absolute")],
        "edges": [edge("a", "b"), edge("b", "a")],
    }
    with pytest.raises(ValueError, match="must not contain cycles"):
        execute_workflow(json.dumps(workflow), "1,2\n")


def test_concat_accepts_two_named_inputs():
    result = execute(
        [
            node("read", "io.read_csv"),
            node("first", "table.select_columns", {"columns": "0"}),
            node("second", "table.select_columns", {"columns": "1"}),
            node("concat", "table.concat", {"axis": 1, "ignoreIndex": False}),
        ],
        [
            edge("read", "first"),
            edge("read", "second"),
            port_edge("first", "concat", "left"),
            port_edge("second", "concat", "right"),
        ],
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[1, 10], [2, 20], [3, 30], [4, 40]]


def test_node_error_identifies_the_failing_node():
    result = execute(
        [node("read", "io.read_csv"), node("bad-select", "table.select_columns", {"columns": "99"})],
        [edge("read", "bad-select")],
    )
    assert result["status"] == "error"
    assert result["nodeId"] == "bad-select"
    assert result["nodeType"] == "table.select_columns"
    assert "out of range" in result["message"]


def test_supplied_sample_csv_is_readable():
    sample = Path(__file__).parents[2] / "temp" / "data.csv"
    if not sample.exists():
        pytest.skip("User sample CSV is not present")
    result = execute(
        [node("read", "io.read_csv", {"skipRows": 2})],
        [],
        sample.read_text(encoding="utf-8-sig"),
    )
    assert result["preview"]["totalRows"] == 426
    assert result["preview"]["totalColumns"] == 200
