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


def test_preserves_fully_annotated_function_definition_in_notebook_namespace():
    result = analyze_python_cell("def scale(table: 'table', factor: float = 2) -> 'table':\n    return table * factor\n")
    assert result["nodeType"] == "notebook.code_cell"
    assert result["recognized"] is True
    assert result["semantic"] is False
    assert result["parameters"]["source"].startswith("def scale")
    assert "workflowFunctionCode" in result["parameters"]
    assert result["defines"] == ["scale"]


def test_compiles_unannotated_function_to_any_typed_workflow_kernel_without_guessing_table():
    result = analyze_python_cell("def clean(data, factor=2):\n    return data * factor\n")
    assert result["nodeType"] == "notebook.code_cell"
    assert result["recognized"] is True
    code = result["parameters"]["workflowFunctionCode"]
    assert "data: 'Any'" in code
    assert "factor: 'Any'" in code
    assert "-> 'Any'" in code


def test_keeps_vararg_function_as_lossless_code_even_when_it_cannot_be_promoted():
    result = analyze_python_cell("def f(*args, **kwargs):\n    return args\n")
    assert result["recognized"] is True
    assert result["semantic"] is False
    assert result["nodeType"] == "notebook.code_cell"
    assert "workflowFunctionCode" not in result["parameters"]


def test_analyzes_ipynb_cells():
    raw = json.dumps({"cells": [{"cell_type": "code", "source": ["df = pd.read_csv('a.csv')\n"]}, {"cell_type": "markdown", "source": ["# note"]}]})
    result = json.loads(analyze_notebook_json(raw))
    assert result["cells"][0]["recognized"] is True
    assert result["cells"][1]["reason"] == "markdown"


def test_splits_compound_cell_into_classified_top_level_operations():
    result = analyze_python_cell("import pandas as pd\ndf = pd.read_csv('a.csv')\nfor value in range(3):\n    print(value)\n")
    assert [item["nodeType"] for item in result["operations"]] == ["notebook.code_cell", "io.read_csv", "notebook.code_cell"]
    assert result["operations"][1]["semantic"] is True
    assert result["operations"][2]["recognized"] is True
    assert result["operations"][2]["semantic"] is False


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


def test_lowers_matching_user_helpers_to_native_periodic_nodes_instead_of_function_calls():
    source = """def Pick_Upper(Data, splitrow=75, pickrow=25):
    deal = Data.iloc[[j for i in range(0, Data.shape[0] - 1, splitrow) for j in range(i, pickrow + i)]]
    return deal

def Split_count(Data, splitrow=50, sumrow=20):
    result = []
    for col in Data.columns:
        res = []
        count = 0
        for x in range(1, Data[col].shape[0]):
            if x % splitrow == 0:
                res.append(count / sumrow)
                count = 0
            if x + sumrow + 1 >= splitrow:
                count = count + Data.iloc[x, 0]
        result.append(res)
    return Data

picked = Pick_Upper(frame, 75, 25)
mean = Split_count(picked, 50, 20)
"""
    result = analyze_python_cell(source)
    assert result["operations"][2]["nodeType"] == "table.periodic_window"
    assert result["operations"][2]["kind"] == "BuiltinFunctionLowering"
    assert result["operations"][2]["parameters"]["notebookSourceFunctionName"] == "Pick_Upper"
    assert result["operations"][2]["parameters"]["notebookSourceFunctionId"] == result["operations"][0]["parameters"]["workflowFunctionId"]
    assert result["operations"][3]["nodeType"] == "table.periodic_tail_mean"
    assert result["operations"][3]["kind"] == "BuiltinFunctionLowering"
    assert result["operations"][3]["parameters"]["notebookSourceFunctionName"] == "Split_count"


