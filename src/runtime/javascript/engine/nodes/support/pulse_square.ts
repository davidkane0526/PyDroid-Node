import { Table } from "../../table";

export function pulseSquareWaveform(params: Record<string, unknown>): Table {
  const highVoltage = Number(params.highVoltage ?? 5);
  const lowVoltage = Number(params.lowVoltage ?? 0);
  const highTime = Number(params.highTime ?? 1);
  const lowTime = Number(params.lowTime ?? 1);
  const repeatRaw = Number(params.repeatCount ?? 1);
  const startLevel = String(params.startLevel ?? "high").trim().toLowerCase();
  const timeStart = Number(params.timeStart ?? 0);
  const totalTime = Number(params.totalTime ?? 0);

  if (![highVoltage, lowVoltage, highTime, lowTime, repeatRaw, timeStart, totalTime].every(Number.isFinite)) {
    throw new Error("Square waveform parameters must be finite numbers");
  }
  if (highTime <= 0 || lowTime <= 0) throw new Error("Square waveform highTime and lowTime must be positive");
  if (!Number.isInteger(repeatRaw) || repeatRaw < 1) throw new Error("Square waveform repeatCount must be a positive integer");
  if (startLevel !== "high" && startLevel !== "low") throw new Error("Square waveform startLevel must be 'high' or 'low'");
  if (totalTime < 0) throw new Error("Square waveform totalTime must be zero or positive");

  const voltageFor = (level: string): number => level === "high" ? highVoltage : lowVoltage;
  const durationFor = (level: string): number => level === "high" ? highTime : lowTime;
  const toggle = (level: string): "high" | "low" => level === "high" ? "low" : "high";
  const closeEnough = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-12;

  const rows: Array<[number, number, number, string]> = [];
  let level: "high" | "low" = startLevel as "high" | "low";
  let moment = timeStart;
  rows.push([0, moment, voltageFor(level), level]);

  // totalTime > 0 continues the same periodic pattern for the requested duration.
  // It takes precedence over repeatCount so this waveform can directly cover a
  // longer Vd/Vs channel without auxiliary slice/absolute/select nodes.
  if (totalTime > 0) {
    const endTime = timeStart + totalTime;
    let sequence = 0;
    while (moment < endTime && !closeEnough(moment, endTime)) {
      const nextMoment = moment + durationFor(level);
      if (nextMoment >= endTime || closeEnough(nextMoment, endTime)) {
        sequence += 1;
        if (nextMoment <= endTime || closeEnough(nextMoment, endTime)) level = toggle(level);
        rows.push([sequence, endTime, voltageFor(level), level]);
        break;
      }
      moment = nextMoment;
      level = toggle(level);
      sequence += 1;
      rows.push([sequence, moment, voltageFor(level), level]);
      if (rows.length > 100_000) throw new Error("Square waveform exceeds the 100000-row safety limit");
    }
  } else {
    const transitionCount = repeatRaw * 2;
    if (transitionCount + 1 > 100_000) throw new Error("Square waveform exceeds the 100000-row safety limit");
    for (let sequence = 1; sequence <= transitionCount; sequence += 1) {
      moment += durationFor(level);
      level = toggle(level);
      rows.push([sequence, moment, voltageFor(level), level]);
    }
  }

  return new Table(["sequence", "time_s", "voltage_V", "state"], rows);
}
