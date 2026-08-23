from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from ..analysis_nodes import _filter_range, _group_aggregate
from ..random_portable import _portable_sample_count, _portable_sample_indexes
from ..values import _as_bool, _optional_float, _parameter_list, _parse_columns, _rename_columns, _require_table, _resolve_columns, _scalar_value

NODE_TYPES = {
    "table.concat",
    "table.select_columns",
    "table.absolute",
    "table.transpose",
    "table.slice",
    "table.reset_index",
    "table.periodic_window",
    "table.periodic_tail_mean",
    "table.row_chunks_to_columns",
    "stats.column_group_cv",
    "table.sort_index",
    "table.difference",
    "table.filter_range",
    "table.rename_columns",
    "table.pivot",
    "table.group_aggregate",
    "table.groupby_aggregate",
    "pandas.dropna",
    "pandas.fillna",
    "pandas.sort_values",
    "pandas.head",
    "pandas.tail",
    "pandas.drop_duplicates",
    "pandas.sample",
    "pandas.round",
    "pandas.describe",
    "pandas.query",
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

    if node_type == "table.concat":
        axis = int(params.get("axis", 0))
        if axis not in {0, 1}:
            raise ValueError("Concat axis must be 0 or 1")
        value = pd.concat(
            [upstream["left"], upstream["right"]],
            axis=axis,
            ignore_index=_as_bool(params.get("ignoreIndex", axis == 0)),
        )
    elif node_type == "table.select_columns":
        table = _require_table(upstream, "Select columns")
        value = table.iloc[:, _parse_columns(params.get("columns"), len(table.columns))]
    elif node_type == "table.absolute":
        value = _require_table(upstream, "Absolute value").abs()
    elif node_type == "table.transpose":
        value = _require_table(upstream, "Transpose").transpose().reset_index(drop=True)
    elif node_type == "table.slice":
        table = _require_table(upstream, "Slice")

        def slice_part(prefix: str) -> slice:
            start = params.get(f"{prefix}Start")
            stop = params.get(f"{prefix}Stop")
            step = int(params.get(f"{prefix}Step", 1) or 1)
            if step == 0:
                raise ValueError("Slice step cannot be zero")
            return slice(None if start in {None, ""} else int(start), None if stop in {None, ""} else int(stop), step)

        value = table.iloc[slice_part("row"), slice_part("column")].copy()
    elif node_type == "table.reset_index":
        value = _require_table(upstream, "Reset index").reset_index(drop=_as_bool(params.get("drop", True)))
    elif node_type == "table.periodic_window":
        table = _require_table(upstream, "Periodic window")
        group_size = int(params.get("groupSize", 75))
        count = int(params.get("count", 25))
        if group_size < 1 or count < 1:
            raise ValueError("Periodic window sizes must be positive")
        position = str(params.get("position", "start"))
        offset = group_size - count if position == "end" else int(params.get("offset", 0)) if position == "offset" else 0
        if offset < 0 or offset + count > group_size:
            raise ValueError("Periodic window must stay inside each group")
        rows = [row for base in range(0, len(table), group_size) for row in range(base + offset, min(base + offset + count, len(table)))]
        value = table.iloc[rows].reset_index(drop=True)
    elif node_type == "table.periodic_tail_mean":
        table = _require_table(upstream, "Periodic tail mean")
        group_size = int(params.get("groupSize", 25))
        tail_rows = int(params.get("tailRows", 10))
        partial_group = str(params.get("partialGroup", "include"))
        if group_size < 1 or tail_rows < 1:
            raise ValueError("Periodic mean sizes must be positive integers")
        if tail_rows > group_size:
            raise ValueError("Periodic tailRows cannot exceed groupSize")
        if partial_group not in {"include", "drop", "error"}:
            raise ValueError(f"Unsupported partialGroup: {partial_group}")
        chunks: list[pd.Series] = []
        for start in range(0, len(table), group_size):
            end = min(start + group_size, len(table))
            actual_size = end - start
            if actual_size < group_size:
                if partial_group == "drop":
                    break
                if partial_group == "error":
                    raise ValueError(f"Periodic tail mean found incomplete final group with {actual_size} of {group_size} rows")
            tail_start = max(start, end - tail_rows)
            chunks.append(table.iloc[tail_start:end].mean(numeric_only=True))
        value = pd.DataFrame(chunks).reindex(columns=table.select_dtypes(include="number").columns)
    elif node_type == "table.row_chunks_to_columns":
        table = _require_table(upstream, "Row chunks to columns")
        chunks = int(params.get("chunks", 2))
        if chunks < 1:
            raise ValueError("Row chunks to columns requires chunks >= 1")
        arrays = np.array_split(table.to_numpy(), chunks, axis=0)
        frames = [
            pd.DataFrame(array, columns=[f"{column}_{index + 1}" for column in table.columns])
            for index, array in enumerate(arrays)
        ]
        value = pd.concat(frames, axis=1) if frames else table.iloc[0:0].copy()
    elif node_type == "stats.column_group_cv":
        table = _require_table(upstream, "Column group CV")
        group_size = int(params.get("groupSize", 50))
        if group_size < 1:
            raise ValueError("Column group CV requires groupSize >= 1")
        value = []
        for start in range(0, len(table.columns), group_size):
            group = table.iloc[:, start:start + group_size]
            means = group.mean(axis=1)
            stds = group.std(axis=1, ddof=0)
            value.append(pd.Series(np.where(means != 0, stds / means, np.nan), index=table.index))
    elif node_type == "table.sort_index":
        value = _require_table(upstream, "Sort index").sort_index(axis=int(params.get("axis", 0)), ascending=_as_bool(params.get("ascending", True)))
    elif node_type == "table.difference":
        table = _require_table(upstream, "Difference")
        value = table.diff(periods=int(params.get("periods", 1)), axis=int(params.get("axis", 0)))
    elif node_type == "table.filter_range":
        value = _filter_range(_require_table(upstream, "Range filter"), params)
    elif node_type == "table.rename_columns":
        value = _rename_columns(_require_table(upstream, "Rename columns"), params.get("names"))
    elif node_type == "table.pivot":
        table = _require_table(upstream, "Pivot")
        index = _resolve_columns(table, params.get("index"))
        columns = _resolve_columns(table, params.get("columns"))
        values = _resolve_columns(table, params.get("values"))
        if len(index) != 1 or len(columns) != 1 or len(values) != 1:
            raise ValueError("Pivot requires one row key, column key, and value column")
        aggregate = str(params.get("aggregate", "mean"))
        if aggregate not in {"mean", "first", "max", "min"}:
            raise ValueError("Unsupported pivot aggregate")
        value = table.pivot_table(index=index[0], columns=columns[0], values=values[0], aggfunc=aggregate).sort_index().sort_index(axis=1)
        value.columns = [str(column) for column in value.columns]
        if _as_bool(params.get("resetIndex", True)):
            value = value.reset_index()
    elif node_type == "pandas.dropna":
        table = _require_table(upstream, "Drop missing values")
        how = str(params.get("how", "any"))
        if how not in {"any", "all"}:
            raise ValueError("Drop missing values supports only any or all")
        subset = _resolve_columns(table, params.get("subset")) or None
        value = table.dropna(how=how, subset=subset).reset_index(drop=True)
    elif node_type == "pandas.fillna":
        table = _require_table(upstream, "Fill missing values")
        method = str(params.get("method", "value"))
        if method == "forward":
            value = table.ffill()
        elif method == "backward":
            value = table.bfill()
        elif method == "value":
            value = table.fillna(_scalar_value(params.get("value", "0")))
        else:
            raise ValueError(f"Unsupported fill method: {method}")
    elif node_type == "pandas.sort_values":
        table = _require_table(upstream, "Sort values")
        columns = _resolve_columns(table, params.get("columns"))
        if not columns:
            raise ValueError("Sort values requires at least one column")
        na_position = str(params.get("naPosition", "last"))
        if na_position not in {"first", "last"}:
            raise ValueError("naPosition must be first or last")
        value = table.sort_values(by=columns, ascending=_as_bool(params.get("ascending", True)), na_position=na_position).reset_index(drop=True)
    elif node_type == "pandas.head":
        value = _require_table(upstream, "Head").head(int(params.get("n", 5))).reset_index(drop=True)
    elif node_type == "pandas.tail":
        value = _require_table(upstream, "Tail").tail(int(params.get("n", 5))).reset_index(drop=True)
    elif node_type == "pandas.drop_duplicates":
        table = _require_table(upstream, "Drop duplicates")
        subset = _resolve_columns(table, params.get("subset")) or None
        keep_raw = str(params.get("keep", "first"))
        keep: Any = False if keep_raw == "false" else keep_raw
        value = table.drop_duplicates(subset=subset, keep=keep, ignore_index=_as_bool(params.get("ignoreIndex", True)))
    elif node_type == "pandas.sample":
        table = _require_table(upstream, "Sample")
        fraction = _optional_float(params.get("fraction"))
        replace = _as_bool(params.get("replace", False))
        count = _portable_sample_count(len(table), fraction, params.get("n", 5))
        indexes = _portable_sample_indexes(len(table), count, replace, int(params.get("randomState", 0)))
        value = table.iloc[indexes].copy()
        if _as_bool(params.get("ignoreIndex", True)):
            value = value.reset_index(drop=True)
    elif node_type == "pandas.round":
        value = _require_table(upstream, "Round").round(decimals=int(params.get("decimals", 2)))
    elif node_type == "pandas.describe":
        table = _require_table(upstream, "Describe")
        percentiles = [float(item) for item in _parameter_list(params.get("percentiles"))]
        include_text = str(params.get("include", "") or "").strip()
        exclude_text = str(params.get("exclude", "") or "").strip()
        include: Any = "all" if include_text == "all" else _parameter_list(include_text) or None
        exclude: Any = _parameter_list(exclude_text) or None
        value = table.describe(percentiles=percentiles or None, include=include, exclude=exclude).reset_index().rename(columns={"index": "statistic"})
    elif node_type == "pandas.query":
        table = _require_table(upstream, "Query")
        expression = str(params.get("expression", "")).strip()
        if not expression:
            raise ValueError("Query expression is required")
        value = table.query(expression).reset_index(drop=True)
    elif node_type == "table.group_aggregate":
        value = _group_aggregate(_require_table(upstream, "Group aggregate"), params)
    elif node_type == "table.groupby_aggregate":
        table = _require_table(upstream, "Groupby aggregate")
        group_by = _resolve_columns(table, params.get("groupBy"))
        if not group_by:
            raise ValueError("Groupby aggregate requires at least one grouping column")
        method = str(params.get("method", "mean"))
        if method not in {"mean", "median", "sum", "min", "max", "std", "count"}:
            raise ValueError(f"Unsupported groupby method: {method}")
        grouped = table.groupby(group_by, sort=True)
        if method == "count":
            value = grouped.size().reset_index(name="count")
        else:
            value = getattr(grouped, method)(numeric_only=True).reset_index()
    else:
        raise ValueError(f"Unsupported table/pandas node type: {node_type}")

    return {"output": value}, value if isinstance(value, pd.DataFrame) else None, None, None
