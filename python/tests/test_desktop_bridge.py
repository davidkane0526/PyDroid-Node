import json

import pytest

from pydroid_flow.desktop_bridge import execute_request


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
