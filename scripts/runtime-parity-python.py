from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from pydroid_flow.engine import execute_workflow  # noqa: E402


def execute_case(request: dict[str, object]) -> dict[str, object]:
    workflow = json.dumps(request["workflow"], ensure_ascii=False)
    result = execute_workflow(
        workflow,
        str(request.get("csvText", "")),
        json.dumps(request.get("inputFiles", []), ensure_ascii=False),
    )
    return json.loads(result)


def main() -> int:
    request = json.load(sys.stdin)
    cases = request.get("cases") if isinstance(request, dict) else None
    if isinstance(cases, list):
        sys.stdout.write(json.dumps([execute_case(case) for case in cases], ensure_ascii=False, allow_nan=False))
        return 0
    sys.stdout.write(json.dumps(execute_case(request), ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
