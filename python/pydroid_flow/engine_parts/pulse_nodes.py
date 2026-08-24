from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import pandas as pd

from .values import _require_table, _resolve_column

def _pulse_waveform(params: dict[str, Any]) -> pd.DataFrame:
    voltage_max = float(params.get("voltageMax", 3))
    voltage_step = abs(float(params.get("voltageStep", 0.2)))
    read_voltage = float(params.get("readVoltage", 0.1))
    pulse_time = float(params.get("pulseTime", 0.01))
    read_time = float(params.get("readTime", 0.01))
    time_shift = float(params.get("timeShift", 0))
    cycles = float(params.get("cycles", 1))
    ratio = float(params.get("ratio", 1))
    if not math.isfinite(voltage_max) or voltage_max == 0 or not math.isfinite(voltage_step) or voltage_step <= 0:
        raise ValueError("Pulse waveform requires a non-zero voltage maximum and a positive voltage step")
    if any(not math.isfinite(value) or value < 0 for value in (pulse_time, read_time)) or pulse_time + read_time <= 0:
        raise ValueError("Pulse and read times must be finite and their sum must be positive")
    if cycles not in {0.25, 0.5} and (not cycles.is_integer() or cycles < 1 or cycles > 100):
        raise ValueError("Pulse cycles must be 0.25, 0.5, or an integer from 1 to 100")
    direction = 1.0 if voltage_max > 0 else -1.0
    magnitudes = list(np.arange(min(voltage_step, abs(voltage_max)), abs(voltage_max) + voltage_step * 0.01, voltage_step))
    if not magnitudes or not math.isclose(magnitudes[-1], abs(voltage_max), rel_tol=0, abs_tol=voltage_step * 0.01): magnitudes.append(abs(voltage_max))
    levels = [direction * min(value, abs(voltage_max)) for value in magnitudes]
    quarter = levels
    half = quarter + [-value for value in quarter]
    sequence = quarter if cycles == 0.25 else half if cycles == 0.5 else half + list(reversed(half))
    sequence *= int(cycles) if cycles >= 1 else 1
    if len(sequence) * 2 > 100_000: raise ValueError("Pulse waveform exceeds the 100000-row safety limit")
    rows: list[dict[str, Any]] = []
    moment = time_shift
    for index, level in enumerate(sequence):
        moment += read_time
        rows.append({"sequence": index, "time_s": moment, "voltage_V": read_voltage * ratio, "phase": "read"})
        moment += pulse_time
        rows.append({"sequence": index, "time_s": moment, "voltage_V": level * ratio, "phase": "pulse"})
    return pd.DataFrame(rows, columns=["sequence", "time_s", "voltage_V", "phase"])


