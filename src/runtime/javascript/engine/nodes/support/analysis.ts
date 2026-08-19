import { Table, toNumber } from "../../table";
import { optionalFloat, resolveColumn } from "./common";
import { round12 } from "./pulse";
export function terMatrix(frame: Table, params: Record<string, unknown>): Table {
  const vgColumn = resolveColumn(frame, params.vgColumn ?? "Vg_V");
  const voltageColumn = resolveColumn(frame, params.voltageColumn ?? 0);
  const currentColumn = resolveColumn(frame, params.currentColumn ?? 1);
  const currentFloor = Number(params.currentFloor ?? 1e-15);
  const mode = String(params.mode ?? "high-low");
  if (!["high-low", "down-minus-up", "up-minus-down"].includes(mode)) throw new Error(`Unsupported TER mode: ${mode}`);
  const sourceColumn = String(params.sourceColumn ?? "source_file").trim();

  // 按 Vg 分组（排序）
  const vgIndexes = new Map<string, number[]>();
  frame.rows().forEach((row, r) => {
    const key = String(row[frame.columnIndex(vgColumn)]);
    const list = vgIndexes.get(key) ?? [];
    list.push(r);
    vgIndexes.set(key, list);
  });
  const vgKeys = [...vgIndexes.keys()].sort((a, b) => Number(a) - Number(b));
  const groups: Array<{ vg: string; voltages: number[]; currents: number[]; source: string }> = [];
  let detectedMin = Number.POSITIVE_INFINITY;
  let detectedMax = Number.NEGATIVE_INFINITY;
  let detectedStep = Number.POSITIVE_INFINITY;
  for (const vg of vgKeys) {
    const indexes = vgIndexes.get(vg) ?? [];
    const cleaned: Array<{ voltage: number; current: number }> = [];
    for (const r of indexes) {
      const row = frame.row(r);
      const voltage = toNumber(row[frame.columnIndex(voltageColumn)]);
      const current = toNumber(row[frame.columnIndex(currentColumn)]);
      if (voltage !== null && current !== null && Number.isFinite(voltage) && Number.isFinite(current)) {
        cleaned.push({ voltage, current });
      }
    }
    if (cleaned.length < 3) throw new Error(`Vg=${vg} has fewer than 3 valid samples`);
    const voltages = cleaned.map((item) => item.voltage);
    const currents = cleaned.map((item) => item.current);
    for (let i = 1; i < voltages.length; i += 1) {
      const difference = Math.abs(voltages[i] - voltages[i - 1]);
      if (difference > 1e-12) detectedStep = Math.min(detectedStep, difference);
    }
    detectedMin = Math.min(detectedMin, ...voltages);
    detectedMax = Math.max(detectedMax, ...voltages);
    const firstRow = frame.row(indexes[0]);
    const source = sourceColumn && frame.columns.includes(sourceColumn) ? String(firstRow[frame.columnIndex(sourceColumn)] ?? "") : "";
    groups.push({ vg, voltages, currents, source });
  }

  const step = optionalFloat(params.vstep) || detectedStep;
  const vmin = optionalFloat(params.vmin);
  const vmax = optionalFloat(params.vmax);
  const low = vmin === null || vmin === 0 ? detectedMin : vmin;
  const high = vmax === null || vmax === 0 ? detectedMax : vmax;
  if (!Number.isFinite(step) || step <= 0 || !(low < 0 && high > 0)) {
    throw new Error("Unable to detect a valid Vds range and step");
  }
  const tolerance = optionalFloat(params.tolerance) || step / 20;

  const targets: number[] = [];
  for (let target = low; target < -step / 2; target += step) targets.push(round12(target));
  for (let target = step; target <= high + step / 2; target += step) targets.push(round12(target));

  const records: Array<Record<string, unknown>> = [];
  for (const group of groups) {
    const directions = new Array<number>(group.voltages.length).fill(0);
    for (let index = 0; index < group.voltages.length; index += 1) {
      if (index > 0 && Math.abs(group.voltages[index] - group.voltages[index - 1]) > tolerance) {
        directions[index] = group.voltages[index] > group.voltages[index - 1] ? 1 : -1;
      } else if (index + 1 < group.voltages.length && Math.abs(group.voltages[index + 1] - group.voltages[index]) > tolerance) {
        directions[index] = group.voltages[index + 1] > group.voltages[index] ? 1 : -1;
      }
    }
    for (const target of targets) {
      const matched: number[] = [];
      group.voltages.forEach((measured, index) => {
        if (Math.abs(measured - target) <= tolerance) matched.push(index);
      });
      const up = matched.filter((index) => directions[index] === 1);
      const down = matched.filter((index) => directions[index] === -1);
      const iUp = up.length ? group.currents[up[0]] : Number.NaN;
      const iDown = down.length ? group.currents[down[0]] : Number.NaN;
      const rUp = Number.isFinite(iUp) && Math.abs(iUp) > currentFloor ? Math.abs(target / iUp) : Number.NaN;
      const rDown = Number.isFinite(iDown) && Math.abs(iDown) > currentFloor ? Math.abs(target / iDown) : Number.NaN;
      let ter = Number.NaN;
      if (Number.isFinite(rUp) && Number.isFinite(rDown)) {
        if (mode === "down-minus-up" && rUp !== 0) ter = ((rDown - rUp) / rUp) * 100;
        else if (mode === "up-minus-down" && rDown !== 0) ter = ((rUp - rDown) / rDown) * 100;
        else if (mode === "high-low") {
          const rLow = Math.min(rUp, rDown);
          const rHigh = Math.max(rUp, rDown);
          if (rLow !== 0) ter = ((rHigh - rLow) / rLow) * 100;
        }
      }
      records.push({
        Vg_V: Number(group.vg),
        Vds_V: target,
        I_up_A: iUp,
        I_down_A: iDown,
        R_up_ohm: rUp,
        R_down_ohm: rDown,
        TER_percent: ter,
        ...(group.source ? { source_file: group.source } : {}),
      });
    }
  }
  const table = Table.fromRecords(records);
  return table.sortValues(["Vg_V", "Vds_V"], true, "last");
}
