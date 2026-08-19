from __future__ import annotations

import io
import re
from typing import Any

import pandas as pd

from .values import _as_bool, _decode_json_compatible, _parameter_list

def _read_csv(csv_text: str, params: dict[str, Any]) -> pd.DataFrame:
    separator = str(params.get("separator", ","))
    separator = "\t" if separator == "\\t" else separator
    if not separator:
        raise ValueError("CSV separator cannot be empty")

    header_raw = str(params.get("header", "none")).strip().lower()
    header: Any = None if header_raw in {"", "none"} else "infer" if header_raw == "infer" else int(header_raw)
    engine = str(params.get("engine", "c") or "c")
    skip_footer = int(params.get("skipFooter", 0) or 0)
    if skip_footer and engine == "c":
        engine = "python"

    kwargs: dict[str, Any] = {
        "sep": separator,
        "header": header,
        "engine": engine,
        "skipinitialspace": _as_bool(params.get("skipInitialSpace", False)),
        "skipfooter": skip_footer,
        "keep_default_na": _as_bool(params.get("keepDefaultNa", True)),
        "na_filter": _as_bool(params.get("naFilter", True)),
        "skip_blank_lines": _as_bool(params.get("skipBlankLines", True)),
        "dayfirst": _as_bool(params.get("dayFirst", False)),
        "cache_dates": _as_bool(params.get("cacheDates", True)),
        "decimal": str(params.get("decimal", ".") or "."),
        "quotechar": str(params.get("quoteChar", "\"") or "\""),
        "quoting": int(params.get("quoting", 0) or 0),
        "doublequote": _as_bool(params.get("doubleQuote", True)),
        "on_bad_lines": str(params.get("onBadLines", "error") or "error"),
    }

    names = _parameter_list(params.get("names"))
    use_columns = _parameter_list(params.get("useColumns"), numeric_when_possible=True)
    na_values = _parameter_list(params.get("naValues"))
    true_values = _parameter_list(params.get("trueValues"))
    false_values = _parameter_list(params.get("falseValues"))
    parse_dates = _parameter_list(params.get("parseDates"), numeric_when_possible=True)
    if names:
        kwargs["names"] = names
    if use_columns:
        kwargs["usecols"] = use_columns
    if na_values:
        kwargs["na_values"] = na_values
    if true_values:
        kwargs["true_values"] = true_values
    if false_values:
        kwargs["false_values"] = false_values
    if parse_dates:
        kwargs["parse_dates"] = parse_dates

    dtype_text = str(params.get("dtype", "") or "").strip()
    if dtype_text:
        kwargs["dtype"] = _decode_json_compatible(dtype_text, "dtype 参数") if dtype_text.startswith("{") else dtype_text

    index_column = str(params.get("indexColumn", "") or "").strip()
    if index_column:
        kwargs["index_col"] = int(index_column) if index_column.lstrip("-").isdigit() else index_column

    skip_rows = params.get("skipRows", 0)
    if str(skip_rows).strip() not in {"", "0"}:
        text = str(skip_rows).strip()
        kwargs["skiprows"] = _parameter_list(text, numeric_when_possible=True) if "," in text or text.startswith("[") else int(text)

    optional_numbers = {"nRows": "nrows"}
    for parameter, pandas_name in optional_numbers.items():
        raw = params.get(parameter)
        if raw is not None and str(raw).strip() not in {"", "0"}:
            kwargs[pandas_name] = int(raw)

    optional_strings = {
        "dateFormat": "date_format", "thousands": "thousands", "escapeChar": "escapechar",
        "comment": "comment", "lineTerminator": "lineterminator", "dialect": "dialect",
    }
    for parameter, pandas_name in optional_strings.items():
        value = str(params.get(parameter, "") or "")
        if value:
            kwargs[pandas_name] = value

    if engine == "c":
        kwargs["low_memory"] = _as_bool(params.get("lowMemory", True))
        float_precision = str(params.get("floatPrecision", "") or "")
        if float_precision:
            kwargs["float_precision"] = float_precision

    frame = pd.read_csv(io.StringIO(csv_text), **kwargs)
    frame.columns = [str(column) for column in frame.columns]
    return frame

def _read_csv_batch(input_files: list[dict[str, Any]], params: dict[str, Any]) -> pd.DataFrame:
    if not input_files:
        raise ValueError("Batch CSV input requires at least one selected file")
    source_column = str(params.get("sourceColumn", "source_file")).strip() or "source_file"
    metadata_column = str(params.get("metadataColumn", "Vg_V")).strip()
    filename_pattern = str(params.get("filenamePattern", r"vg\s*=\s*([-+]?\d+(?:\.\d+)?)\s*v")).strip()
    on_error = str(params.get("onError", "error"))
    frames: list[pd.DataFrame] = []
    errors: list[str] = []
    for item in input_files:
        name = str(item.get("name", "unnamed.csv"))
        text = item.get("text")
        if not isinstance(text, str):
            errors.append(f"{name}: missing text content")
            continue
        try:
            frame = _read_csv(text, params)
            frame[source_column] = name
            if metadata_column and filename_pattern:
                match = re.search(filename_pattern, name, flags=re.IGNORECASE)
                if not match:
                    raise ValueError(f"filename does not match pattern {filename_pattern!r}")
                captured = match.group(1) if match.groups() else match.group(0)
                try:
                    captured = float(captured)
                except ValueError:
                    pass
                frame[metadata_column] = captured
            frames.append(frame)
        except Exception as exception:
            errors.append(f"{name}: {exception}")
    if errors and on_error == "error":
        raise ValueError("Batch CSV errors: " + "; ".join(errors))
    if not frames:
        raise ValueError("No CSV file could be read")
    return pd.concat(frames, ignore_index=True)
