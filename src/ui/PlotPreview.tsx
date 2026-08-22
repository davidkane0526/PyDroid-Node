import type { CSSProperties } from "react";
import type { PlotExecutionPreview } from "../runtime/types";
import { PlotView } from "./PlotView";

export function PlotPreview({ preview, className, alt = "图表结果", style }: { preview: PlotExecutionPreview; className?: string; alt?: string; style?: CSSProperties }) {
  if (preview.chart) return <PlotView chart={preview.chart} className={className} style={style} />;
  if (preview.plotPngBase64) return <img className={className} style={style} src={`data:image/png;base64,${preview.plotPngBase64}`} alt={alt} />;
  return <div className={className} style={style} role="status">图表结果为空</div>;
}
