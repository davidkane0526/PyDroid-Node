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

from ..io_readers import _read_csv, _read_csv_batch, _read_csv_collection
from ..random_portable import _PortableRandom
from ..values import _as_bool, _decode_json_compatible

NODE_TYPES = {
    "io.read_text",
    "io.read_json",
    "io.read_table",
    "io.read_image",
    "io.read_csv",
    "io.read_csv_batch",
    "io.read_csv_collection",
    "generate.empty_list",
    "generate.empty_table",
    "generate.random_table",
}


def execute(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    del upstream, variables
    table_result: pd.DataFrame | None = None
    plot_result: str | None = None

    def selected_file() -> dict[str, Any]:
        if not input_files:
            raise ValueError("该读取节点需要先选择或拖入文件")
        index = int(params.get("fileIndex", 0))
        if index < 0 or index >= len(input_files):
            raise ValueError(f"文件序号 {index} 超出范围；当前共 {len(input_files)} 个文件")
        return input_files[index]

    if node_type == "io.read_text":
        value = str(selected_file().get("text", ""))
    elif node_type == "io.read_json":
        value = _decode_json_compatible(str(selected_file().get("text", "")), "JSON 文件")
    elif node_type == "io.read_table":
        item = selected_file()
        text = str(item.get("text", ""))
        name = str(item.get("name", "")).lower()
        if name.endswith(".json"):
            decoded = _decode_json_compatible(text, "JSON 表格")
            value = pd.DataFrame(decoded if isinstance(decoded, list) else [decoded])
        else:
            separator = str(params.get("separator", "auto"))
            if separator == "auto":
                separator = "\t" if name.endswith((".tsv", ".dat")) and "\t" in text.partition("\n")[0] else None
            value = pd.read_csv(io.StringIO(text), sep=separator, engine="python" if separator is None else "c", header=0 if _as_bool(params.get("header", True)) else None)
        table_result = value
    elif node_type == "io.read_image":
        item = selected_file()
        encoded = str(item.get("base64", ""))
        if not encoded:
            raise ValueError("图片读取需要原始二进制内容；请重新选择图片文件")
        image = plt.imread(io.BytesIO(base64.b64decode(encoded)))
        figure, axis = plt.subplots(figsize=(8, 6))
        axis.imshow(image)
        axis.axis("off")
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", dpi=120, bbox_inches="tight")
        plt.close(figure)
        plot_result = base64.b64encode(buffer.getvalue()).decode("ascii")
        value = figure
    elif node_type == "io.read_csv":
        value = _read_csv(csv_text, params)
        table_result = value
    elif node_type == "io.read_csv_batch":
        value = _read_csv_batch(input_files, params)
        table_result = value
    elif node_type == "io.read_csv_collection":
        tables, metadata, warnings = _read_csv_collection(input_files, params)
        return {"output": tables, "metadata": metadata, "warnings": warnings}, metadata, None, None
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
    else:
        raise ValueError(f"Unsupported IO/generate node type: {node_type}")

    return {"output": value}, table_result, plot_result, None
