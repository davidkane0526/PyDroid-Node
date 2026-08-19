import json
from pathlib import Path

import pandas as pd
import pytest

from pydroid_flow.engine import (
    _clear_node_result_cache,
    _execute_node,
    _group_aggregate,
    _logic_expression,
    _node_result_cache,
    _pulse_combine_channels,
    _pulse_segment_measurement,
    _round_half_away,
    analyze_signature_json,
    execute_workflow,
    load_node_result_cache,
    save_node_result_cache,
)


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


def handled_edge(source, target, source_handle, target_handle=None):
    value = {"source": source, "target": target, "sourceHandle": source_handle}
    if target_handle:
        value["targetHandle"] = target_handle
    return value


def execute(nodes, edges, csv_text="1,10\n2,20\n3,30\n4,40\n"):
    return json.loads(execute_workflow(json.dumps({"nodes": nodes, "edges": edges}), csv_text))


def test_cross_runtime_source_generators_have_expected_python_shapes():
    outputs, table_result, _, _ = _execute_node("generate.empty_list", {}, None, "", [])
    assert outputs["output"] == []
    assert table_result is None

    outputs, table_result, _, _ = _execute_node("generate.empty_table", {"columns": "x,y"}, None, "", [])
    assert list(outputs["output"].columns) == ["x", "y"]
    assert outputs["output"].empty
    assert table_result is outputs["output"]

    first, first_table, _, _ = _execute_node("generate.random_table", {"count": 4, "seed": 7, "min": 0, "max": 1}, None, "", [])
    second, second_table, _, _ = _execute_node("generate.random_table", {"count": 4, "seed": 7, "min": 0, "max": 1}, None, "", [])
    assert list(first["output"].columns) == ["index", "value"]
    assert first_table.equals(second_table)
    assert first["output"].shape == (4, 2)
    assert first["output"]["value"].tolist() == pytest.approx([
        0.011704753153026104,
        0.06195825757458806,
        0.97690763277933,
        0.6990287057124078,
    ])


def test_native_random_source_connects_directly_to_print():
    result = execute(
        [node("random", "generate.random_table", {"count": 5, "seed": 1}), node("print", "python.print")],
        [edge("random", "print")],
    )
    assert result["status"] == "success"
    assert result["executionOrder"] == ["random", "print"]
    assert result["nodeResults"]["print"]["kind"] in {"table", "text", "value"}


def test_portable_sample_seed_has_locked_row_order():
    result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), node("sample", "pandas.sample", {"n": 3, "randomState": 42, "replace": False, "ignoreIndex": True})],
        [edge("read", "sample")],
        "x\n0\n1\n2\n3\n4\n5\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[5], [2], [3]]


def test_failure_keeps_completed_node_results_and_debug_trace():
    result = execute([node("read", "io.read_csv"), node("bad", "pandas.query", {"expression": "missing > 1"})], [edge("read", "bad")])
    assert result["status"] == "error"
    assert result["nodeId"] == "bad"
    assert result["executionOrder"] == ["read"]
    assert result["nodeResults"]["read"]["kind"] == "table"
    assert "Traceback" in result["debugTraceback"]


def test_general_file_readers_and_list_to_dataframe():
    files = json.dumps([{"name": "records.json", "text": '[{"a": 1}, {"a": 2}]'}])
    workflow = {"nodes": [node("json", "io.read_json", {"fileIndex": 0}), node("table", "convert.to_table")], "edges": [edge("json", "table")]}
    result = json.loads(execute_workflow(json.dumps(workflow), "", files))
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[1], [2]]


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


