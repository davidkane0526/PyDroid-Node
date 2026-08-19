from __future__ import annotations

import base64
import io
import json
import math
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .analysis_nodes import _filter_range, _group_aggregate, _logic_expression, _ter_matrix
from .custom_function import _execute_custom_function
from .io_readers import _read_csv, _read_csv_batch
from .presentation import _apply_scientific_notation, _printable
from .pulse_nodes import _oscillating_pulse_ramp, _pulse_combine_channels, _pulse_segment_measurement, _pulse_waveform
from .random_portable import _PortableRandom, _portable_sample_count, _portable_sample_indexes
from .values import _as_bool, _decode_json_compatible, _optional_float, _parameter_list, _parse_columns, _rename_columns, _require_table, _resolve_column, _resolve_columns, _round_half_away, _scalar_value, _single_value

def _execute_node(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    table_result: pd.DataFrame | None = None
    plot_result: str | None = None
    export_result: str | None = None

    def selected_file() -> dict[str, Any]:
        if not input_files: raise ValueError("该读取节点需要先选择或拖入文件")
        index = int(params.get("fileIndex", 0))
        if index < 0 or index >= len(input_files): raise ValueError(f"文件序号 {index} 超出范围；当前共 {len(input_files)} 个文件")
        return input_files[index]

    if node_type == "io.read_text":
        value = str(selected_file().get("text", ""))
    elif node_type == "io.read_json":
        value = _decode_json_compatible(str(selected_file().get("text", "")), "JSON 文件")
    elif node_type == "io.read_table":
        item = selected_file(); text = str(item.get("text", "")); name = str(item.get("name", "")).lower()
        if name.endswith(".json"):
            decoded = _decode_json_compatible(text, "JSON 表格")
            value = pd.DataFrame(decoded if isinstance(decoded, list) else [decoded])
        else:
            separator = str(params.get("separator", "auto"))
            if separator == "auto": separator = "\t" if name.endswith((".tsv", ".dat")) and "\t" in text.partition("\n")[0] else None
            value = pd.read_csv(io.StringIO(text), sep=separator, engine="python" if separator is None else "c", header=0 if _as_bool(params.get("header", True)) else None)
        table_result = value
    elif node_type == "io.read_image":
        item = selected_file(); encoded = str(item.get("base64", ""))
        if not encoded: raise ValueError("图片读取需要原始二进制内容；请重新选择图片文件")
        image = plt.imread(io.BytesIO(base64.b64decode(encoded)))
        figure, axis = plt.subplots(figsize=(8, 6)); axis.imshow(image); axis.axis("off")
        buffer = io.BytesIO(); figure.savefig(buffer, format="png", dpi=120, bbox_inches="tight"); plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii"); value = figure
    elif node_type == "io.read_csv":
        value = _read_csv(csv_text, params)
        table_result = value
    elif node_type == "io.read_csv_batch":
        value = _read_csv_batch(input_files, params)
        table_result = value
    elif node_type == "generate.empty_list":
        value = []
    elif node_type == "generate.empty_table":
        raw_columns = params.get("columns", "")
        if isinstance(raw_columns, list):
            columns = [str(item).strip() for item in raw_columns if str(item).strip()]
        else:
            text = str(raw_columns or "").strip()
            if text.startswith("["):
                try:
                    decoded = json.loads(text)
                    columns = [str(item).strip() for item in decoded] if isinstance(decoded, list) else []
                except Exception:
                    columns = [item.strip() for item in text.split(",") if item.strip()]
            else:
                columns = [item.strip() for item in text.split(",") if item.strip()]
        value = pd.DataFrame(columns=columns)
        table_result = value
    elif node_type == "generate.random_table":
        count = int(params.get("count", 100))
        if count < 1 or count > 1_000_000:
            raise ValueError("Random table count must be between 1 and 1,000,000")
        distribution = str(params.get("distribution", "uniform"))
        seed = int(params.get("seed", 0))
        rng = _PortableRandom(seed)
        if distribution == "normal":
            mean = float(params.get("mean", 0))
            std = float(params.get("std", 1))
            if std < 0:
                raise ValueError("Random normal std must be non-negative")
            values = [rng.normal(mean, std) for _ in range(count)]
        elif distribution == "integer":
            minimum = math.ceil(float(params.get("min", 0)))
            maximum = math.floor(float(params.get("max", 1)))
            if maximum < minimum:
                raise ValueError("Random integer range contains no integer values")
            values = [rng.integer(minimum, maximum) for _ in range(count)]
        else:
            minimum = float(params.get("min", 0))
            maximum = float(params.get("max", 1))
            if maximum < minimum:
                raise ValueError("Random max must be greater than or equal to min")
            values = [minimum + rng.next() * (maximum - minimum) for _ in range(count)]
        index_column = str(params.get("indexColumn", "index") or "index").strip() or "index"
        value_column = str(params.get("valueColumn", "value") or "value").strip() or "value"
        if index_column == value_column:
            raise ValueError("Random table indexColumn and valueColumn must be different")
        value = pd.DataFrame({index_column: np.arange(count), value_column: values})
        table_result = value
    elif node_type == "table.concat":
        axis = int(params.get("axis", 0))
        if axis not in {0, 1}:
            raise ValueError("Concat axis must be 0 or 1")
        value = pd.concat(
            [upstream["left"], upstream["right"]],
            axis=axis,
            ignore_index=_as_bool(params.get("ignoreIndex", axis == 0)),
        )
        table_result = value
    elif node_type == "table.select_columns":
        table = _require_table(upstream, "Select columns")
        value = table.iloc[:, _parse_columns(params.get("columns"), len(table.columns))]
        table_result = value
    elif node_type == "table.absolute":
        value = _require_table(upstream, "Absolute value").abs()
        table_result = value
    elif node_type == "table.transpose":
        value = _require_table(upstream, "Transpose").transpose().reset_index(drop=True)
        table_result = value
    elif node_type == "table.slice":
        table = _require_table(upstream, "Slice")
        def slice_part(prefix: str) -> slice:
            start = params.get(f"{prefix}Start")
            stop = params.get(f"{prefix}Stop")
            step = int(params.get(f"{prefix}Step", 1) or 1)
            if step == 0: raise ValueError("Slice step cannot be zero")
            return slice(None if start in {None, ""} else int(start), None if stop in {None, ""} else int(stop), step)
        value = table.iloc[slice_part("row"), slice_part("column")].copy()
        table_result = value
    elif node_type == "table.reset_index":
        value = _require_table(upstream, "Reset index").reset_index(drop=_as_bool(params.get("drop", True)))
        table_result = value
    elif node_type == "table.periodic_window":
        table = _require_table(upstream, "Periodic window")
        group_size = int(params.get("groupSize", 75)); count = int(params.get("count", 25))
        if group_size < 1 or count < 1: raise ValueError("Periodic window sizes must be positive")
        position = str(params.get("position", "start"))
        offset = group_size - count if position == "end" else int(params.get("offset", 0)) if position == "offset" else 0
        rows = [row for base in range(0, len(table), group_size) for row in range(base + offset, min(base + offset + count, len(table)))]
        value = table.iloc[rows].reset_index(drop=True)
        table_result = value
    elif node_type == "table.periodic_tail_mean":
        table = _require_table(upstream, "Periodic tail mean")
        group_size = int(params.get("groupSize", 25)); tail_rows = int(params.get("tailRows", 10))
        if group_size < 1 or tail_rows < 1: raise ValueError("Periodic mean sizes must be positive")
        chunks = [table.iloc[start:start + group_size].tail(tail_rows).mean(numeric_only=True) for start in range(0, len(table), group_size) if len(table.iloc[start:start + group_size])]
        value = pd.DataFrame(chunks).reindex(columns=table.select_dtypes(include="number").columns)
        table_result = value
    elif node_type == "table.sort_index":
        value = _require_table(upstream, "Sort index").sort_index(axis=int(params.get("axis", 0)), ascending=_as_bool(params.get("ascending", True)))
        table_result = value
    elif node_type == "table.difference":
        table = _require_table(upstream, "Difference")
        value = table.diff(periods=int(params.get("periods", 1)), axis=int(params.get("axis", 0)))
        table_result = value
    elif node_type == "table.filter_range":
        value = _filter_range(_require_table(upstream, "Range filter"), params)
        table_result = value
    elif node_type == "table.rename_columns":
        value = _rename_columns(_require_table(upstream, "Rename columns"), params.get("names"))
        table_result = value
    elif node_type == "table.pivot":
        table = _require_table(upstream, "Pivot")
        index = _resolve_columns(table, params.get("index")); columns = _resolve_columns(table, params.get("columns")); values = _resolve_columns(table, params.get("values"))
        if len(index) != 1 or len(columns) != 1 or len(values) != 1: raise ValueError("Pivot requires one row key, column key, and value column")
        aggregate = str(params.get("aggregate", "mean"))
        if aggregate not in {"mean", "first", "max", "min"}: raise ValueError("Unsupported pivot aggregate")
        value = table.pivot_table(index=index[0], columns=columns[0], values=values[0], aggfunc=aggregate).sort_index().sort_index(axis=1)
        value.columns = [str(column) for column in value.columns]
        if _as_bool(params.get("resetIndex", True)): value = value.reset_index()
        table_result = value
    elif node_type == "pandas.dropna":
        table = _require_table(upstream, "Drop missing values")
        how = str(params.get("how", "any"))
        if how not in {"any", "all"}:
            raise ValueError("Drop missing values supports only any or all")
        subset = _resolve_columns(table, params.get("subset")) or None
        value = table.dropna(how=how, subset=subset).reset_index(drop=True)
        table_result = value
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
        table_result = value
    elif node_type == "pandas.sort_values":
        table = _require_table(upstream, "Sort values")
        columns = _resolve_columns(table, params.get("columns"))
        if not columns:
            raise ValueError("Sort values requires at least one column")
        na_position = str(params.get("naPosition", "last"))
        if na_position not in {"first", "last"}:
            raise ValueError("naPosition must be first or last")
        value = table.sort_values(by=columns, ascending=_as_bool(params.get("ascending", True)), na_position=na_position).reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.head":
        value = _require_table(upstream, "Head").head(int(params.get("n", 5))).reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.tail":
        value = _require_table(upstream, "Tail").tail(int(params.get("n", 5))).reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.drop_duplicates":
        table = _require_table(upstream, "Drop duplicates")
        subset = _resolve_columns(table, params.get("subset")) or None
        keep_raw = str(params.get("keep", "first"))
        keep: Any = False if keep_raw == "false" else keep_raw
        value = table.drop_duplicates(subset=subset, keep=keep, ignore_index=_as_bool(params.get("ignoreIndex", True)))
        table_result = value
    elif node_type == "pandas.sample":
        table = _require_table(upstream, "Sample")
        fraction = _optional_float(params.get("fraction"))
        replace = _as_bool(params.get("replace", False))
        count = _portable_sample_count(len(table), fraction, params.get("n", 5))
        indexes = _portable_sample_indexes(len(table), count, replace, int(params.get("randomState", 0)))
        value = table.iloc[indexes].copy()
        if _as_bool(params.get("ignoreIndex", True)):
            value = value.reset_index(drop=True)
        table_result = value
    elif node_type == "pandas.round":
        value = _require_table(upstream, "Round").round(decimals=int(params.get("decimals", 2)))
        table_result = value
    elif node_type == "pandas.describe":
        table = _require_table(upstream, "Describe")
        percentiles = [float(item) for item in _parameter_list(params.get("percentiles"))]
        include_text = str(params.get("include", "") or "").strip()
        exclude_text = str(params.get("exclude", "") or "").strip()
        include: Any = "all" if include_text == "all" else _parameter_list(include_text) or None
        exclude: Any = _parameter_list(exclude_text) or None
        value = table.describe(percentiles=percentiles or None, include=include, exclude=exclude).reset_index().rename(columns={"index": "statistic"})
        table_result = value
    elif node_type == "pandas.query":
        table = _require_table(upstream, "Query")
        expression = str(params.get("expression", "")).strip()
        if not expression:
            raise ValueError("Query expression is required")
        value = table.query(expression).reset_index(drop=True)
        table_result = value
    elif node_type == "logic.if_rows":
        table = _require_table(upstream, "Conditional branch")
        condition = str(params.get("condition", "")).strip()
        if not condition:
            raise ValueError("Conditional branch requires a condition")
        working = table.reset_index(drop=True)
        matching = working.query(condition)
        rejected = working.loc[~working.index.isin(matching.index)]
        outputs = {"true": matching.reset_index(drop=True), "false": rejected.reset_index(drop=True)}
        return outputs, outputs["true"], plot_result, export_result
    elif node_type == "logic.merge_rows":
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
    elif node_type in {"table.group_mean", "table.group_aggregate"}:
        if node_type == "table.group_mean":
            params = {**params, "method": "mean", "startRow": 0, "endRow": params.get("groupSize", 20)}
        value = _group_aggregate(_require_table(upstream, "Group aggregate"), params)
        table_result = value
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
        table_result = value
    elif node_type == "analysis.ter_matrix":
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
    elif node_type == "pulse.generate_oscillating_ramp":
        value = _oscillating_pulse_ramp(params)
        table_result = value
    elif node_type == "pulse.combine_channels":
        value = _pulse_combine_channels(upstream, params)
        table_result = value
    elif node_type == "pulse.segment_measurement":
        value = _pulse_segment_measurement(upstream, params)
        table_result = value
    elif node_type == "plot.line":
        table = _require_table(upstream, "Line plot")
        x_column = _resolve_column(table, params["xColumn"]) if str(params.get("xColumn", "")).strip() else None
        y_columns = _resolve_columns(table, params.get("yColumns"))
        figure_width = float(params.get("figureWidth", 8))
        figure_height = float(params.get("figureHeight", 4.5))
        dpi = int(params.get("dpi", 120))
        if not 2 <= figure_width <= 30 or not 2 <= figure_height <= 30 or not 48 <= dpi <= 600:
            raise ValueError("Plot size or DPI is outside the supported range")
        figure, axis = plt.subplots(figsize=(figure_width, figure_height), dpi=dpi)
        try:
            table.plot(
                ax=axis,
                x=x_column,
                y=y_columns or None,
                logx=_as_bool(params.get("logX", False)),
                logy=_as_bool(params.get("logY", False)),
                legend=_as_bool(params.get("legend", True)),
                linestyle=str(params.get("lineStyle", "-")),
                marker=str(params.get("marker", "")) or None,
                linewidth=float(params.get("lineWidth", 1.5)),
            )
            title = str(params.get("title", "")).strip()
            x_label = str(params.get("xLabel", "")).strip()
            y_label = str(params.get("yLabel", "")).strip()
            if title:
                axis.set_title(title)
            if x_label:
                axis.set_xlabel(x_label)
            if y_label:
                axis.set_ylabel(y_label)
            axis.grid(_as_bool(params.get("grid", True)), alpha=0.25)
            _apply_scientific_notation(axis, params, x=True, y=True)
            figure.tight_layout()
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png")
        finally:
            plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = plot_result
    elif node_type in {"plot.scatter", "plot.bar", "plot.histogram", "plot.box", "plot.area"}:
        table = _require_table(upstream, node_type)
        kind = {"plot.scatter": "scatter", "plot.bar": "bar", "plot.histogram": "hist", "plot.box": "box", "plot.area": "area"}[node_type]
        x_column = _resolve_column(table, params["xColumn"]) if str(params.get("xColumn", "")).strip() else None
        y_columns = _resolve_columns(table, params.get("yColumns"))
        numeric = table.select_dtypes(include="number")
        if kind in {"hist", "box"} and numeric.empty: raise ValueError(f"{node_type} requires numeric columns")
        figure, axis = plt.subplots(figsize=(float(params.get("figureWidth", 8)), float(params.get("figureHeight", 4.5))), dpi=int(params.get("dpi", 120)))
        try:
            if kind == "scatter":
                if x_column is None or len(y_columns) != 1: raise ValueError("Scatter plot requires one X column and one Y column")
                table.plot(kind=kind, ax=axis, x=x_column, y=y_columns[0], s=float(params.get("pointSize", 24)), alpha=float(params.get("alpha", 0.8)))
            elif kind == "hist":
                numeric[y_columns] if y_columns else numeric
                (numeric[y_columns] if y_columns else numeric).plot(kind=kind, ax=axis, bins=int(params.get("bins", 20)), alpha=float(params.get("alpha", 0.8)))
            elif kind == "box":
                (numeric[y_columns] if y_columns else numeric).plot(kind=kind, ax=axis)
            else:
                table.plot(kind=kind, ax=axis, x=x_column, y=y_columns or None, legend=_as_bool(params.get("legend", True)), alpha=float(params.get("alpha", 0.85)))
            axis.set_title(str(params.get("title", "")))
            axis.set_xlabel(str(params.get("xLabel", "")))
            axis.set_ylabel(str(params.get("yLabel", "")))
            axis.grid(_as_bool(params.get("grid", True)), alpha=.25)
            _apply_scientific_notation(axis, params, x=True, y=True)
            figure.tight_layout()
            buffer = io.BytesIO(); figure.savefig(buffer, format="png")
        finally: plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = plot_result
    elif node_type == "plot.heatmap":
        table = _require_table(upstream, "Heatmap")
        label_raw = str(params.get("rowLabelColumn", "")).strip()
        label_column = _resolve_column(table, label_raw) if label_raw else None
        labels = table[label_column].astype(str).tolist() if label_column is not None else [str(item) for item in table.index]
        matrix = table.drop(columns=[label_column]) if label_column is not None else table
        matrix = matrix.apply(pd.to_numeric, errors="coerce")
        if matrix.empty or not matrix.notna().any().any():
            raise ValueError("Heatmap requires at least one numeric value column")
        figure_width = float(params.get("figureWidth", 9))
        figure_height = float(params.get("figureHeight", 6))
        dpi = int(params.get("dpi", 160))
        if not 2 <= figure_width <= 30 or not 2 <= figure_height <= 30 or not 48 <= dpi <= 600:
            raise ValueError("Heatmap size or DPI is outside the supported range")
        x_tick_interval = int(params.get("xTickInterval", 1))
        y_tick_interval = int(params.get("yTickInterval", 1))
        x_tick_rotation = float(params.get("xTickRotation", 45))
        if x_tick_interval < 1 or y_tick_interval < 1:
            raise ValueError("Heatmap tick intervals must be at least 1")
        if not 0 <= x_tick_rotation <= 360:
            raise ValueError("Heatmap X tick rotation must be between 0 and 360 degrees")
        origin = str(params.get("origin", "lower"))
        aspect = str(params.get("aspect", "auto"))
        interpolation = str(params.get("interpolation", "nearest"))
        if origin not in {"lower", "upper"} or aspect not in {"auto", "equal"} or interpolation not in {"nearest", "none", "bilinear", "bicubic"}:
            raise ValueError("Heatmap origin, aspect, or interpolation is unsupported")
        color_min = _optional_float(params.get("colorMin"))
        color_max = _optional_float(params.get("colorMax"))
        if color_min is not None and color_max is not None and color_min >= color_max:
            raise ValueError("Heatmap colorMin must be smaller than colorMax")
        figure, axis = plt.subplots(figsize=(figure_width, figure_height), dpi=dpi, constrained_layout=True)
        try:
            image = axis.imshow(
                matrix.to_numpy(dtype=float), aspect=aspect, origin=origin, interpolation=interpolation,
                cmap=str(params.get("colorMap", "viridis")), vmin=color_min, vmax=color_max,
            )
            x_positions = list(range(0, len(matrix.columns), x_tick_interval))
            y_positions = list(range(0, len(labels), y_tick_interval))
            axis.set_xticks(x_positions, [str(matrix.columns[index]) for index in x_positions], rotation=x_tick_rotation, ha="right")
            axis.set_yticks(y_positions, [labels[index] for index in y_positions])
            axis.set_title(str(params.get("title", "")).strip())
            axis.set_xlabel(str(params.get("xLabel", "")).strip())
            axis.set_ylabel(str(params.get("yLabel", "")).strip())
            if _as_bool(params.get("showColorBar", True)):
                colorbar = figure.colorbar(image, ax=axis, pad=0.02)
                colorbar.set_label(str(params.get("colorBarLabel", "")).strip())
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
        finally:
            plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = plot_result
    elif node_type == "io.export_csv":
        export_result = _require_table(upstream, "Export CSV").to_csv(index=False, lineterminator="\n")
        value = export_result
    elif node_type == "convert.to_text":
        value = _printable(upstream) if _as_bool(params.get("pretty", True)) else str(upstream)
    elif node_type == "convert.to_number":
        raw = _single_value(upstream)
        number = float(raw)
        value = _round_half_away(number) if _as_bool(params.get("integer", False)) else number
    elif node_type == "convert.to_boolean":
        raw = _single_value(upstream)
        if isinstance(raw, str):
            token = raw.strip().lower()
            if token in {"true", "1", "yes", "y", "是", "真"}: value = True
            elif token in {"false", "0", "no", "n", "否", "假", "", "none", "null"}: value = False
            else: raise ValueError(f"无法将文本 {raw!r} 转换为布尔值")
        else: value = bool(raw)
    elif node_type == "convert.to_table":
        if isinstance(upstream, pd.DataFrame): value = upstream.copy()
        elif isinstance(upstream, pd.Series): value = upstream.to_frame()
        elif _as_bool(params.get("csvText", False)) and isinstance(upstream, str): value = pd.read_csv(io.StringIO(upstream))
        elif isinstance(upstream, dict):
            try: value = pd.DataFrame(upstream)
            except ValueError: value = pd.DataFrame([upstream])
        elif isinstance(upstream, (list, tuple, np.ndarray)): value = pd.DataFrame(upstream)
        else: value = pd.DataFrame({"value": [upstream]})
        table_result = value
    elif node_type == "convert.table_to_records":
        value = _require_table(upstream, "Table to records").to_dict(orient="records")
    elif node_type == "convert.table_to_csv":
        value = _require_table(upstream, "Table to CSV").to_csv(index=_as_bool(params.get("includeIndex", False)), lineterminator="\n")
    elif node_type == "convert.json_parse":
        value = json.loads(str(upstream))
    elif node_type == "convert.json_stringify":
        value = json.dumps(upstream, ensure_ascii=False, indent=max(0, min(8, int(params.get("indent", 2)))), default=str)
    elif node_type == "python.len":
        value = len(upstream)
    elif node_type == "python.round":
        if not isinstance(upstream, (int, float)):
            raise ValueError("Python round requires a numeric input")
        value = _round_half_away(upstream, int(params.get("digits", 0)))
    elif node_type == "python.print":
        prefix = str(params.get("prefix", "")).strip()
        rendered = _printable(upstream, max(100, int(params.get("maxChars", 8000))), max(1, int(params.get("maxRows", 20))), str(params.get("format", "pretty")), _as_bool(params.get("includeType", True)), str(params.get("encoding", "utf-8")), str(params.get("encodingErrors", "replace")), str(params.get("bytesFormat", "decode")))
        # Keep the node a transparent tap in the workflow: it reports a bounded
        # printable value while passing the original object to downstream nodes.
        rendered = (f"{prefix}：" if prefix else "") + rendered + str(params.get("end", ""))
        return {"output": upstream, "__print__": rendered}, table_result, plot_result, export_result
    elif node_type == "ui.alert":
        content = upstream.get("content") if isinstance(upstream, dict) else upstream
        rendered = f"{str(params.get('title', '提示')).strip()}：{str(params.get('message', '')).strip()}"
        if content is not None:
            rendered += "\n" + _printable(content, 4000, 20, "pretty", True)
        response = params.get("response")
        reported = f"{rendered}\n选择：{response!r}"
        return {"output": response, "__print__": reported[:1000]}, table_result, plot_result, export_result
    elif node_type == "ui.input_dialog":
        raw_value = params.get("value", "")
        input_kind = str(params.get("inputKind", "text"))
        if input_kind == "number":
            try:
                value = float(raw_value)
                if value.is_integer(): value = int(value)
            except (TypeError, ValueError):
                raise ValueError("弹窗输入节点需要有效数值")
        elif input_kind == "boolean":
            value = _as_bool(raw_value)
        elif input_kind == "json":
            try: value = json.loads(str(raw_value))
            except json.JSONDecodeError as exception: raise ValueError(f"弹窗输入的 JSON 无效：{exception.msg}") from exception
        elif input_kind == "table":
            text = str(raw_value).strip()
            try:
                value = pd.DataFrame(json.loads(text))
            except (json.JSONDecodeError, TypeError, ValueError):
                value = pd.read_csv(io.StringIO(text), sep=None, engine="python")
            table_result = value
        else:
            value = str(raw_value)
    elif node_type == "variable.set":
        name = str(params.get("name", "")).strip()
        if not name: raise ValueError("Set variable requires a name")
        if variables is not None:
            variables[name] = upstream
        value = upstream
    elif node_type == "variable.get":
        name = str(params.get("name", "")).strip()
        if not name: raise ValueError("Get variable requires a name")
        if variables is None or name not in variables:
            raise ValueError(f"Variable {name!r} is not defined; add a 设置变量 node before reading it")
        value = variables[name]
    elif node_type == "custom.python_function":
        outputs = _execute_custom_function(str(params.get("code", "")), upstream, params)
        table_result = next((item for item in outputs.values() if isinstance(item, pd.DataFrame)), None)
        return outputs, table_result, plot_result, export_result
    else:
        raise ValueError(f"Unsupported node type: {node_type}")

    return {"output": value}, table_result, plot_result, export_result
