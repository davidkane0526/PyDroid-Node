import json

from pydroid_flow.engine import execute_workflow


def _node(node_id: str, node_type: str, parameters: dict | None = None):
    return {"id": node_id, "type": "workflow", "position": {"x": 0, "y": 0}, "data": {"nodeType": node_type, "label": node_type, "parameters": parameters or {}}}


def test_serialized_python_runtime_provider_executes():
    workflow = {
        "nodes": [_node("provider", "external.scale", {"factor": 4})],
        "edges": [],
        "runtimeProviders": {
            "python": [{
                "nodeType": "external.scale",
                "entrypoint": "execute",
                "source": "def execute(params, upstream, context):\n    return {'output': float(params['factor']) * 3}\n",
            }]
        },
    }
    result = json.loads(execute_workflow(json.dumps(workflow), ""))
    assert result["status"] == "success"
    assert result["nodeResults"]["provider"]["value"] == 12.0


def test_python_runtime_provider_dataframe_becomes_table_result():
    workflow = {
        "nodes": [_node("provider", "external.table", {"count": 3})],
        "edges": [],
        "runtimeProviders": {
            "python": [{
                "nodeType": "external.table",
                "source": "def execute(params, upstream, context):\n    return pd.DataFrame({'value': list(range(int(params['count'])))})\n",
            }]
        },
    }
    result = json.loads(execute_workflow(json.dumps(workflow), ""))
    assert result["status"] == "success"
    assert result["nodeResults"]["provider"]["kind"] == "table"
    assert result["nodeResults"]["provider"]["preview"]["rows"] == [[0], [1], [2]]


def test_invalid_python_runtime_provider_reports_workflow_error():
    workflow = {
        "nodes": [_node("provider", "external.bad")],
        "edges": [],
        "runtimeProviders": {"python": [{"nodeType": "external.bad", "source": "def broken(:\n    pass"}]},
    }
    result = json.loads(execute_workflow(json.dumps(workflow), ""))
    assert result["status"] == "error"
    assert result["nodeType"] == "runtime.provider"