def test_read_csv_signature_parameters_control_parsing():
    result = execute(
        [node("read", "io.read_csv", {
            "separator": ";",
            "header": "infer",
            "useColumns": "time,signal",
            "dtype": '{"signal":"float64"}',
            "skipRows": 1,
            "nRows": 2,
            "naValues": "missing",
            "onBadLines": "error",
        })],
        [],
        "metadata\ntime;signal;ignored\n0;1.5;x\n1;missing;y\n2;3.5;z\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["columns"] == ["time", "signal"]
    assert result["preview"]["rows"] == [[0, 1.5], [1, None]]


def test_read_csv_accepts_an_explicit_skiprows_list():
    result = execute(
        [node("read", "io.read_csv", {"skipRows": "0,2", "header": "none"})],
        [],
        "100,100\n1,10\n200,200\n2,20\n",
    )
    assert result["preview"]["rows"] == [[1, 10], [2, 20]]


def test_rename_columns_and_configurable_line_plot():
    result = execute(
        [
            node("read", "io.read_csv"),
            node("rename", "table.rename_columns", {"names": "time,signal"}),
            node(
                "plot",
                "plot.line",
                {
                    "xColumn": "time",
                    "yColumns": "signal",
                    "title": "Pulse train",
                    "xLabel": "Time (s)",
                    "yLabel": "Amplitude",
                    "legend": False,
                    "grid": True,
                    "lineStyle": "--",
                    "marker": "o",
                    "lineWidth": 2,
                    "figureWidth": 6,
                    "figureHeight": 4,
                    "dpi": 96,
                },
            ),
        ],
        [edge("read", "rename"), edge("rename", "plot")],
        "0,1\n1,3\n2,2\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["columns"] == ["time", "signal"]
    assert len(result["plotPngBase64"]) > 100


def test_rename_columns_validates_name_count():
    result = execute(
        [node("read", "io.read_csv"), node("rename", "table.rename_columns", {"names": "only-one"})],
        [edge("read", "rename")],
        "1,2\n",
    )
    assert result["status"] == "error"
    assert "Expected 2" in result["message"]


def test_common_pandas_nodes_are_composable():
    result = execute(
        [
            node("read", "io.read_csv"),
            node("rename", "table.rename_columns", {"names": "time,signal"}),
            node("drop", "pandas.dropna", {"how": "any", "subset": "signal"}),
            node("sort", "pandas.sort_values", {"columns": "signal", "ascending": False}),
            node("query", "pandas.query", {"expression": "signal >= 2"}),
        ],
        [edge("read", "rename"), edge("rename", "drop"), edge("drop", "sort"), edge("sort", "query")],
        "0,1\n1,\n2,3\n3,2\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["columns"] == ["time", "signal"]
    assert result["preview"]["rows"] == [[2, 3.0], [3, 2.0]]


def test_documented_pandas_registry_nodes_execute_and_report_node_results():
    result = execute(
        [
            node("read", "io.read_csv"),
            node("dedupe", "pandas.drop_duplicates", {"subset": "0", "keep": "last", "ignoreIndex": True}),
            node("head", "pandas.head", {"n": 2}),
            node("round", "pandas.round", {"decimals": 1}),
        ],
        [edge("read", "dedupe"), edge("dedupe", "head"), edge("head", "round")],
        "1,1.234\n1,9.876\n2,3.456\n3,7.891\n",
    )
    assert result["preview"]["rows"] == [[1, 9.9], [2, 3.5]]
    assert result["nodeResults"]["dedupe"]["kind"] == "table"
    assert result["nodeResults"]["head"]["preview"]["totalRows"] == 2


def test_describe_node_returns_a_labeled_statistics_table():
    result = execute(
        [node("read", "io.read_csv"), node("describe", "pandas.describe", {"percentiles": "0.5"})],
        [edge("read", "describe")],
        "1,10\n2,20\n3,30\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["columns"][0] == "statistic"
    assert "mean" in [row[0] for row in result["preview"]["rows"]]


def test_python_builtin_len_reports_a_scalar_node_result():
    result = execute(
        [node("read", "io.read_csv"), node("length", "python.len")],
        [edge("read", "length")],
        "1,10\n2,20\n3,30\n",
    )
    assert result["status"] == "success"
    assert result["nodeResults"]["length"] == {"kind": "value", "text": "3", "value": 3}


def test_python_print_reports_text_and_preserves_the_original_table_for_downstream_nodes():
    result = execute(
        [node("read", "io.read_csv"), node("printed", "python.print", {"prefix": "input"}), node("head", "pandas.head", {"n": 1})],
        [edge("read", "printed"), edge("printed", "head")],
        "a,b\n1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["totalRows"] == 1
    assert result["nodeResults"]["printed"]["kind"] == "value"
    assert result["nodeResults"]["printed"]["text"].startswith("input：DataFrame · 3 行 × 2 列")


def test_python_print_decodes_bytes_with_the_configured_encoding():
    result = execute(
        [
            node("bytes", "notebook.code_cell", {"source": "payload = '中文'.encode('gbk')\npayload"}),
            node("printed", "python.print", {
                "includeType": False,
                "encoding": "gbk",
                "encodingErrors": "strict",
                "bytesFormat": "decode",
            }),
        ],
        [edge("bytes", "printed")],
    )
    assert result["status"] == "success"
    assert result["nodeResults"]["printed"]["text"] == "中文"


@pytest.mark.parametrize("response", [True, False, None])
def test_alert_returns_the_selected_response(response):
    result = execute([node("read", "io.read_csv"), node("alert", "ui.alert", {"title": "选择", "message": "继续吗", "response": response})], [])
    assert result["nodeResults"]["alert"] == {"kind": "value", "text": f"选择：继续吗\n选择：{response!r}", "value": response}


def test_conditional_branch_routes_true_and_false_ports():
    result = execute(
        [
            node("read", "io.read_csv"),
            node("rename", "table.rename_columns", {"names": "time,signal"}),
            node("branch", "logic.if_rows", {"condition": "signal >= 20"}),
            node("export", "io.export_csv"),
        ],
        [edge("read", "rename"), edge("rename", "branch"), handled_edge("branch", "export", "false")],
        "0,10\n1,20\n2,30\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[1, 20], [2, 30]]
    assert result["exportCsv"] == "time,signal\n0,10\n"


def test_logic_range_while_and_branch_merge_are_bounded_and_composable():
    ranged = execute([node("range", "logic.for_range", {"start": 2, "stop": 8, "step": 2})], [])
    assert ranged["preview"]["rows"] == [[0, 2], [1, 4], [2, 6]]

    looped = execute([node("while", "logic.while_number", {
        "start": 1, "condition": "value < 10 and iteration < 8", "update": "value * 2", "maxIterations": 20,
    })], [])
    assert looped["preview"]["rows"] == [[0, 1.0], [1, 2.0], [2, 4.0], [3, 8.0]]

    merged = execute(
        [
            node("read", "io.read_csv"),
            node("rename", "table.rename_columns", {"names": "time,signal"}),
            node("branch", "logic.if_rows", {"condition": "signal >= 20"}),
            node("merge", "logic.merge_rows", {"ignoreIndex": True, "sortIndex": False}),
        ],
        [
            edge("read", "rename"), edge("rename", "branch"),
            handled_edge("branch", "merge", "true", "left"),
            handled_edge("branch", "merge", "false", "right"),
        ],
        "0,10\n1,20\n2,30\n",
    )
    assert sorted(merged["preview"]["rows"]) == [[0, 10], [1, 20], [2, 30]]


def test_while_reports_safety_limit_and_heatmap_produces_a_plot():
    limited = execute([node("while", "logic.while_number", {
        "start": 0, "condition": "value >= 0", "update": "value + 1", "maxIterations": 3,
    })], [])
    assert limited["status"] == "error"
    assert "safety limit" in limited["message"]

    plotted = execute(
        [node("read", "io.read_csv"), node("heatmap", "plot.heatmap", {"rowLabelColumn": "0"})],
        [edge("read", "heatmap")],
        "0,1,2\n1,3,4\n",
    )
    assert plotted["status"] == "success"
    assert plotted["nodeResults"]["heatmap"]["kind"] == "plot"
    assert len(plotted["plotPngBase64"]) > 100

    configured = execute(
        [node("read", "io.read_csv"), node("heatmap", "plot.heatmap", {
            "rowLabelColumn": "0", "xTickInterval": 2, "yTickInterval": 2,
            "xTickRotation": 30, "origin": "upper", "aspect": "equal",
            "interpolation": "bilinear", "colorMin": 0, "colorMax": 10,
            "showColorBar": False,
        })],
        [edge("read", "heatmap")],
        "0,1,2,3\n1,3,4,5\n2,6,7,8\n",
    )
    assert configured["status"] == "success"
    assert configured["nodeResults"]["heatmap"]["kind"] == "plot"

    invalid_ticks = execute(
        [node("read", "io.read_csv"), node("heatmap", "plot.heatmap", {"xTickInterval": 0})],
        [edge("read", "heatmap")],
    )
    assert invalid_ticks["status"] == "error"
    assert "tick intervals" in invalid_ticks["message"]


def test_workflow_boundaries_return_structured_errors_and_dates_serialize():
    with pytest.raises(ValueError, match="nodes and edges must be JSON arrays"):
        execute_workflow('{"nodes": "bad", "edges": []}', "")

    with pytest.raises(ValueError, match="missing node"):
        execute_workflow(json.dumps({"nodes": [node("read", "io.read_csv")], "edges": [{"source": "read", "target": "missing"}]}), "")

    dated = execute(
        [node("read", "io.read_csv", {"header": "infer", "parseDates": "date"})],
        [],
        "date,value\n2026-08-12,1\n",
    )
    assert dated["status"] == "success"
    assert dated["preview"]["rows"][0][0] == "2026-08-12T00:00:00"


def test_for_subflow_executes_a_node_group_for_each_row():
    code = "def scale_row(table: 'table', factor: float = 2) -> 'table':\n    return table * factor"
    result = execute(
        [
            node("read", "io.read_csv"),
            node("loop", "logic.for_each_subflow", {"maxIterations": 10}),
            node("scale", "custom.python_function", {"code": code, "factor": 2}),
            node("export", "io.export_csv", {"fileName": "scaled.csv"}),
        ],
        [
            edge("read", "loop"),
            handled_edge("loop", "scale", "body", "table"),
            handled_edge("scale", "loop", "output", "continue"),
            handled_edge("loop", "export", "done", "input"),
        ],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[2.0, 4.0], [6.0, 8.0]]
    assert result["exports"][0]["fileName"] == "scaled.csv"


def test_while_subflow_repeats_body_until_query_is_false():
    code = "def increment(table: 'table') -> 'table':\n    return table + 1"
    result = execute(
        [
            node("read", "io.read_csv"),
            node("rename", "table.rename_columns", {"names": "value"}),
            node("loop", "logic.while_subflow", {"condition": "value < 5", "maxIterations": 10}),
            node("increment", "custom.python_function", {"code": code}),
        ],
        [
            edge("read", "rename"), edge("rename", "loop"),
            handled_edge("loop", "increment", "body", "table"),
            handled_edge("increment", "loop", "output", "continue"),
        ],
        "1\n6\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[5], [10]]


def test_ter_example_workflow_imports_and_executes_core_algorithm():
    example_path = Path(__file__).parents[2] / "examples" / "ter-matrix.workflow.json"
    workflow = json.loads(example_path.read_text(encoding="utf-8"))
    node_types = {node["data"]["nodeType"] for node in workflow["nodes"]}
    assert "workflow.group" in node_types
    assert "custom.python_function" not in node_types
    assert not any(node_type.startswith("notebook.") for node_type in node_types)
    files = [
        {"name": "vg=0v.csv", "text": "Instrument export\nVds,Current\n-1,-1e-6\n0,1e-12\n1,1e-6\n1,2e-6\n0,1e-12\n-1,-2e-6\n"},
        {"name": "vg=1v.csv", "text": "Instrument export\nVds,Current\n-1,-1e-6\n0,1e-12\n1,1e-6\n1,4e-6\n0,1e-12\n-1,-4e-6\n"},
    ]
    result = json.loads(execute_workflow(json.dumps(workflow), "", json.dumps(files)))
    assert result["status"] == "success"
    assert result["preview"]["columns"] == ["Vg_V", "-1.0", "1.0"]
    assert result["preview"]["totalRows"] == 2
    assert result["nodeResults"]["plot-ter-heatmap"]["kind"] == "plot"
    assert {item["fileName"] for item in result["exports"]} == {"TER_long.csv", "TER_matrix.csv"}


def test_pulse_nodes_generate_align_and_segment_measurements_without_code_cells():
    result = execute(
        [
            node("drain", "pulse.generate_waveform", {"voltageMax": 1, "voltageStep": 1, "readVoltage": 0, "pulseTime": 1, "readTime": 1, "cycles": 0.25, "ratio": 1}),
            node("gate", "pulse.generate_waveform", {"voltageMax": 1, "voltageStep": 1, "readVoltage": 0, "pulseTime": 1, "readTime": 1, "cycles": 0.25, "ratio": -1}),
            node("channels", "pulse.combine_channels"),
        ],
        [port_edge("drain", "channels", "drain"), port_edge("gate", "channels", "gate")],
    )
    assert result["preview"]["columns"] == ["time_s", "Vd_V", "Vg_V"]
    assert result["preview"]["rows"] == [[1.0, 0.0, 0.0], [2.0, 1.0, -1.0]]

    segmented = execute(
        [
            node("measurement", "io.read_csv", {"header": "infer"}),
            node("waveform", "pulse.generate_waveform", {"voltageMax": 1, "voltageStep": 1, "readVoltage": 0, "pulseTime": 1, "readTime": 1, "cycles": 0.25}),
            node("segments", "pulse.segment_measurement", {"measurementTimeColumn": "time", "currentColumn": "current", "dropLeadingRows": 0, "dropTrailingRows": 0}),
        ],
        [port_edge("measurement", "segments", "measurement"), port_edge("waveform", "segments", "waveform")],
        "time,current\n1.1,2\n1.5,4\n2.1,8\n2.5,12\n",
    )
    assert segmented["preview"]["columns"] == ["sequence", "phase", "waveform_time_s", "voltage_V", "sample_count", "mean_current_A"]
    assert segmented["preview"]["rows"] == [[0, "read", 1.0, 0.0, 2, 3.0], [0, "pulse", 2.0, 1.0, 2, 10.0]]


def test_batch_csv_extracts_vg_and_calculates_multi_file_ter():
    workflow = {
        "nodes": [
            node("batch", "io.read_csv_batch", {
                "header": "infer", "skipRows": 1, "useColumns": "0,1",
                "sourceColumn": "source_file", "metadataColumn": "Vg_V",
                "filenamePattern": r"vg\s*=\s*([-+]?\d+(?:\.\d+)?)\s*v", "onError": "error",
            }),
            node("ter", "analysis.ter_matrix", {
                "vgColumn": "Vg_V", "voltageColumn": "Vds", "currentColumn": "Current",
                "vmin": 0, "vmax": 0, "vstep": 0, "tolerance": 0,
                "currentFloor": 1e-15, "mode": "high-low",
            }),
        ],
        "edges": [edge("batch", "ter")],
    }
    files = [
        {"name": "vg=0v.csv", "text": "Instrument\nVds,Current\n-1,-1e-6\n0,1e-12\n1,1e-6\n1,2e-6\n0,1e-12\n-1,-2e-6\n"},
        {"name": "Vg = 1 V.csv", "text": "Instrument\nVds,Current\n-1,-1e-6\n0,1e-12\n1,1e-6\n1,4e-6\n0,1e-12\n-1,-4e-6\n"},
    ]
    result = json.loads(execute_workflow(json.dumps(workflow), "", json.dumps(files)))
    assert result["status"] == "success"
    assert result["preview"]["totalRows"] == 4
    assert sorted({row[0] for row in result["preview"]["rows"]}) == [0.0, 1.0]
    assert sorted({row[6] for row in result["preview"]["rows"]}) == [100.0, 300.0]


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


def test_custom_python_function_uses_annotated_ports_and_parameters():
    code = "def scale(table: 'table', factor: float = 1) -> 'table':\n    return table * factor"
    result = execute(
        [
            node("read", "io.read_csv"),
            node("scale", "custom.python_function", {"code": code, "factor": 2.5}),
        ],
        [port_edge("read", "scale", "table")],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[2.5, 5.0], [7.5, 10.0]]


def test_custom_python_function_supports_positional_only_and_keyword_only_parameters():
    code = "def scale(table: 'table', /, *, factor: float = 2) -> 'table':\n    return table * factor"
    result = execute(
        [
            node("read", "io.read_csv"),
            node("scale", "custom.python_function", {"code": code, "factor": 3}),
        ],
        [port_edge("read", "scale", "table")],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[3, 6], [9, 12]]


def test_analyze_signature_json_includes_positional_only_and_keyword_only_parameters():
    code = "def scale(table: 'table', /, value: float = 1, *, enabled: bool = True) -> 'table':\n    return table if enabled else table * value"
    result = json.loads(analyze_signature_json(code))
    assert [port["id"] for port in result["inputPorts"]] == ["table"]
    assert [parameter["key"] for parameter in result["parameters"]] == ["value", "enabled"]


def test_custom_python_function_rejects_imports():
    code = "def unsafe(table: 'table') -> 'table':\n    import os\n    return table"
    result = execute(
        [node("read", "io.read_csv"), node("unsafe", "custom.python_function", {"code": code})],
        [port_edge("read", "unsafe", "table")],
    )
    assert result["status"] == "error"
    assert "不能导入" in result["message"]


def test_custom_function_allows_whitelisted_imports():
    code = "def fit(table: 'table') -> 'table':\n    import statistics\n    return table + statistics.mean([1, 2, 3])"
    result = execute(
        [node("read", "io.read_csv"), node("fit", "custom.python_function", {"code": code})],
        [port_edge("read", "fit", "table")],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[3.0, 4.0], [5.0, 6.0]]


def test_custom_function_supports_optional_literal_and_list_parameters():
    code = """def choose(table: 'table', columns: list[int] = [0], mode: Literal['keep', 'drop'] = 'keep', limit: Optional[int] = None) -> 'table':
    selected = table.iloc[:, columns]
    if mode == 'drop':
        selected = table.drop(table.columns[columns], axis=1)
    return selected.iloc[:limit].reset_index(drop=True)
"""
    result = execute(
        [
            node("read", "io.read_csv"),
            node("choose", "custom.python_function", {"code": code, "columns": "[0, 2]", "mode": "keep"}),
        ],
        [port_edge("read", "choose", "table")],
        "1,2,3\n4,5,6\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[1, 3], [4, 6]]


def test_custom_tuple_outputs_are_routed_by_source_handle():
    code = """def split(table: 'table', left_columns: list[int] = [0]) -> tuple['table', 'table']:
    right_columns = [index for index in range(table.shape[1]) if index not in left_columns]
    return table.iloc[:, left_columns], table.iloc[:, right_columns]
"""
    result = execute(
        [
            node("read", "io.read_csv"),
            node("split", "custom.python_function", {"code": code, "left_columns": "0,2"}),
            node("export", "io.export_csv"),
        ],
        [
            port_edge("read", "split", "table"),
            handled_edge("split", "export", "output2"),
        ],
        "1,2,3\n4,5,6\n",
    )
    assert result["status"] == "success"
    assert result["exportCsv"] == "1\n2\n5\n"


def test_custom_named_outputs_are_routed_by_semantic_handle():
    code = """def split(table: 'table') -> tuple['selected:table', 'remaining:table']:
    return table.iloc[:, [0]], table.iloc[:, [1]]
"""
    result = execute(
        [
            node("read", "io.read_csv"),
            node("split", "custom.python_function", {"code": code}),
            node("export", "io.export_csv"),
        ],
        [port_edge("read", "split", "table"), handled_edge("split", "export", "remaining")],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["exportCsv"] == "1\n2\n4\n"


def test_notebook_code_cells_share_namespace_and_preview_last_table():
    result = execute(
        [
            node("one", "notebook.code_cell", {"source": "import pandas as pd\ndf = pd.DataFrame({'x': [1, 2, 3]})"}),
            node("two", "notebook.code_cell", {"source": "print('rows', len(df))\nclean = df.head(2)\nclean"}),
        ],
        [{"id": "order", "source": "one", "sourceHandle": "next", "target": "two", "targetHandle": "previous"}],
        "",
    )
    assert result["status"] == "success"
    assert result["preview"]["totalRows"] == 2
    assert result["nodeResults"]["two"]["kind"] == "table"


def test_notebook_code_cell_captures_last_scalar_expression():
    result = execute(
        [node("code", "notebook.code_cell", {"source": "import pandas as pd\ndf = pd.DataFrame({'x': [1]})\nanswer = 40 + 2\nanswer"})],
        [],
        "",
    )
    assert result["nodeResults"]["code"] == {"kind": "table", "preview": {"columns": ["x"], "rows": [[1]], "totalRows": 1, "totalColumns": 1}}


def test_ast_typed_nodes_execute_original_statements_in_notebook_order():
    result = execute(
        [
            node("read", "io.read_csv", {"notebookSource": "df = pd.DataFrame({'x': [1, None, 3]})", "notebookCellIndex": 0, "notebookOperationIndex": 1}),
            node("setup", "notebook.code_cell", {"notebookSource": "import pandas as pd", "notebookCellIndex": 0, "notebookOperationIndex": 0}),
            node("clean", "pandas.dropna", {"notebookSource": "clean = df.dropna()\nclean", "notebookCellIndex": 1, "notebookOperationIndex": 0}),
        ],
        [],
        "",
    )
    assert result["status"] == "success"
    assert result["preview"]["totalRows"] == 2


def test_labview_if_structure_executes_children_in_each_branch():
    structure = node("if", "logic.if_subflow", {"condition": "x >= 0"})
    true_child = node("positive", "table.absolute")
    true_child["parentId"] = "if"
    true_child["data"]["branch"] = "true"
    false_child = node("negative", "table.absolute")
    false_child["parentId"] = "if"
    false_child["data"]["branch"] = "false"
    result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), structure, true_child, false_child, node("merge", "logic.merge_rows")],
        [
            {"id": "a", "source": "read", "target": "if", "targetHandle": "input"},
            {"id": "b", "source": "if", "sourceHandle": "true", "target": "merge", "targetHandle": "left"},
            {"id": "c", "source": "if", "sourceHandle": "false", "target": "merge", "targetHandle": "right"},
        ],
        "x\n-2\n3\n",
    )
    assert result["status"] == "success"
    assert sorted(row[0] for row in result["preview"]["rows"]) == [2, 3]


def test_visual_structure_uses_internal_edges_for_data_flow():
    structure = node("if", "logic.if_subflow", {"condition": "x >= 0"})
    first = node("first", "table.absolute")
    first["parentId"], first["data"]["branch"] = "if", "true"
    second = node("second", "table.rename_columns", {"names": "value"})
    second["parentId"], second["data"]["branch"] = "if", "true"
    result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), structure, first, second],
        [
            {"id": "a", "source": "read", "target": "if", "targetHandle": "input"},
            {"id": "inside", "source": "first", "target": "second"},
        ],
        "x\n-2\n3\n",
    )
    assert result["status"] == "success"
    assert result["nodeResults"]["if"]["preview"]["columns"] == ["value"]


def test_visual_for_and_while_structures_execute_their_body_nodes():
    for_node = node("for", "logic.for_each_subflow", {"maxIterations": 10})
    for_child = node("for-abs", "table.absolute")
    for_child["parentId"], for_child["data"]["branch"] = "for", "body"
    for_result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), for_node, for_child],
        [{"id": "a", "source": "read", "target": "for", "targetHandle": "input"}],
        "x\n-2\n3\n",
    )
    assert for_result["status"] == "success"
    assert [row[0] for row in for_result["preview"]["rows"]] == [2, 3]

    while_node = node("while", "logic.while_subflow", {"condition": "x < 0", "maxIterations": 3})
    while_child = node("while-abs", "table.absolute")
    while_child["parentId"], while_child["data"]["branch"] = "while", "body"
    while_result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), while_node, while_child],
        [{"id": "b", "source": "read", "target": "while", "targetHandle": "input"}],
        "x\n-2\n3\n",
    )
    assert while_result["status"] == "success"
    assert [row[0] for row in while_result["preview"]["rows"]] == [2, 3]


