from __future__ import annotations

import base64
import io
import json
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from ..plot_series import legend_state_value, series_registry, series_value
from ..presentation import _apply_scientific_notation
from ..values import _as_bool, _optional_float, _require_table, _resolve_column, _resolve_columns

NODE_TYPES = {
    "plot.series",
    "plot.legend_state",
    "plot.series_registry",
    "plot.line",
    "plot.scatter",
    "plot.bar",
    "plot.histogram",
    "plot.box",
    "plot.area",
    "plot.heatmap",
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
    plot_result: str | None = None

    if node_type == "plot.series":
        value = series_value(params)
    elif node_type == "plot.legend_state":
        value = legend_state_value(params)
    elif node_type == "plot.series_registry":
        value = series_registry(upstream, params)
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
            raw_series = params.get("seriesConfig")
            if isinstance(raw_series, list):
                series_config = raw_series
            else:
                series_text = str(raw_series or "").strip()
                if series_text:
                    try:
                        series_config = json.loads(series_text)
                    except (TypeError, ValueError) as exception:
                        raise ValueError("Line plot seriesConfig must be a JSON array") from exception
                else:
                    series_config = []
            if series_config:
                if not isinstance(series_config, list) or not all(isinstance(item, dict) for item in series_config):
                    raise ValueError("Line plot seriesConfig must be an array of objects")
                x_values = table[x_column] if x_column is not None else table.index
                visible_count = 0
                for item in series_config:
                    if not _as_bool(item.get("visible", True)):
                        continue
                    y_raw = item.get("y", item.get("column"))
                    if y_raw is None or str(y_raw).strip() == "":
                        raise ValueError("Line plot series item requires y")
                    y_column = _resolve_column(table, y_raw)
                    width = float(item.get("lineWidth", params.get("lineWidth", 1.5)))
                    if not 0 < width <= 20:
                        raise ValueError("Line plot series lineWidth must be between 0 and 20")
                    axis.plot(
                        x_values, table[y_column],
                        label=str(item.get("label", y_column)),
                        linestyle=str(item.get("lineStyle", params.get("lineStyle", "-"))),
                        marker=str(item.get("marker", params.get("marker", ""))) or None,
                        linewidth=width,
                    )
                    visible_count += 1
                axis.set_xscale("log" if _as_bool(params.get("logX", False)) else "linear")
                axis.set_yscale("log" if _as_bool(params.get("logY", False)) else "linear")
                if visible_count and _as_bool(params.get("legend", True)):
                    axis.legend()
            else:
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
        if kind in {"hist", "box"} and numeric.empty:
            raise ValueError(f"{node_type} requires numeric columns")
        figure, axis = plt.subplots(figsize=(float(params.get("figureWidth", 8)), float(params.get("figureHeight", 4.5))), dpi=int(params.get("dpi", 120)))
        try:
            if kind == "scatter":
                if x_column is None or len(y_columns) != 1:
                    raise ValueError("Scatter plot requires one X column and one Y column")
                table.plot(kind=kind, ax=axis, x=x_column, y=y_columns[0], s=float(params.get("pointSize", 24)), alpha=float(params.get("alpha", 0.8)))
            elif kind == "hist":
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
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png")
        finally:
            plt.close(figure)
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
    else:
        raise ValueError(f"Unsupported plot node type: {node_type}")

    return {"output": value}, None, plot_result, None
