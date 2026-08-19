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
