import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const dialogs = read("src/dialogs.tsx");
const plotView = read("src/ui/PlotView.tsx");
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
  ["interactive charts use explicit device pixel ratio", plotView.includes('devicePixelRatio: Math.min(3')],
  ["runtime heatmap payload stores serializable metadata", plots.includes('__pydroidHeatmapMeta') && !plots.includes('formatter: (item: { value: [number, number, number | null] })')],
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
