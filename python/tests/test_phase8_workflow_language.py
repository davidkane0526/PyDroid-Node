import json

from pydroid_flow.engine import execute_workflow


def node(node_id, node_type, parameters=None):
    return {"id": node_id, "data": {"nodeType": node_type, "parameters": parameters or {}}}


def run(workflow, csv_text=""):
    return json.loads(execute_workflow(json.dumps(workflow), csv_text))


def test_workspace_state_survives_only_when_explicitly_round_tripped():
    writer = {
        "nodes": [
            node("read", "io.read_csv", {"header": "infer"}),
            node("length", "python.len"),
            node("set", "variable.set_workspace", {"name": "phase8_rows"}),
        ],
        "edges": [
            {"source": "read", "target": "length"},
            {"source": "length", "target": "set"},
        ],
    }
    written = run(writer, "x\n1\n2\n3\n")
    assert written["status"] == "success"
    assert written["workspaceState"] == {"phase8_rows": 3}

    reader = {
        "workspaceState": written["workspaceState"],
        "nodes": [node("get", "variable.get_workspace", {"name": "phase8_rows"})],
        "edges": [],
    }
    read_back = run(reader)
    assert read_back["status"] == "success"
    assert read_back["nodeResults"]["get"]["value"] == 3

    isolated = run({"nodes": reader["nodes"], "edges": []})
    assert isolated["status"] == "error"
    assert "phase8_rows" in isolated["message"]


def test_execution_variable_still_resets_between_runs():
    writer = {
        "nodes": [node("source", "logic.for_range", {"start": 0, "stop": 1, "step": 1}), node("set", "variable.set", {"name": "temp"})],
        "edges": [{"source": "source", "target": "set"}],
    }
    assert run(writer)["status"] == "success"
    result = run({"nodes": [node("get", "variable.get", {"name": "temp"})], "edges": []})
    assert result["status"] == "error"
    assert "temp" in result["message"]


def test_reusable_function_call_executes_with_stable_signature():
    definition = {
        "id": "fn-absolute",
        "name": "Absolute table",
        "version": 1,
        "inputs": [{"id": "table", "label": "Table", "valueType": "table", "internalNodeId": "abs", "internalHandle": "input"}],
        "outputs": [{"id": "result", "label": "Result", "valueType": "table", "internalNodeId": "abs", "internalHandle": "output"}],
        "nodes": [node("abs", "table.absolute")],
        "edges": [],
    }
    workflow = {
        "schemaVersion": 2,
        "functions": [definition],
        "nodes": [
            node("read", "io.read_csv", {"header": "infer"}),
            node("call", "function.call", {"functionId": "fn-absolute", "functionVersion": 1}),
        ],
        # Intentionally omit targetHandle to verify the one-input compatibility path.
        "edges": [{"source": "read", "target": "call"}],
    }
    result = run(workflow, "x\n-2\n3\n")
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[2], [3]]


def test_function_call_rejects_version_mismatch_and_recursion():
    mismatch = {
        "schemaVersion": 2,
        "functions": [{
            "id": "fn-one", "name": "One", "version": 2, "inputs": [],
            "outputs": [{"id": "result", "label": "Result", "valueType": "table", "internalNodeId": "range", "internalHandle": "output"}],
            "nodes": [node("range", "logic.for_range", {"start": 0, "stop": 1, "step": 1})], "edges": [],
        }],
        "nodes": [node("call", "function.call", {"functionId": "fn-one", "functionVersion": 1})], "edges": [],
    }
    result = run(mismatch)
    assert result["status"] == "error"
    assert "version mismatch" in result["message"]

    recursive_definition = {
        "id": "fn-rec", "name": "Recursive", "version": 1, "inputs": [],
        "outputs": [{"id": "result", "label": "Result", "valueType": "any", "internalNodeId": "self", "internalHandle": "output"}],
        "nodes": [node("self", "function.call", {"functionId": "fn-rec", "functionVersion": 1})], "edges": [],
    }
    recursive = {
        "schemaVersion": 2, "functions": [recursive_definition],
        "nodes": [node("call", "function.call", {"functionId": "fn-rec", "functionVersion": 1})], "edges": [],
    }
    result = run(recursive)
    assert result["status"] == "error"
    assert "Recursive function call" in result["message"]


