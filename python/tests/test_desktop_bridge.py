import json

import pytest

from pydroid_flow.desktop_bridge import execute_request


def test_desktop_bridge_base64_frame_round_trip(tmp_path, monkeypatch):
    import base64
    import io
    import json
    import sys
    from pydroid_flow import desktop_bridge

    payload = {"workflow": json.dumps({"schemaVersion": 1, "name": "引号 { 测试", "nodes": [], "edges": []}, ensure_ascii=False), "csvText": "", "inputFiles": "[]"}
    frame = "PYDROID_FLOW_BASE64_V1\n" + base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
    output = io.StringIO()
    monkeypatch.setattr(sys, "stdin", io.StringIO(frame))
    monkeypatch.setattr(sys, "stdout", output)
    assert desktop_bridge.main() == 0
    assert json.loads(output.getvalue())["status"] == "success"


def test_desktop_bridge_executes_shared_engine():
    workflow = {
        "schemaVersion": 1,
        "name": "desktop test",
        "nodes": [
            {
                "id": "read",
                "data": {
                    "nodeType": "io.read_csv",
                    "parameters": {"skipRows": 0},
                },
            }
        ],
        "edges": [],
    }

    result = json.loads(
        execute_request({"workflow": json.dumps(workflow), "csvText": "a,b\n1,2\n"})
    )

    assert result["status"] == "success"
    assert result["preview"]["totalRows"] == 2
    assert result["preview"]["totalColumns"] == 2


def test_desktop_bridge_rejects_missing_values():
    with pytest.raises(ValueError, match="workflow and csvText are required"):
        execute_request({"workflow": "{}"})


def test_desktop_bridge_contains_legacy_literal_parse_errors_in_result():
    result = json.loads(execute_request({"workflow": "{'nodes': [], 'edges': []}", "csvText": ""}))
    assert result["status"] == "success"

    malformed = json.loads(execute_request({"workflow": "{nodes: [}", "csvText": ""}))
    assert malformed["status"] == "error"
    assert "工作流 JSON 格式错误" in malformed["message"]


def test_desktop_bridge_reports_python_environment():
    result = json.loads(execute_request({"action": "environment"}))
    assert result["pythonVersion"].startswith("3.12")
    assert any(item["name"] == "pandas" for item in result["packages"])


def test_desktop_bridge_transports_multiple_csv_files():
    workflow = {
        "schemaVersion": 1,
        "name": "batch desktop test",
        "nodes": [{
            "id": "batch",
            "data": {
                "nodeType": "io.read_csv_batch",
                "parameters": {"metadataColumn": "", "sourceColumn": "source_file"},
            },
        }],
        "edges": [],
    }
    files = [
        {"name": "a.csv", "text": "1,2\n"},
        {"name": "b.csv", "text": "3,4\n"},
    ]
    result = json.loads(execute_request({
        "workflow": json.dumps(workflow), "csvText": "", "inputFiles": json.dumps(files),
    }))
    assert result["status"] == "success"
    assert result["preview"]["totalRows"] == 2
    assert result["preview"]["rows"][1][-1] == "b.csv"