def test_lowers_split_mean_style_helper_to_native_periodic_group_mean():
    source = """def Split_Mean(Data, SplitRow=50, StartRow=1, EndRow=50):
    result = pd.DataFrame()
    for i in range(0, len(Data), SplitRow):
        group = Data.iloc[i:i + SplitRow]
        average = group.iloc[StartRow - 1:EndRow - 1 + 1].mean()
        result = pd.concat([result, pd.DataFrame(average)], axis=0, ignore_index=True)
    return result

mean = Split_Mean(frame, 25, 15, 25)
"""
    result = analyze_python_cell(source)
    lowered = result["operations"][1]
    assert lowered["nodeType"] == "table.periodic_group_mean"
    assert lowered["parameters"]["groupSize"] == 25
    assert lowered["parameters"]["startRow"] == 15
    assert lowered["parameters"]["endRow"] == 25
    assert lowered["parameters"]["layout"] == "stacked"
    assert json.loads(lowered["parameters"]["notebookInputBindingsJson"]) == {"input": "frame"}


def test_lowers_dynamic_periodic_helper_arguments_to_native_parameter_bindings():
    source = """Read_sample = 25
Set_sample = 50
def Pick_Upper(Data, splitrow=75, skiprow=1, pickrow=25):
    skiprow = skiprow - 1
    deal = Data.iloc[[j for i in range(0, Data.shape[0] - 1, splitrow) for j in range(i + skiprow, pickrow + i + skiprow)]]
    return deal

picked = Pick_Upper(frame.iloc[:, 0:1], Read_sample + Set_sample, Read_sample, Set_sample)
"""
    result = analyze_python_cell(source)
    lowered = result["operations"][-1]
    assert lowered["nodeType"] == "table.periodic_window"
    assert lowered["parameters"]["position"] == "offset"
    assert json.loads(lowered["parameters"]["notebookExpressionInputsJson"]) == {"input": "frame.iloc[:, 0:1]"}
    assert json.loads(lowered["parameters"]["notebookParameterBindingsJson"]) == {"count": "Set_sample"}
    expressions = json.loads(lowered["parameters"]["notebookParameterExpressionsJson"])
    assert expressions["groupSize"] == "Read_sample + Set_sample"
    assert expressions["offset"] == "(Read_sample) - 1"


def test_lowers_common_scientific_helpers_to_general_native_nodes():
    source = """def Splite(Data, n):
    col = Data.columns
    ls_np = np.array_split(Data.values, n, axis=0)
    ls_df = [pd.DataFrame(i, columns=col) for i in ls_np]
    Temp = pd.DataFrame(ls_df[0], columns=col)
    for i in range(1, n):
        Temp = pd.concat([Temp, pd.DataFrame(ls_df[i], columns=col)], axis=1)
    return Temp

def get_cv_per_group(df, group_size=50):
    cv_list = []
    for start in range(0, df.shape[1], group_size):
        group_data = df.iloc[:, start:start + group_size]
        means = group_data.mean(axis=1)
        stds = group_data.std(axis=1, ddof=0)
        cv_list.append(pd.Series(np.where(means != 0, stds / means, np.nan), index=df.index))
    return cv_list

chunks = Splite(frame, chunk_count)
cvs = get_cv_per_group(chunks, group_size=group_size)
"""
    result = analyze_python_cell(source)
    chunks = result["operations"][-2]
    cvs = result["operations"][-1]
    assert chunks["nodeType"] == "table.row_chunks_to_columns"
    assert json.loads(chunks["parameters"]["notebookParameterBindingsJson"]) == {"chunks": "chunk_count"}
    assert cvs["nodeType"] == "stats.column_group_cv"
    assert json.loads(cvs["parameters"]["notebookParameterBindingsJson"]) == {"groupSize": "group_size"}