def test_python_notebook_cell_inside_function_uses_function_runtime_namespace():
    definition = {
        "id": "fn-notebook", "name": "Notebook", "version": 1, "inputs": [],
        "outputs": [{"id": "result", "label": "Result", "valueType": "table", "internalNodeId": "cell", "internalHandle": "output"}],
        "nodes": [node("cell", "notebook.code_cell", {"source": "pd.DataFrame({'x': [1, 2]})"})], "edges": [],
    }
    workflow = {
        "schemaVersion": 2, "functions": [definition],
        "nodes": [node("call", "function.call", {"functionId": "fn-notebook", "functionVersion": 1})], "edges": [],
    }
    result = run(workflow)
    assert result["status"] == "success"
    assert result["preview"]["rows"] == [[1], [2]]


def test_analyzed_notebook_bridges_code_native_code_through_shared_namespace():
    workflow = {
        "schemaVersion": 2,
        "nodes": [
            node("cell-source", "notebook.code_cell", {
                "source": "import pandas as pd\nframe = pd.DataFrame({'x': [1, None, 3]})",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 0,
            }),
            node("dropna", "pandas.dropna", {
                "notebookCellIndex": 0,
                "notebookOperationIndex": 1,
                "notebookInputBindingsJson": json.dumps({"input": "frame"}),
                "notebookOutputBindingsJson": json.dumps({"clean": "output"}),
            }),
            node("cell-result", "notebook.code_cell", {
                "source": "check = pd.DataFrame({'sum': [int(clean['x'].sum())]})\ncheck",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 2,
            }),
        ],
        "edges": [
            {"id": "visual-source", "source": "cell-source", "sourceHandle": "next", "target": "dropna", "targetHandle": "input", "data": {"role": "notebook-variable", "variable": "frame"}},
            {"id": "visual-result", "source": "dropna", "sourceHandle": "output", "target": "cell-result", "targetHandle": "previous", "data": {"role": "notebook-variable", "variable": "clean"}},
        ],
    }
    result = run(workflow)
    assert result["status"] == "success"
    assert result["nodeResults"]["cell-result"]["kind"] == "table"
    assert result["nodeResults"]["cell-result"]["preview"]["rows"] == [[4]]


def test_native_notebook_node_resolves_dynamic_scalar_parameters_without_data_edges():
    workflow = {
        "schemaVersion": 2,
        "nodes": [
            node("cell-source", "notebook.code_cell", {
                "source": "import pandas as pd\nframe = pd.DataFrame({'x': [0, 1, 2, 3, 4, 5]})\nRead_sample = 1\nSet_sample = 2",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 0,
            }),
            node("window", "table.periodic_window", {
                "groupSize": 75,
                "position": "offset",
                "offset": 0,
                "count": 25,
                "notebookCellIndex": 0,
                "notebookOperationIndex": 1,
                "notebookInputBindingsJson": json.dumps({}),
                "notebookExpressionInputsJson": json.dumps({"input": "frame.iloc[:, 0:1]"}),
                "notebookParameterBindingsJson": json.dumps({"count": "Set_sample"}),
                "notebookParameterExpressionsJson": json.dumps({"groupSize": "Read_sample + Set_sample", "offset": "Read_sample - 1"}),
                "notebookOutputBindingsJson": json.dumps({"picked": "output"}),
            }),
            node("cell-result", "notebook.code_cell", {
                "source": "check = pd.DataFrame({'sum': [int(picked['x'].sum())]})\ncheck",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 2,
            }),
        ],
        "edges": [
            {"id": "visual-data", "source": "cell-source", "sourceHandle": "next", "target": "window", "targetHandle": "input", "data": {"role": "notebook-variable", "variable": "frame"}},
            {"id": "visual-param", "source": "cell-source", "sourceHandle": "next", "target": "window", "targetHandle": "input", "data": {"role": "notebook-parameter", "variable": "Set_sample"}},
            {"id": "visual-result", "source": "window", "sourceHandle": "output", "target": "cell-result", "targetHandle": "previous", "data": {"role": "notebook-variable", "variable": "picked"}},
        ],
    }
    result = run(workflow)
    assert result["status"] == "success"
    assert result["nodeResults"]["cell-result"]["preview"]["rows"] == [[8]]


