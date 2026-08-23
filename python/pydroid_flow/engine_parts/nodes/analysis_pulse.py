from __future__ import annotations

from typing import Any

import pandas as pd

from ..analysis_nodes import _ter_matrix
from ..pulse_nodes import _oscillating_pulse_ramp, _pulse_combine_channels, _pulse_segment_measurement, _pulse_square_waveform, _pulse_waveform
from ..values import _require_table, _resolve_column

NODE_TYPES = {
    "analysis.ter_matrix",
    "analysis.linear_fit",
    "pulse.generate_waveform",
    "pulse.generate_square_waveform",
    "pulse.generate_oscillating_ramp",
    "pulse.combine_channels",
    "pulse.segment_measurement",
}


def execute(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    del csv_text, input_files, variables
    table_result: pd.DataFrame | None = None

    if node_type == "analysis.ter_matrix":
        value = _ter_matrix(_require_table(upstream, "TER matrix"), params)
        table_result = value
    elif node_type == "analysis.linear_fit":
        from scipy import stats

        table = _require_table(upstream, "Linear fit")
        x_column = _resolve_column(table, params.get("xColumn"))
        y_column = _resolve_column(table, params.get("yColumn"))
        x = pd.to_numeric(table[x_column], errors="coerce")
        y = pd.to_numeric(table[y_column], errors="coerce")
        mask = x.notna() & y.notna()
        if int(mask.sum()) < 2:
            raise ValueError("Linear fit requires at least two valid (x, y) points")
        slope, intercept, r_value, p_value, std_err = stats.linregress(x[mask], y[mask])
        value = pd.DataFrame({"slope": [slope], "intercept": [intercept], "r_value": [r_value], "p_value": [p_value], "std_err": [std_err]})
        table_result = value
    elif node_type == "pulse.generate_waveform":
        value = _pulse_waveform(params)
        table_result = value
    elif node_type == "pulse.generate_square_waveform":
        value = _pulse_square_waveform(params)
        table_result = value
    elif node_type == "pulse.generate_oscillating_ramp":
        value = _oscillating_pulse_ramp(params)
        table_result = value
    elif node_type == "pulse.combine_channels":
        value = _pulse_combine_channels(upstream, params)
        table_result = value
    elif node_type == "pulse.segment_measurement":
        value = _pulse_segment_measurement(upstream, params)
        table_result = value
    else:
        raise ValueError(f"Unsupported analysis/pulse node type: {node_type}")

    return {"output": value}, table_result, None, None
