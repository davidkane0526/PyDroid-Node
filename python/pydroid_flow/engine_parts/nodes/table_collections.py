from __future__ import annotations

import math
import re
from numbers import Real
from typing import Any

import pandas as pd

from ..values import _require_table

NODE_TYPES = {"table.concat_many"}


def execute(
    node_type: str,
    params: dict[str, Any],
    upstream: Any,
    csv_text: str,
    input_files: list[dict[str, Any]],
    variables: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], pd.DataFrame | None, str | None, str | None]:
    del csv_text, input_files, variables
    if node_type == "table.concat_many":
        if not isinstance(upstream, dict):
            raise ValueError("Concat many requires named inputs")
        raw_tables = upstream.get("tables")
        if isinstance(raw_tables, list) and raw_tables:
            tables = [_require_table(item, f"Concat many table {index + 1}") for index, item in enumerate(raw_tables)]
        else:
            named = sorted(
                ((int(match.group(1)), value) for key, value in upstream.items() if (match := re.fullmatch(r"table(\d+)", str(key)))),
                key=lambda item: item[0],
            )
            if len(named) < 2:
                raise ValueError("Concat many requires a non-empty table list or at least two table Socket inputs")
            tables = [_require_table(value, f"Concat many table {index}") for index, value in named]
        alignment = str(params.get("alignment", "index"))
        if alignment not in {"index", "position"}:
            raise ValueError(f"Unsupported concat_many alignment: {alignment}")
        prefix_mode = str(params.get("prefixMode", "metadata"))
        source_column = str(params.get("sourceColumn", "source_file")).strip() or "source_file"
        prefix_column = str(params.get("prefixColumn", "Vg_V")).strip() or "Vg_V"
        prefix_template = str(params.get("prefixTemplate", "{value}"))
        prefix_separator = str(params.get("prefixSeparator", "_"))
        metadata: pd.DataFrame | None = None
        if prefix_mode != "none":
            metadata = _require_table(upstream.get("metadata"), "Concat many metadata")
            if len(metadata) != len(tables):
                raise ValueError(f"Concat many metadata rows ({len(metadata)}) must match table count ({len(tables)})")

        def metadata_text(value: Any) -> str:
            if isinstance(value, Real) and not isinstance(value, bool):
                number = float(value)
                if not math.isfinite(number):
                    raise ValueError("Concat many metadata prefix must be finite")
                if number == 0:
                    return "0"
                if number.is_integer():
                    return str(int(number))
                magnitude = abs(number)
                if magnitude >= 1e15 or magnitude < 1e-6:
                    mantissa, exponent = f"{number:.14e}".split("e")
                    mantissa = mantissa.rstrip("0").rstrip(".")
                    exponent_value = int(exponent)
                    return f"{mantissa}e{'+' if exponent_value >= 0 else ''}{exponent_value}"
                return f"{number:.14f}".rstrip("0").rstrip(".")
            return str(value)

        def render_prefix(row: pd.Series, field: str) -> str:
            if field not in row.index or pd.isna(row[field]) or str(row[field]).strip() == "":
                raise ValueError(f"Concat many metadata field {field} is missing")
            value = row[field]

            def replace(match: Any) -> str:
                key = match.group(1)
                replacement = value if key == "value" else row.get(key, None)
                if replacement is None or pd.isna(replacement):
                    raise ValueError(f"Concat many prefix template references missing metadata field {key}")
                return metadata_text(replacement)

            return re.sub(r"\{([^{}]+)\}", replace, prefix_template)

        prepared: list[pd.DataFrame] = []
        for index, frame in enumerate(tables):
            part = frame.reset_index(drop=True) if alignment == "position" else frame.copy()
            if prefix_mode == "metadata":
                assert metadata is not None
                prefix = render_prefix(metadata.iloc[index], prefix_column)
                part = part.rename(columns={column: f"{prefix}{prefix_separator}{column}" for column in part.columns})
            elif prefix_mode == "source_file":
                assert metadata is not None
                prefix = render_prefix(metadata.iloc[index], source_column)
                part = part.rename(columns={column: f"{prefix}{prefix_separator}{column}" for column in part.columns})
            elif prefix_mode != "none":
                raise ValueError(f"Unsupported concat_many prefixMode: {prefix_mode}")
            prepared.append(part)
        all_columns = [str(column) for frame in prepared for column in frame.columns]
        if len(set(all_columns)) != len(all_columns):
            raise ValueError("Concat many would create duplicate column names; enable a distinguishing prefix")
        value = pd.concat(prepared, axis=1)
    else:
        raise ValueError(f"Unsupported table collection node: {node_type}")
    return {"output": value}, value, None, None