def test_logic_control_demo_and_oscillating_pulse_examples_execute_without_code_nodes():
    examples = Path(__file__).parents[2] / "examples"
    logic = json.loads((examples / "logic-control-demo.workflow.json").read_text(encoding="utf-8"))
    assert not any(node["data"]["nodeType"].startswith("notebook.") or node["data"]["nodeType"] == "custom.python_function" for node in logic["nodes"])
    logic_result = json.loads(execute_workflow(json.dumps(logic), ""))
    assert logic_result["status"] == "success"
    assert logic_result["preview"]["totalRows"] == 7
    assert all(row[1] >= 0 for row in logic_result["preview"]["rows"])

    pulse = json.loads((examples / "periodic-oscillating-pulse.workflow.json").read_text(encoding="utf-8"))
    pulse_result = json.loads(execute_workflow(json.dumps(pulse), ""))
    assert pulse_result["status"] == "success"
    assert pulse_result["preview"]["columns"] == ["time_s", "port1_V", "port2_V", "port3_V"]
    assert pulse_result["preview"]["rows"][:4] == [[0.005, 0.0, 0.6, 0.0], [0.01, 0.2, 0.0, 0.0], [0.015, 0.0, 0.6, 0.0], [0.02, -0.2, 0.0, 0.0]]


