import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const dialogs = read("src/dialogs.tsx");
const plotView = read("src/ui/PlotView.tsx");
const plotPreview = read("src/ui/PlotPreview.tsx");
const plotThumbnail = read("src/ui/PlotThumbnail.tsx");
const plots = read("src/runtime/javascript/engine/plots.ts");
const fixes = read("src/ui-fixes.css");
const labHtml = read("theme-lab/index.html");
const labCss = read("theme-lab/theme.css");
const labJs = read("theme-lab/theme.js");

const checks = [
  ["exports use a dedicated result region", app.includes('className="result-exports"') && app.includes('className="result-export-card"')],
  ["export links are no longer injected into result heading", !/result-actions[\s\S]{0,1000}download-link/.test(app)],
  ["raster plot uses a range slider", dialogs.includes('type="range"') && dialogs.includes('plot-lightbox__raster-stage')],
  ["100% raster zoom is defined as fitted panel size", dialogs.includes('100% 为适应面板') && fixes.includes('.plot-lightbox__raster-image')],
  ["compact ECharts heatmaps preserve hidden visualMap mapping", plotView.includes('show: false, calculable: false') && plotView.includes('chart.type === "heatmap"')],
  ["heatmap formatter behavior is rebuilt in presentation layer", plotView.includes('__pydroidHeatmapMeta') && plotView.includes('heatmapFormatter')],
  ["interactive charts use bounded data-aware device pixel ratio", plotView.includes("preferredDevicePixelRatio") && plotView.includes("points >= 12_000")],
  ["runtime heatmap payload stores serializable metadata", plots.includes('__pydroidHeatmapMeta') && !plots.includes('formatter: (item: { value: [number, number, number | null] })')],
  ["node insights use lightweight plot thumbnails", app.includes('mode="thumbnail"') && plotPreview.includes('mode === "thumbnail"')],
  ["plot thumbnails do not instantiate ECharts", plotThumbnail.includes('getContext("2d"') && !plotThumbnail.includes('echarts.init') && !plotThumbnail.includes('from "echarts')],
  ["heatmap thumbnails downsample before raster drawing", plotThumbnail.includes('Math.min(xCount, 96)') && plotThumbnail.includes('Math.min(yCount, 48)') && plotThumbnail.includes('data.length / 24_000')],
  ["ordinary plot resize avoids option rebuild", plotView.includes('responsiveLayoutSignature') && plotView.includes('render(false)') && plotView.includes('signature !== layoutSignatureRef.current')],
  ["initial interactive render is not duplicated by mount effect", plotView.includes("chart-dependent effect below performs the single initial setOption call")],
  ["large heatmaps use progressive rendering", plotView.includes('progressiveThreshold: 8_000')],
  ["heatmap colorbar respects showColorBar", plots.includes('const showColorBar = asBool(params.showColorBar ?? true)')],
  ["theme lab is dependency-free and covers core theme objects", labHtml.includes('logic.if_value') && labHtml.includes('logic.for_each_value') && labHtml.includes('logic.while_number') && labHtml.includes('react-flow__minimap') && labHtml.includes('node-kind-function')],
  ["theme lab exposes production-compatible soft tokens", labCss.includes('--canvas-node-shadow') && labCss.includes('--canvas-function') && labCss.includes('--canvas-flow')],
  ["theme lab can switch light/dark and canvas theme", labJs.includes('dataset.theme') && labJs.includes('dataset.canvasTheme')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`✓ ${name}`);
  else { failed += 1; console.error(`✗ ${name}`); }
}
if (failed) process.exit(1);
console.log(`Plot presentation smoke: ${checks.length}/${checks.length} checks passed.`);