def _pulse_square_waveform(params: dict[str, Any]) -> pd.DataFrame:
    high_voltage = float(params.get("highVoltage", 5))
    low_voltage = float(params.get("lowVoltage", 0))
    high_time = float(params.get("highTime", 1))
    low_time = float(params.get("lowTime", 1))
    repeat_raw = float(params.get("repeatCount", 1))
    start_level = str(params.get("startLevel", "high")).strip().lower()
    time_start = float(params.get("timeStart", 0))
    total_time = float(params.get("totalTime", 0))

    if not all(math.isfinite(value) for value in (high_voltage, low_voltage, high_time, low_time, repeat_raw, time_start, total_time)):
        raise ValueError("Square waveform parameters must be finite numbers")
    if high_time <= 0 or low_time <= 0:
        raise ValueError("Square waveform highTime and lowTime must be positive")
    if not repeat_raw.is_integer() or repeat_raw < 1:
        raise ValueError("Square waveform repeatCount must be a positive integer")
    repeat_count = int(repeat_raw)
    if start_level not in {"high", "low"}:
        raise ValueError("Square waveform startLevel must be 'high' or 'low'")
    if total_time < 0:
        raise ValueError("Square waveform totalTime must be zero or positive")

    def voltage_for(level: str) -> float:
        return high_voltage if level == "high" else low_voltage

    def duration_for(level: str) -> float:
        return high_time if level == "high" else low_time

    def toggle(level: str) -> str:
        return "low" if level == "high" else "high"

    rows: list[dict[str, Any]] = []
    level = start_level
    moment = time_start
    rows.append({"sequence": 0, "time_s": moment, "voltage_V": voltage_for(level), "state": level})

    # totalTime > 0 means “continue this periodic waveform for this duration”.
    # This is intentionally independent of repeatCount so a short gate waveform can
    # be extended to the same time range as longer drain/source channels.
    if total_time > 0:
        end_time = time_start + total_time
        sequence = 0
        while moment < end_time and not math.isclose(moment, end_time, rel_tol=0, abs_tol=1e-12):
            next_moment = moment + duration_for(level)
            if next_moment >= end_time or math.isclose(next_moment, end_time, rel_tol=0, abs_tol=1e-12):
                if not math.isclose(moment, end_time, rel_tol=0, abs_tol=1e-12):
                    sequence += 1
                    if next_moment <= end_time or math.isclose(next_moment, end_time, rel_tol=0, abs_tol=1e-12):
                        level = toggle(level)
                        rows.append({"sequence": sequence, "time_s": end_time, "voltage_V": voltage_for(level), "state": level})
                    else:
                        rows.append({"sequence": sequence, "time_s": end_time, "voltage_V": voltage_for(level), "state": level})
                break
            moment = next_moment
            level = toggle(level)
            sequence += 1
            rows.append({"sequence": sequence, "time_s": moment, "voltage_V": voltage_for(level), "state": level})
            if len(rows) > 100_000:
                raise ValueError("Square waveform exceeds the 100000-row safety limit")
    else:
        transition_count = repeat_count * 2
        if transition_count + 1 > 100_000:
            raise ValueError("Square waveform exceeds the 100000-row safety limit")
        for sequence in range(1, transition_count + 1):
            moment += duration_for(level)
            level = toggle(level)
            rows.append({"sequence": sequence, "time_s": moment, "voltage_V": voltage_for(level), "state": level})

    return pd.DataFrame(rows, columns=["sequence", "time_s", "voltage_V", "state"])

def _oscillating_pulse_ramp(params: dict[str, Any]) -> pd.DataFrame:
    interval = float(params.get("interval", 0.005)); total = float(params.get("totalTime", 10))
    step = abs(float(params.get("amplitudeStep", 0.2))); fixed = float(params.get("fixedVoltage", 0.6)); gate = float(params.get("gateVoltage", 0))
    if not all(math.isfinite(value) for value in (interval, total, step, fixed, gate)) or interval <= 0 or total <= 0 or step <= 0:
        raise ValueError("Oscillating pulse interval, total time and amplitude step must be positive finite values")
    count = max(0, int(math.ceil(total / interval)) - 1)
    if count > 100_000: raise ValueError("Oscillating pulse waveform exceeds the 100000-row safety limit")
    rows = []
    magnitude = step
    sign = 1.0
    for index in range(count):
        moment = (index + 1) * interval
        if index % 2 == 0:
            rows.append({"time_s": moment, "port1_V": 0.0, "port2_V": fixed, "port3_V": gate})
        else:
            rows.append({"time_s": moment, "port1_V": sign * magnitude, "port2_V": 0.0, "port3_V": gate})
            # Advance the magnitude only after a full ±half-cycle so the ramp stays
            # symmetric: +step, -step, +2*step, -2*step, … (previously the negative
            # half was always one step larger than the positive one).
            if sign > 0:
                sign = -1.0
            else:
                sign = 1.0
                magnitude += step
    return pd.DataFrame(rows, columns=["time_s", "port1_V", "port2_V", "port3_V"])