def test_additional_plot_nodes_and_adaptive_dialog_values_execute():
    for plot_type, parameters in {
        "plot.scatter": {"xColumn": "iteration", "yColumns": "value"},
        "plot.bar": {"xColumn": "iteration", "yColumns": "value"},
        "plot.histogram": {"yColumns": "value", "bins": 4},
        "plot.box": {"yColumns": "value"},
        "plot.area": {"xColumn": "iteration", "yColumns": "value"},
    }.items():
        result = execute(
            [node("range", "logic.for_range", {"start": 1, "stop": 5, "step": 1}), node("plot", plot_type, parameters)],
            [{"id": "plot-edge", "source": "range", "sourceHandle": "output", "target": "plot", "targetHandle": "input"}],
        )
        assert result["status"] == "success", plot_type
        assert result["nodeResults"]["plot"]["kind"] == "plot"

    dialog = execute(
        [node("input", "ui.input_dialog", {"inputKind": "table", "value": "x,y\n1,2\n"}), node("alert", "ui.alert", {"response": True})],
        [{"id": "content", "source": "input", "sourceHandle": "output", "target": "alert", "targetHandle": "content"}],
    )
    assert dialog["status"] == "success"
    assert "DataFrame" in dialog["nodeResults"]["alert"]["text"]