def test_promoted_notebook_function_call_uses_namespace_and_literal_bindings():
    definition = {
        "id": "notebook-fn-scale",
        "name": "scale",
        "version": 1,
        "inputs": [
            {"id": "frame", "label": "frame", "valueType": "any", "internalNodeId": "impl", "internalHandle": "frame"},
            {"id": "factor", "label": "factor", "valueType": "any", "internalNodeId": "impl", "internalHandle": "factor"},
        ],
        "outputs": [
            {"id": "output", "label": "output", "valueType": "any", "internalNodeId": "impl", "internalHandle": "output"},
        ],
        "nodes": [node("impl", "custom.python_function", {
            "code": "def scale(frame: 'Any', factor: 'Any') -> 'Any':\n    return frame * factor",
        })],
        "edges": [],
    }
    workflow = {
        "schemaVersion": 2,
        "functions": [definition],
        "nodes": [
            node("cell-source", "notebook.code_cell", {
                "source": "import pandas as pd\nframe = pd.DataFrame({'x': [1, 2, 3]})\ndef scale(frame, factor=2):\n    return frame * factor",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 0,
            }),
            node("call", "function.call", {
                "functionId": "notebook-fn-scale",
                "functionVersion": 1,
                "notebookCellIndex": 0,
                "notebookOperationIndex": 1,
                "notebookInputBindingsJson": json.dumps({"frame": "frame"}),
                "notebookLiteralInputsJson": json.dumps({"factor": 3}),
                "notebookOutputBindingsJson": json.dumps({"scaled": "output"}),
            }),
            node("cell-result", "notebook.code_cell", {
                "source": "check = pd.DataFrame({'sum': [int(scaled['x'].sum())]})\ncheck",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 2,
            }),
        ],
        "edges": [],
    }
    result = run(workflow)
    assert result["status"] == "success"
    assert result["nodeResults"]["cell-result"]["preview"]["rows"] == [[18]]


def test_promoted_notebook_function_map_preserves_list_comprehension_semantics():
    definition = {
        "id": "notebook-fn-measure",
        "name": "measure",
        "version": 1,
        "inputs": [
            {"id": "value", "label": "value", "valueType": "any", "internalNodeId": "impl", "internalHandle": "value"},
            {"id": "factor", "label": "factor", "valueType": "any", "internalNodeId": "impl", "internalHandle": "factor"},
        ],
        "outputs": [
            {"id": "output", "label": "output", "valueType": "any", "internalNodeId": "impl", "internalHandle": "output"},
        ],
        "nodes": [node("impl", "custom.python_function", {
            "code": "def measure(value: 'Any', factor: 'Any') -> 'Any':\n    return value * factor",
        })],
        "edges": [],
    }
    workflow = {
        "schemaVersion": 2,
        "functions": [definition],
        "nodes": [
            node("cell-source", "notebook.code_cell", {
                "source": "items = [1, 2, 3]",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 0,
            }),
            node("map-list", "function.map", {
                "functionId": "notebook-fn-measure",
                "functionVersion": 1,
                "mapInput": "value",
                "collectMode": "list",
                "maxIterations": 100,
                "notebookCellIndex": 0,
                "notebookOperationIndex": 1,
                "notebookInputBindingsJson": json.dumps({"value": "items"}),
                "notebookLiteralInputsJson": json.dumps({"factor": 2}),
                "notebookOutputBindingsJson": json.dumps({"values": "output"}),
            }),
            node("map-table", "function.map", {
                "functionId": "notebook-fn-measure",
                "functionVersion": 1,
                "mapInput": "value",
                "collectMode": "table",
                "maxIterations": 100,
                "notebookCellIndex": 0,
                "notebookOperationIndex": 2,
                "notebookInputBindingsJson": json.dumps({"value": "items"}),
                "notebookLiteralInputsJson": json.dumps({"factor": 3}),
                "notebookOutputBindingsJson": json.dumps({"frame": "output"}),
            }),
            node("cell-result", "notebook.code_cell", {
                "source": "check = pd.DataFrame({'list_sum': [sum(values)], 'table_sum': [int(frame.iloc[:, 0].sum())]})\ncheck",
                "notebookCellIndex": 0,
                "notebookOperationIndex": 3,
            }),
        ],
        "edges": [],
    }
    result = run(workflow)
    assert result["status"] == "success"
    assert result["nodeResults"]["cell-result"]["preview"]["rows"] == [[12, 18]]
