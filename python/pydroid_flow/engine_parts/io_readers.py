from __future__ import annotations

import io
import re
from typing import Any

import numpy as np
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


def _read_csv_collection(input_files: list[dict[str, Any]], params: dict[str, Any]) -> tuple[list[pd.DataFrame], pd.DataFrame, list[str]]:
    if not input_files:
        raise ValueError("Batch CSV collection input requires at least one selected file")
    source_column = str(params.get("sourceColumn", "source_file")).strip() or "source_file"
    metadata_column = str(params.get("metadataColumn", "Vg_V")).strip()
    filename_pattern = str(params.get("filenamePattern", r"gate-([-+]?\d+(?:\.\d+)?)v")).strip()
    metadata_type = str(params.get("metadataType", "number"))
    metadata_error = str(params.get("metadataError", "error"))
    duplicate_metadata = str(params.get("duplicateMetadata", "error"))
    order_by = str(params.get("orderBy", "metadata_asc" if filename_pattern and metadata_column else "source_file"))
    on_error = str(params.get("onError", "error"))
    if metadata_type not in {"number", "text"}:
        raise ValueError(f"Unsupported CSV collection metadataType: {metadata_type}")
    if metadata_error not in {"error", "warn"}:
        raise ValueError(f"Unsupported CSV collection metadataError: {metadata_error}")
    if duplicate_metadata not in {"error", "warn"}:
        raise ValueError(f"Unsupported CSV collection duplicateMetadata: {duplicate_metadata}")
    if on_error not in {"error", "skip"}:
        raise ValueError(f"Unsupported CSV collection onError: {on_error}")
    if filename_pattern and metadata_column and metadata_column == source_column:
        raise ValueError("CSV collection metadataColumn must differ from sourceColumn")
    warnings: list[str] = []
    failures: list[str] = []
    entries: list[dict[str, Any]] = []
    try:
        pattern = re.compile(filename_pattern, flags=re.IGNORECASE) if filename_pattern and metadata_column else None
    except re.error as exception:
        raise ValueError(f"Invalid filename metadata regex: {exception}") from exception

    for input_index, item in enumerate(input_files):
        source_file = str(item.get("name", f"file_{input_index + 1}.csv"))
        text = item.get("text")
        if not isinstance(text, str):
            message = f"{source_file}: missing text content"
            (warnings if on_error == "skip" else failures).append(message)
            continue
        try:
            table = _read_csv(text, params)
        except Exception as exception:
            message = f"{source_file}: {exception}"
            if on_error == "skip":
                warnings.append(message)
                continue
            failures.append(message)
            continue

        metadata_value: Any = None
        if pattern is not None and metadata_column:
            match = pattern.search(source_file)
            if not match:
                message = f"{source_file}: filename does not match pattern {filename_pattern!r}"
                if metadata_error == "warn":
                    warnings.append(message)
                else:
                    failures.append(message)
                    continue
            else:
                captured = match.group(1) if match.groups() else match.group(0)
                if metadata_type == "number":
                    try:
                        metadata_value = float(captured)
                    except (TypeError, ValueError):
                        message = f"{source_file}: metadata {captured!r} is not a finite number"
                        if metadata_error == "warn":
                            warnings.append(message)
                        else:
                            failures.append(message)
                            continue
                    if metadata_value is not None and not np.isfinite(metadata_value):
                        message = f"{source_file}: metadata {captured!r} is not a finite number"
                        if metadata_error == "warn":
                            warnings.append(message)
                            metadata_value = None
                        else:
                            failures.append(message)
                            continue
                else:
                    metadata_value = captured
        entries.append({"input_index": input_index, "source_file": source_file, "metadata": metadata_value, "table": table})

    if failures:
        raise ValueError("Batch CSV collection errors: " + "; ".join(failures))
    if not entries:
        raise ValueError("No CSV file could be read into the collection")

    if pattern is not None and metadata_column:
        grouped: dict[tuple[str, str], list[str]] = {}
        for entry in entries:
            value = entry["metadata"]
            if value is None:
                continue
            key = (type(value).__name__, str(value))
            grouped.setdefault(key, []).append(entry["source_file"])
        duplicate_errors: list[str] = []
        for (_, value), files in grouped.items():
            if len(files) < 2:
                continue
            message = f"Duplicate {metadata_column}={value}: {', '.join(files)}"
            if duplicate_metadata == "warn":
                warnings.append(message)
            else:
                duplicate_errors.append(message)
        if duplicate_errors:
            raise ValueError("Batch CSV collection metadata errors: " + "; ".join(duplicate_errors))

    if order_by == "input":
        entries.sort(key=lambda entry: entry["input_index"])
    elif order_by == "source_file":
        entries.sort(key=lambda entry: (entry["source_file"].casefold(), entry["input_index"]))
    elif order_by in {"metadata_asc", "metadata_desc"}:
        if pattern is None or not metadata_column:
            raise ValueError(f"orderBy={order_by} requires filename metadata extraction")
        present = [entry for entry in entries if entry["metadata"] is not None]
        missing = [entry for entry in entries if entry["metadata"] is None]
        present.sort(key=lambda entry: entry["source_file"].casefold())
        present.sort(key=lambda entry: entry["metadata"], reverse=order_by == "metadata_desc")
        missing.sort(key=lambda entry: entry["source_file"].casefold())
        entries = present + missing
    else:
        raise ValueError(f"Unsupported CSV collection orderBy: {order_by}")

    metadata_rows = [{source_column: entry["source_file"], **({metadata_column: entry["metadata"]} if pattern is not None and metadata_column else {})} for entry in entries]
    return [entry["table"] for entry in entries], pd.DataFrame(metadata_rows), warnings