def test_conversion_nodes_and_scalar_print_are_executable(capsys):
    workflow = {
        "nodes": [
            node("range", "logic.for_range", {"start": 1, "stop": 4, "step": 1}),
            node("records", "convert.table_to_records"),
            node("json", "convert.json_stringify", {"indent": 2}),
            node("print", "python.print", {"prefix": "records"}),
        ],
        "edges": [
            {"id": "a", "source": "range", "sourceHandle": "output", "target": "records", "targetHandle": "input"},
            {"id": "b", "source": "records", "sourceHandle": "output", "target": "json", "targetHandle": "input"},
            {"id": "c", "source": "json", "sourceHandle": "output", "target": "print", "targetHandle": "input"},
        ],
    }
    result = json.loads(execute_workflow(json.dumps(workflow), ""))
    assert result["status"] == "success"
    assert "records" in result["nodeResults"]["print"]["text"]
    assert result["preview"]["totalRows"] == 3
    assert capsys.readouterr().out == ""


def test_legacy_python_literal_workflow_is_parsed_without_ipc_crash():
    legacy = "{'nodes': [], 'edges': []}"
    result = json.loads(execute_workflow(legacy, ""))
    assert result["status"] == "success"


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


def test_each_print_node_keeps_its_own_captured_result():
    result = execute(
        [
            node("read", "io.read_csv", {"header": "infer"}),
            node("first-print", "python.print", {"prefix": "first"}),
            node("second-print", "python.print", {"prefix": "second"}),
        ],
        [edge("read", "first-print"), edge("first-print", "second-print")],
        "value\n1\n2\n",
    )
    assert result["status"] == "success"
    assert result["nodeResults"]["first-print"]["kind"] == "value"
    assert result["nodeResults"]["second-print"]["kind"] == "value"
    assert result["nodeResults"]["first-print"]["text"].startswith("first：DataFrame")
    assert result["nodeResults"]["second-print"]["text"].startswith("second：DataFrame")