def _pulse_combine_channels(inputs: dict[str, Any], params: dict[str, Any]) -> pd.DataFrame:
    time_name, voltage_name = str(params.get("timeColumn", "time_s")), str(params.get("voltageColumn", "voltage_V"))
    generic = sorted(
        ((int(match.group(1)), value) for key, value in inputs.items() if (match := re.fullmatch(r"channel(\d+)", str(key)))),
        key=lambda item: item[0],
    )
    if generic:
        raw_names = params.get("channelNames", "")
        if isinstance(raw_names, list):
            names = [str(item).strip() for item in raw_names if str(item).strip()]
        else:
            names = [item.strip() for item in str(raw_names or "").split(",") if item.strip()]
        if len(names) < len(generic):
            names.extend(f"Channel{index}" for index in range(len(names) + 1, len(generic) + 1))
        columns = [(f"channel{index}", name if name.endswith("_V") else f"{name}_V", value) for (index, value), name in zip(generic, names)]
    else:
        columns = [("drain", "Vd_V", inputs.get("drain")), ("source", "Vs_V", inputs.get("source")), ("gate", "Vg_V", inputs.get("gate"))]
    output_names = [output for _, output, value in columns if value is not None]
    if len(set(output_names)) != len(output_names):
        raise ValueError("Pulse channel names must be unique")
    prepared: list[pd.DataFrame] = []
    for port, output_column, raw_table in columns:
        if raw_table is None:
            continue
        table = _require_table(raw_table, f"Pulse {port} waveform")
        time_column, voltage_column = _resolve_column(table, time_name), _resolve_column(table, voltage_name)
        prepared.append(pd.DataFrame({"time_s": pd.to_numeric(table[time_column], errors="coerce"), output_column: pd.to_numeric(table[voltage_column], errors="coerce")}).dropna(subset=["time_s"]).sort_values("time_s"))
    if not prepared:
        raise ValueError("Combine channels requires at least one waveform")
    merged = pd.DataFrame({"time_s": sorted(set().union(*(set(frame["time_s"]) for frame in prepared)))})
    for frame in prepared:
        merged = pd.merge_asof(merged, frame, on="time_s", direction="backward")
    return merged.ffill().bfill().fillna(0).reset_index(drop=True)

def _pulse_segment_measurement(inputs: dict[str, Any], params: dict[str, Any]) -> pd.DataFrame:
    measurement = _require_table(inputs.get("measurement"), "Pulse measurement")
    waveform = _require_table(inputs.get("waveform"), "Pulse waveform")
    measured_time = _resolve_column(measurement, params.get("measurementTimeColumn", "time"))
    current = _resolve_column(measurement, params.get("currentColumn", "current"))
    waveform_time = _resolve_column(waveform, params.get("waveformTimeColumn", "time_s"))
    waveform_voltage = _resolve_column(waveform, params.get("waveformVoltageColumn", "voltage_V"))
    leading, trailing = int(params.get("dropLeadingRows", 0)), int(params.get("dropTrailingRows", 0))
    if leading < 0 or trailing < 0: raise ValueError("Pulse segment row trimming must not be negative")
    samples = pd.DataFrame({"time": pd.to_numeric(measurement[measured_time], errors="coerce"), "current": pd.to_numeric(measurement[current], errors="coerce")}).dropna().sort_values("time")
    events = waveform.copy()
    events["_time"] = pd.to_numeric(events[waveform_time], errors="coerce")
    events["_voltage"] = pd.to_numeric(events[waveform_voltage], errors="coerce")
    events = events.dropna(subset=["_time"]).sort_values("_time").reset_index(drop=True)
    if events.empty: raise ValueError("Pulse waveform contains no valid time values")
    rows: list[dict[str, Any]] = []
    times = samples["time"].to_numpy()
    for index, event in events.iterrows():
        start = int(np.searchsorted(times, event["_time"], side="left"))
        end_time = float(events.iloc[index + 1]["_time"]) if index + 1 < len(events) else math.inf
        end = int(np.searchsorted(times, end_time, side="left"))
        raw_segment = samples.iloc[start:end]["current"]
        trimmed = raw_segment.iloc[leading: None if trailing == 0 else -trailing]
        if (leading or trailing) and len(trimmed) == 0 and len(raw_segment) > 0:
            raise ValueError(f"Pulse segment {index} has only {len(raw_segment)} samples, fewer than the {leading + trailing} rows to drop; reduce dropLeadingRows/dropTrailingRows")
        segment = trimmed.dropna()
        rows.append({"sequence": int(event.get("sequence", index)), "phase": str(event.get("phase", "pulse")), "waveform_time_s": float(event["_time"]), "voltage_V": float(event["_voltage"]), "sample_count": int(len(segment)), "mean_current_A": float(segment.mean()) if len(segment) else math.nan})
    return pd.DataFrame(rows)
