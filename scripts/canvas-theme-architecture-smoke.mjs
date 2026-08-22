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
  [css.includes("--canvas-function") && css.includes("--canvas-group") && css.includes("--canvas-flow"), "soft theme defines distinct function/group/flow tokens"],
  [!css.includes("translateY(-1px)") && !/workflow-node:not\(\.workflow-structure\):hover\s*\{[^}]*transform:/s.test(css), "soft node hover never changes node geometry"],
  [css.includes("--canvas-node-rim") && css.includes("0 3px 0 var(--canvas-node-rim)"), "soft cards use a persistent material rim instead of hover lift"],
  [/data-canvas-theme="soft"[^}]*\.node-run-action[^{]*\{[^}]*transform:\s*none/s.test(css), "soft run action visibility does not use positional motion"],
  [css.includes("workflow-node__tag") && css.includes("workflow-node__meta-count"), "soft cards expose structured metadata and tag styling"],
  [css.includes("::before") && css.includes("--canvas-node-highlight"), "soft cards include an inner surface highlight for material depth"],
  [app.includes("WORKFLOW_DEMOS") && app.includes("flow-library-item--demo"), "built-in demos are exposed in the flow palette"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { console.error(`✗ ${label}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`Canvas theme architecture smoke passed (${checks.length}/${checks.length}).`);