def test_periodic_window_and_tail_mean_support_experiment_cycle_processing():
    result = execute(
        [
            node("read", "io.read_csv", {"header": "infer"}),
            node("window", "table.periodic_window", {"groupSize": 4, "position": "end", "count": 2}),
            node("mean", "table.periodic_tail_mean", {"groupSize": 2, "tailRows": 1}),
        ],
        [edge("read", "window"), edge("window", "mean")],
        "value\n1\n2\n3\n4\n5\n6\n7\n8\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[4.0], [8.0]]


def test_oscillating_pulse_ramp_amplitudes_grow_symmetrically():
    result = execute(
        [node("ramp", "pulse.generate_oscillating_ramp", {"interval": 0.005, "totalTime": 0.05, "amplitudeStep": 0.2, "fixedVoltage": 0.6, "gateVoltage": 0})],
        [],
    )
    assert result["status"] == "success"
    port1 = [row[1] for row in result["preview"]["rows"] if row[1] != 0.0]
    assert port1 == [0.2, -0.2, 0.4, -0.4]


def test_group_aggregate_resets_index_before_bucketing():
    frame = pd.DataFrame({"v": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]}, index=[100, 101, 102, 200, 201, 202])
    result = _group_aggregate(frame, {"groupSize": 3, "startRow": 0, "endRow": 3, "method": "mean"})
    assert result["v"].tolist() == [2.0, 5.0]


