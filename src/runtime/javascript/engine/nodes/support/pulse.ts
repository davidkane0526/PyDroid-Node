import { Table, toNumber } from "../../table";
import { requireTable, resolveColumn } from "./common";
export function round12(value: number): number {
  return Number(value.toFixed(12));
}

export function pulseWaveform(params: Record<string, unknown>): Table {
  const voltageMax = Number(params.voltageMax ?? 3);
  const voltageStep = Math.abs(Number(params.voltageStep ?? 0.2));
  const readVoltage = Number(params.readVoltage ?? 0.1);
  const pulseTime = Number(params.pulseTime ?? 0.01);
  const readTime = Number(params.readTime ?? 0.01);
  const timeShift = Number(params.timeShift ?? 0);
  const cycles = Number(params.cycles ?? 1);
  const ratio = Number(params.ratio ?? 1);
  if (!Number.isFinite(voltageMax) || voltageMax === 0 || !Number.isFinite(voltageStep) || voltageStep <= 0) {
    throw new Error("Pulse waveform requires a non-zero voltage maximum and a positive voltage step");
  }
  if (![pulseTime, readTime].every((value) => Number.isFinite(value) && value >= 0) || pulseTime + readTime <= 0) {
    throw new Error("Pulse and read times must be finite and their sum must be positive");
  }
  if (cycles !== 0.25 && cycles !== 0.5 && (!Number.isInteger(cycles) || cycles < 1 || cycles > 100)) {
    throw new Error("Pulse cycles must be 0.25, 0.5, or an integer from 1 to 100");
  }
  const direction = voltageMax > 0 ? 1 : -1;
  const magnitudes: number[] = [];
  for (let value = Math.min(voltageStep, Math.abs(voltageMax)); value <= Math.abs(voltageMax) + voltageStep * 0.01; value += voltageStep) {
    magnitudes.push(round12(value));
  }
  if (!magnitudes.length || Math.abs(magnitudes[magnitudes.length - 1] - Math.abs(voltageMax)) > voltageStep * 0.01) {
    magnitudes.push(Math.abs(voltageMax));
  }
  const levels = magnitudes.map((value) => direction * Math.min(value, Math.abs(voltageMax)));
  const quarter = levels;
  const half = [...quarter, ...quarter.map((value) => -value)];
  const sequence = cycles === 0.25 ? quarter : cycles === 0.5 ? half : [...half, ...[...half].reverse()];
  const repeat = cycles >= 1 ? Math.trunc(cycles) : 1;
  const final = Array.from({ length: repeat }, () => sequence).flat();
  if (final.length * 2 > 100_000) throw new Error("Pulse waveform exceeds the 100000-row safety limit");
  const rows: Array<Record<string, unknown>> = [];
  let moment = timeShift;
  final.forEach((level, index) => {
    moment += readTime;
    rows.push({ sequence: index, time_s: moment, voltage_V: readVoltage * ratio, phase: "read" });
    moment += pulseTime;
    rows.push({ sequence: index, time_s: moment, voltage_V: level * ratio, phase: "pulse" });
  });
  return new Table(["sequence", "time_s", "voltage_V", "phase"], rows.map((row) => [row.sequence, row.time_s, row.voltage_V, row.phase]));
}

export function oscillatingPulseRamp(params: Record<string, unknown>): Table {
  const interval = Number(params.interval ?? 0.005);
  const total = Number(params.totalTime ?? 10);
  const step = Math.abs(Number(params.amplitudeStep ?? 0.2));
  const fixed = Number(params.fixedVoltage ?? 0.6);
  const gate = Number(params.gateVoltage ?? 0);
  if (![interval, total, step, fixed, gate].every(Number.isFinite) || interval <= 0 || total <= 0 || step <= 0) {
    throw new Error("Oscillating pulse interval, total time and amplitude step must be positive finite values");
  }
  const count = Math.max(0, Math.ceil(total / interval) - 1);
  if (count > 100_000) throw new Error("Oscillating pulse waveform exceeds the 100000-row safety limit");
  const rows: Array<Array<number>> = [];
  let magnitude = step;
  let sign = 1;
  for (let index = 0; index < count; index += 1) {
    const moment = (index + 1) * interval;
    if (index % 2 === 0) {
      rows.push([moment, 0, fixed, gate]);
    } else {
      rows.push([moment, sign * magnitude, 0, gate]);
      // Match the Python runtime exactly: +step, -step, +2*step, -2*step, …
      // and only advance magnitude after the negative half-cycle completes.
      if (sign > 0) sign = -1;
      else {
        sign = 1;
        magnitude += step;
      }
    }
  }
  return new Table(["time_s", "port1_V", "port2_V", "port3_V"], rows);
}

