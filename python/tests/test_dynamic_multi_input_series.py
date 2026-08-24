from __future__ import annotations

import json
from pathlib import Path

import pytest

from pydroid_flow.engine import execute_workflow


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "file_name, expected_columns",
    [
        ("demo-14-dynamic-multi-input-concat.workflow.json", ["A", "B", "C"]),
        ("demo-15-groupby-multi-series.workflow.json", ["phase", "time_s_mean", "time_s_std", "voltage_V_min", "voltage_V_max"]),
        ("demo-16-dynamic-pulse-channels.workflow.json", ["time_s", "Drain_V", "Source_V", "Gate_V", "Aux_V"]),
    ],
)
def test_dynamic_multi_input_demos_execute(file_name: str, expected_columns: list[str]) -> None:
    workflow = (ROOT / "examples" / file_name).read_text(encoding="utf-8")
    result = json.loads(execute_workflow(workflow, "", "[]"))
    assert result["status"] == "success"
    assert result["preview"]["columns"] == expected_columns