def test_round_half_away_from_zero():
    assert _round_half_away(2.5) == 3.0
    assert _round_half_away(3.5) == 4.0
    assert _round_half_away(-2.5) == -3.0
    assert _round_half_away(2.4) == 2.0
    assert _round_half_away(2.5, 1) == 2.5
    assert _round_half_away(0.15, 1) == 0.2


def test_logic_expression_short_circuits_division_by_zero():
    assert _logic_expression("value != 0 and 1 / value > 0.1", 0.0, 0) is False
    assert _logic_expression("value == 0 or 1 / value > 0.1", 0.0, 0) is True


def test_if_rows_handles_duplicate_index():
    frame = pd.DataFrame({"v": [1, 2, 3, 4]}, index=[0, 0, 1, 1])
    outputs, _, _, _ = _execute_node("logic.if_rows", {"condition": "v >= 2"}, frame, "", [])
    assert outputs["true"]["v"].tolist() == [2, 3, 4]
    assert outputs["false"]["v"].tolist() == [1]


def test_pulse_combine_channels_backfills_leading_samples():
    drain = pd.DataFrame({"time_s": [2.0, 4.0], "voltage_V": [1.0, 2.0]})
    gate = pd.DataFrame({"time_s": [3.0, 5.0], "voltage_V": [10.0, 20.0]})
    result = _pulse_combine_channels({"drain": drain, "gate": gate}, {"timeColumn": "time_s", "voltageColumn": "voltage_V"})
    assert result.iloc[0]["Vg_V"] == 10.0


def test_pulse_segment_measurement_rejects_over_trimming():
    measurement = pd.DataFrame({"time": [1.0, 2.0], "current": [1.0, 2.0]})
    waveform = pd.DataFrame({"time_s": [0.5], "voltage_V": [1.0]})
    with pytest.raises(ValueError):
        _pulse_segment_measurement(
            {"measurement": measurement, "waveform": waveform},
            {"measurementTimeColumn": "time", "currentColumn": "current", "waveformTimeColumn": "time_s", "waveformVoltageColumn": "voltage_V", "dropLeadingRows": 5, "dropTrailingRows": 0},
        )


def test_custom_function_namespace_exposes_numpy_and_math():
    code = "def scale(table: 'table', factor: float = 1) -> 'table':\n    return table * math.sqrt(factor) + np.full(table.shape, 1.0)"
    result = execute(
        [node("read", "io.read_csv"), node("scale", "custom.python_function", {"code": code, "factor": 4})],
        [port_edge("read", "scale", "table")],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[3.0, 5.0], [7.0, 9.0]]


def test_structure_branch_rejects_multiple_sinks():
    structure = node("if", "logic.if_subflow", {"condition": "x >= 0"})
    child_a = node("a", "table.absolute")
    child_a["parentId"], child_a["data"]["branch"] = "if", "true"
    child_b = node("b", "table.transpose")
    child_b["parentId"], child_b["data"]["branch"] = "if", "true"
    result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), structure, child_a, child_b],
        [{"id": "a", "source": "read", "target": "if", "targetHandle": "input"}],
        "x\n-2\n3\n",
    )
    assert result["status"] == "error"
    assert "one output node" in result["message"]


def test_variable_nodes_set_and_get_share_values():
    result = execute(
        [
            node("read", "io.read_csv", {"header": "infer"}),
            node("setv", "variable.set", {"name": "tbl"}),
            node("getv", "variable.get", {"name": "tbl"}),
            node("print", "python.print"),
        ],
        [
            {"id": "a", "source": "read", "target": "setv", "targetHandle": "input"},
            {"id": "b", "source": "setv", "target": "getv", "targetHandle": "previous"},
            {"id": "c", "source": "getv", "target": "print", "targetHandle": "input"},
        ],
        "x\n1\n2\n",
    )
    assert result["status"] == "success"
    assert "DataFrame" in result["nodeResults"]["print"]["text"]


def test_variable_get_reports_undefined_variable():
    result = execute([node("getv", "variable.get", {"name": "missing"})], [], "x\n1\n")
    assert result["status"] == "error"
    assert "not defined" in result["message"]


def test_custom_function_accepts_dict_parameter_and_ndarray_return():
    code = "def scale(table: 'table', config: dict = None) -> 'table':\n    factor = (config or {}).get('factor', 1)\n    return np.array(table) * factor"
    result = execute(
        [node("read", "io.read_csv"), node("fn", "custom.python_function", {"code": code, "config": '{"factor": 2}'})],
        [port_edge("read", "fn", "table")],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[2.0, 4.0], [6.0, 8.0]]


