import { Table } from "../table";
import { requireTable } from "./support/common";
import { terMatrix } from "./support/analysis";
import { pulseCombineChannels, pulseSegmentMeasurement, pulseWaveform, oscillatingPulseRamp } from "./support/pulse";
import type { ExecutionContext, NodeOutput } from "./support/types";

export function executeAnalysisPulseNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput | null {
  const tableResult: Table | null = null;
  const plotResult = null;
  const exportResult: string | null = null;
  const table = (): Table => requireTable(upstream, "Table input");

  switch (nodeType) {
    case "analysis.ter_matrix": {
      const value = terMatrix(table(), params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.generate_waveform": {
      const value = pulseWaveform(params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.generate_oscillating_ramp": {
      const value = oscillatingPulseRamp(params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.combine_channels": {
      const value = pulseCombineChannels(upstream as Record<string, unknown>, params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    case "pulse.segment_measurement": {
      const value = pulseSegmentMeasurement(upstream as Record<string, unknown>, params);
      return { outputs: { output: value }, tableResult: value, plotResult, exportResult };
    }
    default:
      return null;
  }
}
