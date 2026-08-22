from __future__ import annotations

from typing import Any

import pandas as pd

from ..analysis_nodes import _logic_expression
from ..values import _as_bool, _require_table

NODE_TYPES = {
    "table.split_condition",
    "table.merge_rows",
    "logic.for_range",
    "logic.while_number",
    "variable.set",
    "variable.get",
    "variable.set_workspace",
    "variable.get_workspace",
}


def execute(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    del csv_text, input_files
    table_result: pd.DataFrame | None = None

    if node_type == "table.split_condition":
        table = _require_table(upstream, "Conditional branch")
        condition = str(params.get("condition", "")).strip()
        if not condition:
            raise ValueError("Conditional branch requires a condition")
        working = table.reset_index(drop=True)
        matching = working.query(condition)
        rejected = working.loc[~working.index.isin(matching.index)]
        outputs = {"true": matching.reset_index(drop=True), "false": rejected.reset_index(drop=True)}
        return outputs, outputs["true"], None, None
    elif node_type == "table.merge_rows":
        left = _require_table(upstream["left"], "Branch merge A")
        right = _require_table(upstream["right"], "Branch merge B")
        ignore_index = _as_bool(params.get("ignoreIndex", True))
        value = pd.concat([left, right], axis=0, ignore_index=ignore_index)
        if not ignore_index and _as_bool(params.get("sortIndex", False)):
            value = value.sort_index()
        table_result = value
    elif node_type == "logic.for_range":
        start = int(params.get("start", 0))
        stop = int(params.get("stop", 10))
        step = int(params.get("step", 1))
        if step == 0:
            raise ValueError("For range step must not be zero")
        values = list(range(start, stop, step))
        if len(values) > 100_000:
            raise ValueError("For range is limited to 100000 iterations")
        value = pd.DataFrame({"iteration": range(len(values)), "value": values})
        table_result = value
    elif node_type == "logic.while_number":
        current = float(params.get("start", 0))
        condition = str(params.get("condition", "value < 10")).strip()
        update = str(params.get("update", "value + 1")).strip()
        maximum = int(params.get("maxIterations", 100))
        if not condition or not update or maximum < 1 or maximum > 10_000:
            raise ValueError("While requires expressions and maxIterations between 1 and 10000")
        rows: list[dict[str, float | int]] = []
        for iteration in range(maximum):
            if not bool(_logic_expression(condition, current, iteration)):
                break
            rows.append({"iteration": iteration, "value": current})
            next_value = _logic_expression(update, current, iteration)
            if isinstance(next_value, bool):
                raise ValueError("While update expression must produce a number")
            current = float(next_value)
        else:
            if bool(_logic_expression(condition, current, maximum)):
                raise ValueError(f"While reached the safety limit of {maximum} iterations")
        value = pd.DataFrame(rows, columns=["iteration", "value"])
        table_result = value
        return {"output": value, "last": current, "iterations": len(rows)}, table_result, None, None
    elif node_type in {"variable.set", "variable.set_workspace"}:
        name = str(params.get("name", "")).strip()
        if not name:
            raise ValueError("Set variable requires a name")
        if variables is None:
            target = None
        elif "__execution__" in variables or "__workspace__" in variables:
            target = variables.setdefault("__workspace__" if node_type.endswith("_workspace") else "__execution__", {})
        else:
            target = variables
        if target is not None:
            target[name] = upstream
        value = upstream
    elif node_type in {"variable.get", "variable.get_workspace"}:
        name = str(params.get("name", "")).strip()
        if not name:
            raise ValueError("Get variable requires a name")
        if variables is None:
            source = None
        elif "__execution__" in variables or "__workspace__" in variables:
            source = variables.get("__workspace__" if node_type.endswith("_workspace") else "__execution__", {})
        else:
            source = variables
        if source is None or name not in source:
            scope_label = "工作区变量" if node_type.endswith("_workspace") else "变量"
            raise ValueError(f"{scope_label} {name!r} is not defined")
        value = source[name]
    else:
        raise ValueError(f"Unsupported control/state node type: {node_type}")

    return {"output": value}, table_result, None, None
