from __future__ import annotations

import json
from typing import Any

import pandas as pd

from .values import _resolve_column, _resolve_columns

_ALLOWED_METHODS = {"mean", "median", "sum", "min", "max", "std", "count"}


def groupby_aggregate(table: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    group_by = _resolve_columns(table, params.get("groupBy"))
    if not group_by:
        raise ValueError("Groupby aggregate requires at least one grouping column")
    grouped = table.groupby(group_by, sort=True)
    if str(params.get("aggregateMode", "single")) == "multi":
        raw = params.get("aggregations")
        if isinstance(raw, dict):
            spec = raw
        else:
            text = str(raw or "").strip()
            if not text:
                raise ValueError("Groupby multi aggregation requires an aggregations object")
            try:
                spec = json.loads(text)
            except (TypeError, ValueError) as exception:
                raise ValueError("Groupby aggregations must be a JSON object") from exception
        if not isinstance(spec, dict) or not spec:
            raise ValueError("Groupby aggregations must be a non-empty object")
        named: dict[str, pd.NamedAgg] = {}
        for raw_column, raw_methods in spec.items():
            column = _resolve_column(table, raw_column)
            methods = raw_methods if isinstance(raw_methods, list) else [raw_methods]
            if not methods:
                raise ValueError(f"Groupby aggregation for {column} is empty")
            for raw_method in methods:
                method = str(raw_method)
                if method not in _ALLOWED_METHODS:
                    raise ValueError(f"Unsupported groupby method: {method}")
                output_name = f"{column}_{method}"
                if output_name in named:
                    raise ValueError(f"Duplicate groupby aggregation: {output_name}")
                named[output_name] = pd.NamedAgg(column=column, aggfunc=method)
        return grouped.agg(**named).reset_index()

    method = str(params.get("method", "mean"))
    if method not in _ALLOWED_METHODS:
        raise ValueError(f"Unsupported groupby method: {method}")
    if method == "count":
        return grouped.size().reset_index(name="count")
    return getattr(grouped, method)(numeric_only=True).reset_index()