def test_lowers_consecutive_segment_helpers_to_sequence_nodes():
    source = """def all_consecutive_segments(nums):
    nums = sorted(set(nums))
    segments = []
    start = end = nums[0]
    for i in range(1, len(nums)):
        if nums[i] == nums[i - 1] + 1:
            end = nums[i]
        else:
            segments.append((start, end, end - start + 1))
            start = end = nums[i]
    segments.append((start, end, end - start + 1))
    return segments

def remove_short_segments(nums, min_length=3):
    nums = sorted(set(nums))
    result = []
    start = end = nums[0]
    for i in range(1, len(nums)):
        if nums[i] == nums[i - 1] + 1:
            end = nums[i]
        else:
            if end - start + 1 >= min_length:
                result.extend(range(start, end + 1))
            start = end = nums[i]
    if end - start + 1 >= min_length:
        result.extend(range(start, end + 1))
    return result

segments = all_consecutive_segments(numbers)
filtered = remove_short_segments(numbers, min_length=minimum)
"""
    result = analyze_python_cell(source)
    segments = result["operations"][-2]
    filtered = result["operations"][-1]
    assert segments["nodeType"] == "sequence.consecutive_segments"
    assert filtered["nodeType"] == "sequence.filter_short_segments"
    assert json.loads(filtered["parameters"]["notebookParameterBindingsJson"]) == {"minLength": "minimum"}


def test_same_named_helper_with_different_body_is_not_lowered_by_name_only():
    source = """def Pick_Upper(Data, splitrow=75, pickrow=25):
    return Data.head(pickrow)

picked = Pick_Upper(frame, 75, 25)
"""
    result = analyze_python_cell(source)
    assert result["operations"][1]["nodeType"] == "function.call"


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


def test_ast_keeps_python_if_as_lossless_code_instead_of_table_branch_semantics():
    result = analyze_python_cell("if voltage >= 0:\n    positive = frame.abs()\nelse:\n    negative = frame.round(2)\n")
    assert result["nodeType"] == "notebook.code_cell"
    assert result["semantic"] is False
    assert "标量控制流" in result["reason"]

    table_condition = analyze_python_cell("if frame['voltage'] >= 0:\n    positive = frame.abs()\n")
    assert table_condition["nodeType"] == "notebook.code_cell"
    assert table_condition["semantic"] is False


def test_maps_boolean_indexing_to_query_node():
    result = analyze_python_cell("data = data[(data['v'] > 5) & (data['v'] < 8)]")
    assert result["nodeType"] == "pandas.query"
    assert result["parameters"]["expression"] == "(`v` > 5) & (`v` < 8)"
    assert result["inputVariable"] == "data"


def test_maps_column_list_selection_to_select_columns():
    result = analyze_python_cell("subset = data[['time', 'voltage']]")
    assert result["nodeType"] == "table.select_columns"
    assert result["parameters"]["columns"] == "time,voltage"
    single = analyze_python_cell("first = data['time']")
    assert single["nodeType"] == "table.select_columns"
    assert single["parameters"]["columns"] == "time"


def test_maps_rename_to_rename_columns():
    result = analyze_python_cell("renamed = data.rename(columns={'0': 'time', '1': 'voltage'})")
    assert result["nodeType"] == "table.rename_columns"
    assert json.loads(result["parameters"]["names"]) == {"0": "time", "1": "voltage"}


def test_maps_plot_keyword_arguments():
    result = analyze_python_cell("data.plot(logy=True, legend=False, marker='o', linestyle='none', xlabel='x')")
    assert result["nodeType"] == "plot.line"
    assert result["parameters"]["logY"] is True
    assert result["parameters"]["legend"] is False
    assert result["parameters"]["marker"] == "o"
    assert result["parameters"]["lineStyle"] == "none"
    assert result["parameters"]["xLabel"] == "x"


def test_maps_groupby_chain_to_groupby_aggregate():
    result = analyze_python_cell("means = data.groupby('Vg').mean()")
    assert result["nodeType"] == "table.groupby_aggregate"
    assert result["parameters"]["groupBy"] == "Vg"
    assert result["parameters"]["method"] == "mean"


def test_maps_linregress_to_linear_fit():
    result = analyze_python_cell("fit = stats.linregress(data['x'], data['y'])")
    assert result["nodeType"] == "analysis.linear_fit"
    assert result["parameters"]["xColumn"] == "x"
    assert result["parameters"]["yColumn"] == "y"


