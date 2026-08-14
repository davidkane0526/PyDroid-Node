from __future__ import annotations

import json
import base64
import sys
import traceback
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydroid_flow.engine import environment_info_json, execute_workflow
from pydroid_flow.notebook import analyze_notebook_json


def execute_request(request: dict[str, Any]) -> str:
    if request.get("action") == "environment":
        return environment_info_json()
    if request.get("action") == "analyze_notebook":
        notebook = request.get("notebook")
        if not isinstance(notebook, str):
            raise ValueError("notebook must be a JSON string")
        return analyze_notebook_json(notebook)
    workflow = request.get("workflow")
    csv_text = request.get("csvText")
    input_files = request.get("inputFiles", "[]")
    if not isinstance(workflow, str) or not isinstance(csv_text, str):
        raise ValueError("workflow and csvText are required")
    if not isinstance(input_files, str):
        raise ValueError("inputFiles must be a JSON string")
    return execute_workflow(workflow, csv_text, input_files)


def main() -> int:
    try:
        raw_request = sys.stdin.read()
        if raw_request.startswith("PYDROID_FLOW_BASE64_V1\n"):
            encoded = raw_request.split("\n", 1)[1].strip()
            try:
                raw_request = base64.b64decode(encoded, validate=True).decode("utf-8")
            except Exception as exception:
                raise ValueError("Desktop request frame is damaged") from exception
        request = json.loads(raw_request)
        if not isinstance(request, dict):
            raise ValueError("Desktop request must be a JSON object")
        sys.stdout.write(execute_request(request))
        return 0
    except Exception as exception:
        sys.stdout.write(json.dumps({
            "status": "error", "nodeId": "__workflow__", "nodeType": "workflow",
            "message": str(exception), "nodeResults": {}, "nodeTimingsMs": {},
            "executionOrder": [], "preview": None, "debugTraceback": traceback.format_exc(),
        }, ensure_ascii=False))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
