from __future__ import annotations

from typing import Any

from .values import _as_bool, _parameter_list


def series_value(params: dict[str, Any]) -> dict[str, Any]:
    y = params.get("y")
    if y is None or str(y).strip() == "":
        raise ValueError("Series requires a Y column")
    line_style = str(params.get("lineStyle", "-"))
    marker = str(params.get("marker", ""))
    line_width = float(params.get("lineWidth", 1.5))
    if line_style not in {"-", "--", "-.", ":"}:
        raise ValueError(f"Unsupported Series lineStyle: {line_style}")
    if marker not in {"", "o", "s", "^", "."}:
        raise ValueError(f"Unsupported Series marker: {marker}")
    if not 0 < line_width <= 20:
        raise ValueError("Series lineWidth must be between 0 and 20")
    value: dict[str, Any] = {
        "y": y,
        "visible": _as_bool(params.get("visible", True)),
        "lineStyle": line_style,
        "marker": marker,
        "lineWidth": line_width,
    }
    label = str(params.get("label", "")).strip()
    group = str(params.get("group", "")).strip()
    legend_group = str(params.get("legendGroup", "")).strip()
    if label:
        value["label"] = label
    if group:
        value["group"] = group
    if legend_group:
        value["legendGroup"] = legend_group
    if _as_bool(params.get("solo", False)):
        value["solo"] = True
    return value


def series_registry(upstream: Any, params: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(upstream, dict):
        raise ValueError("Series Registry requires named Series inputs")
    entries: list[tuple[int, dict[str, Any]]] = []
    for port, item in upstream.items():
        if not str(port).startswith("series"):
            continue
        try:
            order = int(str(port)[6:])
        except ValueError as exception:
            raise ValueError(f"Invalid Series Registry input port: {port}") from exception
        if not isinstance(item, dict):
            raise ValueError(f"Series Registry input {port} must be a Series object")
        entries.append((order, item))
    expected = int(params.get("seriesCount", len(entries) or 1))
    entries.sort(key=lambda item: item[0])
    if len(entries) != expected:
        raise ValueError(f"Series Registry requires {expected} connected Series inputs")
    group_mode = str(params.get("groupMode", "all"))
    if group_mode not in {"all", "include", "exclude"}:
        raise ValueError(f"Unsupported Series Registry groupMode: {group_mode}")
    groups = {str(item).strip() for item in _parameter_list(params.get("groups")) if str(item).strip()}
    if group_mode != "all" and not groups:
        raise ValueError("Series Registry group filter requires at least one group")
    value: list[dict[str, Any]] = []
    for _, item in entries:
        result = dict(item)
        currently_visible = _as_bool(result.get("visible", True))
        group = str(result.get("group", "")).strip()
        group_match = group in groups
        result["visible"] = currently_visible and (group_mode == "all" or (group_match if group_mode == "include" else not group_match))
        value.append(result)
    has_solo = any(_as_bool(item.get("visible", True)) and _as_bool(item.get("solo", False)) for item in value)
    if has_solo:
        for item in value:
            item["visible"] = _as_bool(item.get("visible", True)) and _as_bool(item.get("solo", False))
    return value
