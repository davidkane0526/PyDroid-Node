from __future__ import annotations

import ast
import math
from typing import Any

import numpy as np
import pandas as pd

from .values import _optional_float, _resolve_column

def _group_aggregate(frame: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    group_size = int(params.get("groupSize", 20))
    start = int(params.get("startRow", 0))
    end_raw = params.get("endRow", "")
    end = int(end_raw) if str(end_raw).strip() else group_size
    method = str(params.get("method", "mean"))

    if group_size <= 0:
        raise ValueError("groupSize must be greater than zero")
    if start < 0 or end <= start or end > group_size:
        raise ValueError("The aggregation window must satisfy 0 <= startRow < endRow <= groupSize")
    if method not in {"mean", "median", "min", "max", "sum"}:
        raise ValueError(f"Unsupported aggregation method: {method}")

    rows: list[pd.Series] = []
    # Grouping relies on a contiguous 0-based RangeIndex; upstream nodes such as
    # table.diff / table.select_columns / table.slice keep the original index,
    # which can be non-contiguous and would silently mis-bucket the rows.
    frame = frame.reset_index(drop=True)
    for _, group in frame.groupby(frame.index // group_size):
        window = group.iloc[start:end]
        if window.empty:
            continue
        rows.append(getattr(window, method)(numeric_only=True))
    return pd.DataFrame(rows).reset_index(drop=True)

def _filter_range(frame: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    column_index = int(params.get("column", 0))
    if column_index < 0 or column_index >= len(frame.columns):
        raise ValueError(f"Filter column index out of range: {column_index}")
    minimum = _optional_float(params.get("min"))
    maximum = _optional_float(params.get("max"))
    series = pd.to_numeric(frame.iloc[:, column_index], errors="coerce")
    mask = pd.Series(True, index=frame.index)
    if minimum is not None:
        mask &= series >= minimum
    if maximum is not None:
        mask &= series <= maximum
    return frame.loc[mask].reset_index(drop=True)

def _logic_expression(expression: str, value: float, iteration: int) -> float | bool:
    """Evaluate the small arithmetic language used by the guarded while node."""
    tree = ast.parse(expression, mode="eval")
    binary = {
        ast.Add: lambda left, right: left + right,
        ast.Sub: lambda left, right: left - right,
        ast.Mult: lambda left, right: left * right,
        ast.Div: lambda left, right: left / right,
        ast.FloorDiv: lambda left, right: left // right,
        ast.Mod: lambda left, right: left % right,
        ast.Pow: lambda left, right: left**right,
    }
    comparisons = {
        ast.Lt: lambda left, right: left < right,
        ast.LtE: lambda left, right: left <= right,
        ast.Gt: lambda left, right: left > right,
        ast.GtE: lambda left, right: left >= right,
        ast.Eq: lambda left, right: left == right,
        ast.NotEq: lambda left, right: left != right,
    }

    def evaluate(node: ast.AST) -> float | bool:
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float, bool)):
            return node.value
        if isinstance(node, ast.Name) and node.id in {"value", "iteration"}:
            return value if node.id == "value" else iteration
        if isinstance(node, ast.BinOp) and type(node.op) in binary:
            return binary[type(node.op)](evaluate(node.left), evaluate(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub, ast.Not)):
            operand = evaluate(node.operand)
            if isinstance(node.op, ast.UAdd):
                return +operand
            if isinstance(node.op, ast.USub):
                return -operand
            return not operand
        if isinstance(node, ast.Compare):
            left = evaluate(node.left)
            for operator, comparator in zip(node.ops, node.comparators, strict=True):
                right = evaluate(comparator)
                if type(operator) not in comparisons or not comparisons[type(operator)](left, right):
                    return False
                left = right
            return True
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            # Short-circuit evaluation: only evaluate operands until the result is
            # decided, so patterns like `value != 0 and 1 / value > 0.1` no longer
            # raise ZeroDivisionError when value == 0.
            if isinstance(node.op, ast.And):
                for item in node.values:
                    if not bool(evaluate(item)):
                        return False
                return True
            for item in node.values:
                if bool(evaluate(item)):
                    return True
            return False
        raise ValueError("While expressions support only value, iteration, numbers, arithmetic, comparisons, and/or/not")

    result = evaluate(tree.body)
    if not isinstance(result, (int, float, bool)):
        raise ValueError("While expression must produce a number or boolean")
    return result

def _ter_matrix(frame: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    vg_column = _resolve_column(frame, params.get("vgColumn", "Vg_V"))
    voltage_column = _resolve_column(frame, params.get("voltageColumn", 0))
    current_column = _resolve_column(frame, params.get("currentColumn", 1))
    current_floor = float(params.get("currentFloor", 1e-15))
    mode = str(params.get("mode", "high-low"))
    if mode not in {"high-low", "down-minus-up", "up-minus-down"}:
        raise ValueError(f"Unsupported TER mode: {mode}")

    groups: list[tuple[Any, list[float], list[float], str]] = []
    detected_min = math.inf
    detected_max = -math.inf
    all_differences: list[float] = []
    source_column = str(params.get("sourceColumn", "source_file")).strip()
    for vg, group in frame.groupby(vg_column, sort=True):
        cleaned = pd.DataFrame({
            "voltage": pd.to_numeric(group[voltage_column], errors="coerce"),
            "current": pd.to_numeric(group[current_column], errors="coerce"),
        }).dropna()
        if len(cleaned) < 3:
            raise ValueError(f"Vg={vg} has fewer than 3 valid samples")
        voltages = cleaned["voltage"].astype(float).tolist()
        currents = cleaned["current"].astype(float).tolist()
        differences = [abs(voltages[index] - voltages[index - 1]) for index in range(1, len(voltages))]
        all_differences.extend(item for item in differences if item > 1e-12)
        detected_min = min(detected_min, min(voltages))
        detected_max = max(detected_max, max(voltages))
        source = str(group[source_column].iloc[0]) if source_column and source_column in group.columns else ""
        groups.append((vg, voltages, currents, source))

    # Median is robust against a single noisy tiny difference; the previous
    # minimum could be collapsed by one noise spike into an absurdly small step.
    detected_step = float(np.median(all_differences)) if all_differences else math.inf
    step = _optional_float(params.get("vstep")) or detected_step
    vmin = _optional_float(params.get("vmin"))
    vmax = _optional_float(params.get("vmax"))
    low = detected_min if vmin in {None, 0} else vmin
    high = detected_max if vmax in {None, 0} else vmax
    if not math.isfinite(step) or step <= 0 or not low < 0 < high:
        raise ValueError("Unable to detect a valid Vds range and step")
    tolerance = _optional_float(params.get("tolerance")) or step / 20

    targets: list[float] = []
    target = low
    while target < -step / 2:
        targets.append(round(target, 12))
        target += step
    target = step
    while target <= high + step / 2:
        targets.append(round(target, 12))
        target += step

    records: list[dict[str, Any]] = []
    for vg, voltages, currents, source in groups:
        directions = [0] * len(voltages)
        for index in range(len(voltages)):
            if index > 0 and abs(voltages[index] - voltages[index - 1]) > tolerance:
                directions[index] = 1 if voltages[index] > voltages[index - 1] else -1
            elif index + 1 < len(voltages) and abs(voltages[index + 1] - voltages[index]) > tolerance:
                directions[index] = 1 if voltages[index + 1] > voltages[index] else -1
        for target in targets:
            matched = [index for index, measured in enumerate(voltages) if abs(measured - target) <= tolerance]
            up = [index for index in matched if directions[index] == 1]
            down = [index for index in matched if directions[index] == -1]
            i_up = currents[up[0]] if up else math.nan
            i_down = currents[down[0]] if down else math.nan
            r_up = abs(target / i_up) if math.isfinite(i_up) and abs(i_up) > current_floor else math.nan
            r_down = abs(target / i_down) if math.isfinite(i_down) and abs(i_down) > current_floor else math.nan
            ter = math.nan
            if math.isfinite(r_up) and math.isfinite(r_down):
                if mode == "down-minus-up" and r_up != 0:
                    ter = (r_down - r_up) / r_up * 100
                elif mode == "up-minus-down" and r_down != 0:
                    ter = (r_up - r_down) / r_down * 100
                elif mode == "high-low":
                    r_low, r_high = sorted((r_up, r_down))
                    if r_low != 0:
                        ter = (r_high - r_low) / r_low * 100
            records.append({
                "Vg_V": float(vg), "Vds_V": target, "I_up_A": i_up, "I_down_A": i_down,
                "R_up_ohm": r_up, "R_down_ohm": r_down, "TER_percent": ter,
                **({"source_file": source} if source else {}),
            })
    return pd.DataFrame(records).sort_values(["Vg_V", "Vds_V"]).reset_index(drop=True)
