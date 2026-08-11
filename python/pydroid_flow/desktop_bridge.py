from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydroid_flow.engine import execute_workflow


def execute_request(request: dict[str, Any]) -> str:
    workflow = request.get("workflow")
    csv_text = request.get("csvText")
    if not isinstance(workflow, str) or not isinstance(csv_text, str):
        raise ValueError("workflow and csvText are required")
    return execute_workflow(workflow, csv_text)


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("Desktop request must be a JSON object")
        sys.stdout.write(execute_request(request))
        return 0
    except Exception as exception:
        sys.stderr.write(str(exception))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