def test_does_not_guess_file_path_parameter_type_for_notebook_function():
    result = analyze_python_cell("def read_data(file_path):\n    return file_path\n")
    assert result["nodeType"] == "notebook.code_cell"
    assert "file_path: 'Any'" in result["parameters"]["workflowFunctionCode"]


def test_infers_only_provable_user_function_port_types():
    table = analyze_python_cell("def load(path):\n    data = pd.read_csv(path)\n    return data\n")
    assert json.loads(table["parameters"]["workflowFunctionInputTypesJson"]) == ["any"]
    assert json.loads(table["parameters"]["workflowFunctionOutputTypesJson"]) == ["table"]
    assert "-> 'table'" in table["parameters"]["workflowFunctionCode"]

    scalar_unknown = analyze_python_cell("def ratio(a, b):\n    return a.mean() / b.mean()\n")
    assert json.loads(scalar_unknown["parameters"]["workflowFunctionOutputTypesJson"]) == ["any"]


def test_preserves_supported_explicit_function_annotations_as_workflow_types():
    result = analyze_python_cell("def format_value(value: float) -> str:\n    return str(value)\n")
    assert json.loads(result["parameters"]["workflowFunctionInputTypesJson"]) == ["number"]
    assert json.loads(result["parameters"]["workflowFunctionOutputTypesJson"]) == ["text"]
    assert "value: 'number'" in result["parameters"]["workflowFunctionCode"]
    assert "-> 'text'" in result["parameters"]["workflowFunctionCode"]


def test_infers_stable_tuple_output_types_without_guessing_unknown_members():
    result = analyze_python_cell("def pair():\n    return pd.DataFrame(), 1\n")
    assert json.loads(result["parameters"]["workflowFunctionOutputTypesJson"]) == ["table", "number"]
    code = result["parameters"]["workflowFunctionCode"]
    assert "output1:table" in code
    assert "output2:number" in code


def test_promotes_direct_user_function_call_with_literal_and_variable_inputs():
    raw = json.dumps({"cells": [{"cell_type": "code", "source": [
        "def clean(data, factor=2):\n",
        "    return data * factor\n",
        "df = pd.read_csv('a.csv')\n",
        "out = clean(df, 3)\n",
    ]}]})
    result = json.loads(analyze_notebook_json(raw))["cells"][0]
    call = result["operations"][2]
    assert call["nodeType"] == "function.call"
    assert call["parameters"]["functionId"] == "notebook-fn-1-1-clean"
    assert json.loads(call["parameters"]["notebookInputBindingsJson"]) == {"data": "df"}
    assert json.loads(call["parameters"]["notebookLiteralInputsJson"]) == {"factor": 3}
    assert call["defines"] == ["out"]


def test_promotes_safe_user_function_list_comprehension_to_function_map():
    raw = json.dumps({"cells": [{"cell_type": "code", "source": [
        "def measure(path, sign=1):\n",
        "    return path * sign\n",
        "paths = [1, 2, 3]\n",
        "values = [measure(path, 2) for path in paths]\n",
        "frame = pd.DataFrame([measure(path, 3) for path in paths])\n",
    ]}]})
    result = json.loads(analyze_notebook_json(raw))["cells"][0]
    list_map = result["operations"][2]
    table_map = result["operations"][3]
    assert list_map["nodeType"] == "function.map"
    assert list_map["parameters"]["mapInput"] == "path"
    assert list_map["parameters"]["collectMode"] == "list"
    assert json.loads(list_map["parameters"]["notebookInputBindingsJson"]) == {"path": "paths"}
    assert json.loads(list_map["parameters"]["notebookLiteralInputsJson"]) == {"sign": 2}
    assert table_map["nodeType"] == "function.map"
    assert table_map["parameters"]["collectMode"] == "table"


def test_keeps_complex_user_function_comprehension_as_lossless_python():
    raw = json.dumps({"cells": [{"cell_type": "code", "source": [
        "def measure(path):\n",
        "    return path\n",
        "paths = [1, 2, 3]\n",
        "values = [measure(path + 1) for path in paths]\n",
    ]}]})
    operation = json.loads(analyze_notebook_json(raw))["cells"][0]["operations"][2]
    assert operation["nodeType"] == "notebook.code_cell"
    assert operation["semantic"] is False