export function pulseCombineChannels(upstream: Record<string, unknown>, params: Record<string, unknown>): Table {
  const timeName = String(params.timeColumn ?? "time_s");
  const voltageName = String(params.voltageColumn ?? "voltage_V");
  const generic = Object.entries(upstream)
    .map(([port, value]) => ({ match: /^channel(\d+)$/.exec(port), value }))
    .filter((item): item is { match: RegExpExecArray; value: unknown } => Boolean(item.match))
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
  let channels: Array<{ port: string; output: string; value: unknown }>;
  if (generic.length) {
    const rawNames = params.channelNames;
    const names = Array.isArray(rawNames)
      ? rawNames.map(String).map((item) => item.trim()).filter(Boolean)
      : String(rawNames ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    while (names.length < generic.length) names.push(`Channel${names.length + 1}`);
    channels = generic.map((item, index) => ({
      port: `channel${item.match[1]}`,
      output: names[index].endsWith("_V") ? names[index] : `${names[index]}_V`,
      value: item.value,
    }));
  } else {
    channels = [
      { port: "drain", output: "Vd_V", value: upstream.drain },
      { port: "source", output: "Vs_V", value: upstream.source },
      { port: "gate", output: "Vg_V", value: upstream.gate },
    ];
  }
  const outputNames = channels.filter((item) => item.value !== null && item.value !== undefined).map((item) => item.output);
  if (new Set(outputNames).size !== outputNames.length) throw new Error("Pulse channel names must be unique");
  const prepared: Array<{ time: number[]; values: number[]; output: string }> = [];
  for (const channel of channels) {
    if (channel.value === null || channel.value === undefined) continue;
    const frame = requireTable(channel.value, `Pulse ${channel.port} waveform`);
    const timeColumn = resolveColumn(frame, timeName);
    const voltageColumn = resolveColumn(frame, voltageName);
    const rows = frame.rows().map((row) => ({
      time: toNumber(row[frame.columnIndex(timeColumn)]),
      value: toNumber(row[frame.columnIndex(voltageColumn)]),
    })).filter((item) => item.time !== null).sort((a, b) => (a.time as number) - (b.time as number));
    prepared.push({ time: rows.map((item) => item.time as number), values: rows.map((item) => item.value ?? 0), output: channel.output });
  }
  if (!prepared.length) throw new Error("Combine channels requires at least one waveform");
  const allTimes = [...new Set(prepared.flatMap((item) => item.time))].sort((a, b) => a - b);
  const rows = allTimes.map((time) => {
    const row: Array<number> = [time];
    for (const item of prepared) {
      let value = item.values[0] ?? 0;
      for (let i = 0; i < item.time.length; i += 1) {
        if (item.time[i] <= time) value = item.values[i];
        else break;
      }
      row.push(value);
    }
    return row;
  });
  return new Table(["time_s", ...prepared.map((item) => item.output)], rows);
}

export function pulseSegmentMeasurement(upstream: Record<string, unknown>, params: Record<string, unknown>): Table {
  const measurement = requireTable(upstream.measurement, "Pulse measurement");
  const waveform = requireTable(upstream.waveform, "Pulse waveform");
  const measuredTime = resolveColumn(measurement, params.measurementTimeColumn ?? "time");
  const current = resolveColumn(measurement, params.currentColumn ?? "current");
  const waveformTime = resolveColumn(waveform, params.waveformTimeColumn ?? "time_s");
  const waveformVoltage = resolveColumn(waveform, params.waveformVoltageColumn ?? "voltage_V");
  const leading = Number(params.dropLeadingRows ?? 0);
  const trailing = Number(params.dropTrailingRows ?? 0);
  if (leading < 0 || trailing < 0) throw new Error("Pulse segment row trimming must not be negative");
  const samples = measurement.rows().map((row) => ({
    time: toNumber(row[measurement.columnIndex(measuredTime)]),
    current: toNumber(row[measurement.columnIndex(current)]),
  })).filter((item) => item.time !== null && item.current !== null).sort((a, b) => (a.time as number) - (b.time as number));
  const events = waveform.rows().map((row, r) => ({
    sequence: row[waveform.columns.includes("sequence") ? waveform.columnIndex("sequence") : -1] ?? r,
    phase: waveform.columns.includes("phase") ? String(row[waveform.columnIndex("phase")] ?? "pulse") : "pulse",
    time: toNumber(row[waveform.columnIndex(waveformTime)]),
    voltage: toNumber(row[waveform.columnIndex(waveformVoltage)]),
  })).filter((item) => item.time !== null).sort((a, b) => (a.time as number) - (b.time as number));
  if (!events.length) throw new Error("Pulse waveform contains no valid time values");
  const times = samples.map((item) => item.time as number);
  const currents = samples.map((item) => item.current as number);
  const searchLeft = (value: number): number => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const rows: Array<Array<unknown>> = [];
  events.forEach((event, index) => {
    const start = searchLeft(event.time as number);
    const endTime = index + 1 < events.length ? events[index + 1].time as number : Number.POSITIVE_INFINITY;
    const end = searchLeft(endTime);
    let segment = currents.slice(start, end).slice(leading, trailing === 0 ? undefined : -trailing);
    rows.push([
      event.sequence,
      event.phase,
      event.time,
      event.voltage,
      segment.length,
      segment.length ? segment.reduce((a, b) => a + b, 0) / segment.length : Number.NaN,
    ]);
  });
  return new Table(["sequence", "phase", "waveform_time_s", "voltage_V", "sample_count", "mean_current_A"], rows);
}