def test_custom_function_coerces_series_return_to_table():
    code = "def first_column(table: 'table') -> 'table':\n    return table.iloc[:, 0]"
    result = execute(
        [node("read", "io.read_csv"), node("fn", "custom.python_function", {"code": code})],
        [port_edge("read", "fn", "table")],
        "1,2\n3,4\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[1], [3]]


def test_analyze_signature_json_matches_frontend_shape():
    code = "def scale(table: 'table', factor: float = 1, mode: Literal['a', 'b'] = 'a', flags: list[int] = [0], config: dict = None) -> tuple['clean:table', 'rejected:table']:\n    return table, table"
    result = json.loads(analyze_signature_json(code))
    assert result["functionName"] == "scale"
    assert result["inputPorts"] == [{"id": "table", "label": "table", "valueType": "table", "required": True}]
    assert [parameter["key"] for parameter in result["parameters"]] == ["factor", "mode", "flags", "config"]
    assert result["parameters"][1]["kind"] == "select"
    assert result["parameters"][3]["kind"] == "textarea"
    assert result["outputPorts"] == [
        {"id": "clean", "label": "clean", "valueType": "table"},
        {"id": "rejected", "label": "rejected", "valueType": "table"},
    ]
    assert result["outputType"] == "table"


def test_execution_cache_reuses_unchanged_pure_nodes():
    _clear_node_result_cache()
    workflow = [node("read", "io.read_csv", {"header": "infer"}), node("abs", "table.absolute")]
    edges = [edge("read", "abs")]
    execute(workflow, edges, "x\n-1\n2\n")
    assert len(_node_result_cache) == 1  # 只有 table.absolute 可缓存，io.read_csv 不可缓存
    execute(workflow, edges, "x\n-1\n2\n")
    assert len(_node_result_cache) == 1  # 命中缓存，不新增条目


def test_execution_cache_recomputes_when_input_changes():
    _clear_node_result_cache()
    workflow = [node("read", "io.read_csv", {"header": "infer"}), node("abs", "table.absolute")]
    edges = [edge("read", "abs")]
    execute(workflow, edges, "x\n-1\n2\n")
    result = execute(workflow, edges, "x\n-5\n6\n")
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[5], [6]]


def test_execution_cache_round_trips_to_disk(tmp_path):
    _clear_node_result_cache()
    workflow = [node("read", "io.read_csv", {"header": "infer"}), node("abs", "table.absolute")]
    edges = [edge("read", "abs")]
    execute(workflow, edges, "x\n-1\n2\n")
    assert len(_node_result_cache) == 1
    cache_file = tmp_path / "execution-cache.json"
    save_node_result_cache(str(cache_file))
    _clear_node_result_cache()
    assert len(_node_result_cache) == 0
    load_node_result_cache(str(cache_file))
    assert len(_node_result_cache) == 1
    execute(workflow, edges, "x\n-1\n2\n")
    assert len(_node_result_cache) == 1  # 反序列化后的缓存命中，不新增条目


def test_custom_import_policy_is_platform_aware():
    import pydroid_flow.engine as engine
    engine._CUSTOM_ALLOW_ALL_IMPORTS = False  # 重置为移动端默认（避免 desktop_bridge 副作用污染）
    assert engine._import_root_allowed("statistics") is True
    assert engine._import_root_allowed("requests") is False  # 移动端白名单
    assert engine._import_root_allowed("os") is False  # 危险模块始终禁止
    engine.allow_all_custom_imports()
    try:
        assert engine._import_root_allowed("requests") is True  # 桌面端放宽
        assert engine._import_root_allowed("os") is False  # 危险模块仍禁止
        assert engine._import_root_allowed("subprocess") is False
    finally:
        engine._CUSTOM_ALLOW_ALL_IMPORTS = False


def test_groupby_aggregate_groups_by_column_values():
    result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), node("agg", "table.groupby_aggregate", {"groupBy": "Vg", "method": "mean"})],
        [edge("read", "agg")],
        "Vg,val\n1,10\n1,20\n2,30\n",
    )
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[1, 15.0], [2, 30.0]]


def test_linear_fit_computes_linregress_statistics():
    result = execute(
        [node("read", "io.read_csv", {"header": "infer"}), node("fit", "analysis.linear_fit", {"xColumn": "x", "yColumn": "y"})],
        [edge("read", "fit")],
        "x,y\n1,2\n2,4\n3,6\n",
    )
    assert result["status"] == "success"
    rows = result["preview"]["rows"][0]
    assert rows[0] == 2.0  # slope
    assert rows[1] == 0.0  # intercept
    assert abs(rows[2] - 1.0) < 1e-9  # r_value


def test_android_notebook_cancel_trace_interrupts_pure_python(monkeypatch):
    import sys
    import types
    from pydroid_flow import engine as engine_module

    class Cancellation:
        checks = 0

        @classmethod
        def isCancelled(cls, execution_id):
            cls.checks += 1
            return execution_id == "exec-cancel" and cls.checks >= 2

    com = types.ModuleType("com")
    dk = types.ModuleType("com.dk")
    pydroidflow = types.ModuleType("com.dk.pydroidflow")
    pydroidflow.PythonExecutionCancellation = Cancellation
    monkeypatch.setitem(sys.modules, "com", com)
    monkeypatch.setitem(sys.modules, "com.dk", dk)
    monkeypatch.setitem(sys.modules, "com.dk.pydroidflow", pydroidflow)

    def busy_python():
        total = 0
        for value in range(50_000):
            total += value
        return total

    with pytest.raises(KeyboardInterrupt, match="cancelled"):
        engine_module._run_with_cancel_trace("exec-cancel", busy_python)
