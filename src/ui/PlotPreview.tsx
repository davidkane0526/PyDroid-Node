import type { PlotExecutionPreview } from "../runtime/types";
import { PlotView } from "./PlotView";

export function PlotPreview({ preview, className, alt = "图表结果" }: { preview: PlotExecutionPreview; className?: string; alt?: string }) {
  if (preview.chart) return <PlotView chart={preview.chart} className={className} />;
  if (preview.plotPngBase64) return <img className={className} src={`data:image/png;base64,${preview.plotPngBase64}`} alt={alt} />;
  return <div className={className} role="status">图表结果为空</div>;
}
