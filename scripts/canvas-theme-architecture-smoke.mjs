import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const dialogs = read("src/dialogs.tsx");
const main = read("src/main.tsx");
const registry = read("src/canvas-theme.ts");
const css = read("src/canvas-themes.css");
const sharedStyles = read("src/styles.css");

const checks = [
  [registry.includes('"classic"') && registry.includes('"soft"'), "canvas theme registry exposes classic and soft themes"],
  [registry.includes('DEFAULT_CANVAS_THEME: CanvasThemeId = "soft"'), "soft theme is the explicit new default"],
  [main.indexOf('"./canvas-themes.css"') > main.indexOf('"./ui-fixes.css"'), "canvas theme CSS is a final isolated override layer"],
  [app.includes("data-canvas-theme={canvasTheme}"), "canvas theme id is exposed on the app shell"],
  [app.includes("node-kind-function") && app.includes("node-kind-group") && app.includes("node-kind-flow"), "nodes expose semantic theme classes"],
  [app.includes("canvasTheme: normalizeCanvasTheme(saved.canvasTheme"), "saved canvas theme is normalized"],
  [app.includes("setCanvasTheme(imported.canvasTheme)"), "settings import restores canvas theme"],
  [dialogs.includes('L("画布主题", "Canvas theme")'), "settings UI exposes canvas theme selection"],
  [css.includes('[data-canvas-theme="soft"]') && !css.includes('[data-canvas-theme="classic"] .workflow-node'), "classic remains the unmodified baseline while soft is isolated"],
  [css.includes("Theme Lab 1.6.7") && css.includes("Flat Run Control"), "soft theme is sourced from the accepted Theme Lab 1.6.7"],
  [css.includes("--canvas-function") && css.includes("--canvas-group") && css.includes("--canvas-flow"), "soft theme keeps semantic function/group/flow tokens"],
  [!css.includes("translateY(-1px)") && /workflow-node:not\(\.workflow-structure\):hover\s*\{[^}]*transform:\s*none\s*;/s.test(css), "soft node hover never changes node geometry"],
  [!/(?:width|height|min-height|max-height|padding|top|right|bottom|left|margin|font-size)\s*:/i.test(css), "canvas theme CSS is appearance-only and cannot change shared node geometry"],
  [!css.includes("385px") && !css.includes("268px") && !css.includes("46px"), "Theme Lab reference geometry is not copied into production theme overrides"],
  [!css.includes(".canvas-panel") && !css.includes(".react-flow__background"), "canvas theme cannot replace or fade the shared canvas background/grid/masks"],
  [app.includes('<Background variant={BackgroundVariant.Dots} gap={20} size={1.25} />') && !/Background[^>]+canvasTheme/.test(app), "React Flow dot background is identical across Classic and Soft themes"],
  [app.includes('M5.25 3.15 L11.25 6.55 Q12.85 7 11.25 7.45') && sharedStyles.includes('top: -0.5px') && sharedStyles.includes('width: 12px; height: 12px'), "run glyph is smaller, softly rounded and optically centered"],
  [sharedStyles.includes('.environment-float-button > svg circle { fill: currentColor; stroke: none; }') && sharedStyles.includes('stroke-width: 1;'), "environment icon uses crisp one-pixel rails with solid controls"],
  [css.includes("Run button shares Classic geometry") && css.includes("transform: none !important"), "soft run control keeps shared placement and motion-free interaction"],
  [/node-run-action[^{]*\{[^}]*transform:\s*none\s*!important/s.test(css), "soft run action visibility does not use positional motion"],
  [css.includes("workflow-node__tag") && css.includes("workflow-node__meta-count"), "soft cards expose structured metadata and tag styling"],
  [app.includes("WORKFLOW_DEMOS") && app.includes("flow-library-item--demo"), "built-in demos are exposed in the flow palette"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { console.error(`✗ ${label}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`Canvas theme architecture smoke passed (${checks.length}/${checks.length}).`);