def test_promotes_exact_user_function_concat_loop_and_preserves_last_item_variable():
    raw = json.dumps({"cells": [{"cell_type": "code", "source": [
        "def DataProcess(item):\n",
        "    return pd.DataFrame({'value': [item]})\n",
        "items = [1, 2, 3]\n",
        "DataCount = pd.DataFrame()\n",
        "for item in items:\n",
        "    Data = DataProcess(item)\n",
        "    DataCount = pd.concat([DataCount, Data], axis=1)\n",
    ]}]})
    result = json.loads(analyze_notebook_json(raw))["cells"][0]
    loop = result["operations"][3]
    assert loop["nodeType"] == "function.map"
    assert loop["kind"] == "UserFunctionMapConcatColumns"
    assert loop["parameters"]["collectMode"] == "concat_columns"
    assert loop["parameters"]["concatInitialVariable"] == "DataCount"
    assert loop["parameters"]["lastItemVariable"] == "Data"
    assert json.loads(loop["parameters"]["notebookInputBindingsJson"]) == {"item": "items"}
    assert loop["defines"] == ["DataCount", "Data"]


def test_keeps_concat_loop_with_side_effect_as_lossless_python():
    raw = json.dumps({"cells": [{"cell_type": "code", "source": [
        "def DataProcess(item):\n",
        "    return pd.DataFrame({'value': [item]})\n",
        "for item in items:\n",
        "    Data = DataProcess(item)\n",
        "    print(item)\n",
        "    DataCount = pd.concat([DataCount, Data], axis=1)\n",
    ]}]})
    loop = json.loads(analyze_notebook_json(raw))["cells"][0]["operations"][1]
    assert loop["nodeType"] == "notebook.code_cell"
    assert loop["semantic"] is False


def test_keeps_generic_python_control_flow_as_lossless_code_instead_of_table_subflows():
    assert analyze_python_cell("if flag:\n    value = 1\n")["nodeType"] == "notebook.code_cell"
    assert analyze_python_cell("for item in items:\n    print(item)\n")["nodeType"] == "notebook.code_cell"
    assert analyze_python_cell("while ready:\n    ready = False\n")["nodeType"] == "notebook.code_cell"


def test_classifies_config_assignments_explicitly():
    assert "常量赋值" in analyze_python_cell("shift = 101")["reason"]
    assert "参数列表" in analyze_python_cell("N_List = [0.02, 0.04]")["reason"]
    assert "列表推导" in analyze_python_cell("Name = [f'{i}.csv' for i in N_List]")["reason"]
    assert "路径常量" in analyze_python_cell('Folder = r"D:\\data"')["reason"]


def test_marks_plt_show_as_plot_display_terminal():
    result = analyze_python_cell("plt.show()")
    assert result["recognized"] is False
    assert "绘图显示终点" in result["reason"]


def test_marks_multi_file_scan_loop():
    result = analyze_python_cell("for i in Name:\n    data = pd.read_csv(i)\n")
    assert result["recognized"] is True
    assert result["nodeType"] == "notebook.code_cell"
    assert result["semantic"] is False
    assert "多文件扫描" in result["reason"]


def test_notebook_analysis_keeps_cell_index_distinct_from_statement_index():
    raw = json.dumps({
        "cells": [
            {"cell_type": "code", "source": ["x = 1"]},
            {"cell_type": "markdown", "source": ["note"]},
            {"cell_type": "code", "source": ["y = 2"]},
            {"cell_type": "code", "source": ["z = 3\nw = 4"]},
        ]
    })
    cells = json.loads(analyze_notebook_json(raw))["cells"]
    assert [cell["index"] for cell in cells] == [0, 1, 2, 3]
    assert cells[2]["operations"][0]["index"] == 0
    assert [operation["index"] for operation in cells[3]["operations"]] == [0, 1]
