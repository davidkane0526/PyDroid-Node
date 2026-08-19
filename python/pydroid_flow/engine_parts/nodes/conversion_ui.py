from __future__ import annotations

import io
import json
from typing import Any

import numpy as np
import pandas as pd

from ..custom_function import _execute_custom_function
from ..presentation import _printable
from ..values import _as_bool, _round_half_away, _single_value, _require_table

NODE_TYPES = {
    "io.export_csv",
    "convert.to_text",
    "convert.to_number",
    "convert.to_boolean",
    "convert.to_table",
    "convert.table_to_records",
    "convert.table_to_csv",
    "convert.json_parse",
    "convert.json_stringify",
    "python.len",
    "python.round",
    "python.print",
    "ui.alert",
    "ui.input_dialog",
    "custom.python_function",
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
    export_result: str | None = None

    if node_type == "io.export_csv":
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
            if token in {"true", "1", "yes", "y", "是", "真"}:
                value = True
            elif token in {"false", "0", "no", "n", "否", "假", "", "none", "null"}:
                value = False
            else:
                raise ValueError(f"无法将文本 {raw!r} 转换为布尔值")
        else:
            value = bool(raw)
    elif node_type == "convert.to_table":
        if isinstance(upstream, pd.DataFrame):
            value = upstream.copy()
        elif isinstance(upstream, pd.Series):
            value = upstream.to_frame()
        elif _as_bool(params.get("csvText", False)) and isinstance(upstream, str):
            value = pd.read_csv(io.StringIO(upstream))
        elif isinstance(upstream, dict):
            try:
                value = pd.DataFrame(upstream)
            except ValueError:
                value = pd.DataFrame([upstream])
        elif isinstance(upstream, (list, tuple, np.ndarray)):
            value = pd.DataFrame(upstream)
        else:
            value = pd.DataFrame({"value": [upstream]})
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
        rendered = (f"{prefix}：" if prefix else "") + rendered + str(params.get("end", ""))
        return {"output": upstream, "__print__": rendered}, table_result, None, export_result
    elif node_type == "ui.alert":
        content = upstream.get("content") if isinstance(upstream, dict) else upstream
        rendered = f"{str(params.get('title', '提示')).strip()}：{str(params.get('message', '')).strip()}"
        if content is not None:
            rendered += "\n" + _printable(content, 4000, 20, "pretty", True)
        response = params.get("response")
        reported = f"{rendered}\n选择：{response!r}"
        return {"output": response, "__print__": reported[:1000]}, table_result, None, export_result
    elif node_type == "ui.input_dialog":
        raw_value = params.get("value", "")
        input_kind = str(params.get("inputKind", "text"))
        if input_kind == "number":
            try:
                value = float(raw_value)
                if value.is_integer():
                    value = int(value)
            except (TypeError, ValueError):
                raise ValueError("弹窗输入节点需要有效数值")
        elif input_kind == "boolean":
            value = _as_bool(raw_value)
        elif input_kind == "json":
            try:
                value = json.loads(str(raw_value))
            except json.JSONDecodeError as exception:
                raise ValueError(f"弹窗输入的 JSON 无效：{exception.msg}") from exception
        elif input_kind == "table":
            text = str(raw_value).strip()
            try:
                value = pd.DataFrame(json.loads(text))
            except (json.JSONDecodeError, TypeError, ValueError):
                value = pd.read_csv(io.StringIO(text), sep=None, engine="python")
            table_result = value
        else:
            value = str(raw_value)
    elif node_type == "custom.python_function":
        outputs = _execute_custom_function(str(params.get("code", "")), upstream, params)
        table_result = next((item for item in outputs.values() if isinstance(item, pd.DataFrame)), None)
        return outputs, table_result, None, export_result
    else:
        raise ValueError(f"Unsupported conversion/UI node type: {node_type}")

    return {"output": value}, table_result, None, export_result
