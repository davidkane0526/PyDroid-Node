import json

from pydroid_flow.notebook import analyze_notebook_json, analyze_python_cell


def test_recognizes_read_csv_and_dataframe_dependency():
    read = analyze_python_cell('df = pd.read_csv("data.csv", sep=";")')
    clean = analyze_python_cell('clean = df.dropna(how="all")')
    assert read["nodeType"] == "io.read_csv"
    assert read["outputVariable"] == "df"
    assert read["parameters"]["platformInput"] is True
    assert read["parameters"]["originalFileExpression"] == "'data.csv'"
    assert clean["nodeType"] == "pandas.dropna"
    assert clean["inputVariable"] == "df"
    assert clean["parameters"]["how"] == "all"


def test_classifies_every_statement_in_a_compound_cell_as_carrier_operations():
    result = analyze_python_cell("x = 1\ny = x + 2")
    assert result["recognized"] is False
    assert len(result["operations"]) == 2
    assert all(item["nodeType"] == "notebook.code_cell" for item in result["operations"])
    assert [item["source"] for item in result["operations"]] == ["x = 1", "y = x + 2"]


def test_marks_a_standalone_function_as_unmapped_instead_of_creating_a_code_node():
    result = analyze_python_cell("def scale(table: 'table', factor: float = 2) -> 'table':\n    return table * factor\n")
    assert result["nodeType"] == "notebook.code_cell"
    assert result["recognized"] is False
    assert result["reason"] == "需要可复用默认节点"


def test_analyzes_ipynb_cells():
    raw = json.dumps({"cells": [{"cell_type": "code", "source": ["df = pd.read_csv('a.csv')\n"]}, {"cell_type": "markdown", "source": ["# note"]}]})
    result = json.loads(analyze_notebook_json(raw))
    assert result["cells"][0]["recognized"] is True
    assert result["cells"][1]["reason"] == "markdown"


def test_splits_compound_cell_into_classified_top_level_operations():
    result = analyze_python_cell("import pandas as pd\ndf = pd.read_csv('a.csv')\nfor value in range(3):\n    print(value)\n")
    assert [item["nodeType"] for item in result["operations"]] == ["notebook.code_cell", "io.read_csv", "notebook.code_cell"]
    assert result["operations"][1]["semantic"] is True
    assert result["operations"][2]["recognized"] is False


def test_recognizes_chained_plot_and_clipboard_export():
    plot = analyze_python_cell("data.iloc[:, 1:].abs().plot(logy=True)")
    export = analyze_python_cell("data.to_clipboard(index=False)")
    assert plot["nodeType"] == "plot.line"
    assert plot["inputVariable"] == "data"
    assert export["nodeType"] == "io.export_csv"


def test_recognizes_common_experiment_table_operations_without_code_carriers():
    sliced = analyze_python_cell("sample = data.iloc[1::2, 0::2]")
    difference = analyze_python_cell("delta = sample.diff(periods=2)")
    reset = analyze_python_cell("ready = delta.reset_index(drop=True)")
    assert sliced["nodeType"] == "table.slice"
    assert sliced["parameters"]["rowStart"] == 1
    assert sliced["parameters"]["columnStep"] == 2
    assert difference["nodeType"] == "table.difference"
    assert reset["nodeType"] == "table.reset_index"


def test_recognizes_the_repeated_periodic_window_and_tail_mean_helpers():
    window = analyze_python_cell("picked = Pick_Upper(data, 75, 25)")
    summary = analyze_python_cell("mean = Split_count(picked, 25, 10)")
    assert window["nodeType"] == "table.periodic_window"
    assert window["parameters"]["position"] == "start"
    assert summary["nodeType"] == "table.periodic_tail_mean"


def test_marks_non_csv_file_readers_as_unmapped_until_a_default_input_node_exists():
    result = analyze_python_cell("frame = pd.read_excel(r'C:\\data\\input.xlsx')")
    assert result["nodeType"] == "notebook.code_cell"
    assert result["recognized"] is False
    assert "pandas.read_excel" in result["reason"]


def test_recognizes_periodic_oscillating_pulse_notebook_as_builtin_nodes():
    source = """pulse_duration = 0.005
total_time = 10
voltage_amplitude = 0.2
fixed_voltage = 0.6
time_points = np.arange(pulse_duration, total_time, pulse_duration)
port1_voltages, port2_voltages = [], []
port3_voltages = [0] * len(time_points)
current_amplitude = voltage_amplitude
for i, t in enumerate(time_points):
    if i % 2 == 0:
        port1_voltages.append(0)
        port2_voltages.append(fixed_voltage)
    else:
        port1_voltages.append(current_amplitude)
        port2_voltages.append(0)
        current_amplitude = -current_amplitude
        if i % 4 == 1:
            current_amplitude -= voltage_amplitude
for row in zip(time_points, port1_voltages, port2_voltages, port3_voltages):
    print(row)
"""
    result = analyze_python_cell(source)
    assert [operation["nodeType"] for operation in result["operations"]] == ["pulse.generate_oscillating_ramp", "python.print"]


def test_ast_recognizes_common_type_conversion_chains():
    result = analyze_python_cell("records = frame.to_dict(orient='records')\ntext = json.dumps(records)\nparsed = json.loads(text)\nnumber = float(value)\n")
    semantic = [operation["nodeType"] for operation in result["operations"] if operation.get("semantic")]
    assert semantic == ["convert.table_to_records", "convert.json_stringify", "convert.json_parse", "convert.to_number"]


def test_ast_does_not_claim_unmapped_assignment_is_a_node():
    result = analyze_python_cell("answer = left + right")
    assert result["recognized"] is False
    assert result["operations"][0]["reason"].startswith("尚未将")


def test_ast_maps_if_body_to_visual_structure_children():
    result = analyze_python_cell("if voltage >= 0:\n    positive = frame.abs()\nelse:\n    negative = frame.round(2)\n")
    assert result["nodeType"] == "logic.if_subflow"
    assert result["parameters"]["condition"] == "voltage >= 0"
    assert [child["branch"] for child in result["children"]] == ["true", "false"]
    assert [child["nodeType"] for child in result["children"]] == ["table.absolute", "pandas.round"]

    table_condition = analyze_python_cell("if frame['voltage'] >= 0:\n    positive = frame.abs()\n")
    assert table_condition["inputVariable"] == "frame"
    assert table_condition["parameters"]["condition"] == "`voltage` >= 0"
