import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const main = read("src/main.tsx");
const app = read("src/App.tsx");
const dialogs = read("src/dialogs.tsx");
const sdk = read("sdk/theme.ts");
const designSdk = read("sdk/design.ts");
const contract = read("src/styles/theme-contract.css");
const styles = read("src/styles/base.css");
const canvas = read("src/styles/canvas.css");
const pluginManagerCss = read("src/plugins/plugin-manager.css");
const manifest = JSON.parse(read("examples/plugins/demo-midnight-theme.plugin.json"));

assert.ok(main.indexOf('import "./styles/theme-contract.css";') > main.indexOf('import "./plugins/plugin-manager.css";'), "theme contract stylesheet must load last");
assert.match(dialogs, /界面主题[\s\S]*uiThemes\.map/, "Settings must expose the installed UI theme registry");
assert.match(app, /data-ui-theme=\{resolveUiTheme\(uiThemeId\)\.id\}/, "workspace must expose the resolved theme id");
assert.match(app, /uiThemeCssVariables\(uiThemeId, resolvedTheme\)/, "theme selection must resolve to semantic CSS variables");
assert.match(app, /const themeVariables = uiThemeCssVariables\(uiThemeId, resolvedTheme\)[\s\S]*style=\{workspaceStyle\}/, "resolved theme variables must be applied directly to the app shell");
assert.match(contract, /input-port \.react-flow__handle[\s\S]*var\(--canvas-handle-border\)/, "non-default themes must be able to theme node handles");
assert.match(styles, /workflow-node\.node-kind-group/, "group styling must use semantic node classes rather than hidden type-label DOM");
assert.doesNotMatch(styles, /:has\(\.workflow-node__type\[title=\"workflow\.group\"\]\)/, "group styling must not depend on the optional type label");
assert.match(styles, /--ui-control-height:\s*32px/, "Core geometry tokens should remain centrally defined");
for (const forbidden of ["ui-control-height", "ui-radius-sm", "ui-radius-md", "ui-radius-lg", "node-width", "node-min-height", "node-scale", "endpoint-scale"]) {
  assert.doesNotMatch(sdk, new RegExp(`\\"${forbidden}\\"`), `theme SDK must not expose Core geometry token ${forbidden}`);
}
for (const required of ["bg", "surface", "text", "accent", "ui-shadow", "canvas-bg", "canvas-node-face", "canvas-node-border", "canvas-edge", "canvas-selection"]) {
  assert.match(sdk, new RegExp(`\\"${required}\\"`), `theme SDK is missing semantic token ${required}`);
}
for (const designToken of ["material-panel-shadow", "material-card-shadow", "material-control-shadow", "material-popup-shadow", "material-node-shadow", "material-overlay-blur", "motion-duration-fast", "motion-duration-normal", "motion-ease-standard", "motion-hover-lift", "motion-press-scale", "motion-enter-distance"]) {
  assert.ok(designSdk.includes(`"${designToken}"`), `Design SDK is missing ${designToken}`);
}
assert.match(contract, /prefers-reduced-motion: reduce/, "theme/design contract must respect reduced motion");
assert.match(contract, /material-popup-shadow/, "theme/design contract must use semantic popup material");
assert.match(contract, /motion-duration-normal/, "theme/design contract must use semantic motion timing");
for (const selector of [".workspace-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"])", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .topbar", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .node-palette", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .inspector", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .app-statusbar", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .settings-dialog", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .package-manager", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .data-grid", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .notebook-view", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .smb-dialog", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .result-panel", ".app-shell[data-ui-theme]:not([data-ui-theme=\"core.default\"]) .workflow-node"]) {
  assert.ok(contract.includes(selector), `theme contract does not cover ${selector}`);
}
assert.doesNotMatch(contract, /\.app-shell\[data-ui-theme\](?!:not\(\[data-ui-theme="core\.default"\]\))/, "theme overlay must never target core.default globally");
assert.doesNotMatch(contract, /(?:width|height|min-width|max-width|min-height|max-height|padding|margin|gap|font-size|line-height)\s*:/, "theme contract CSS must stay appearance-only");
assert.doesNotMatch(canvas, /--canvas-handle-ring/, "obsolete canvas handle token remains in canvas themes");
assert.match(pluginManagerCss, /background:\s*#020617d9/, "core.default plugin manager must preserve the accepted legacy backdrop");
assert.match(contract, /node-plugin-manager[\s\S]*var\(--material-popup-shadow\)/, "installed themes must still be able to override plugin-manager material");
assert.equal(manifest.nodes, undefined, "theme SDK demo should prove a theme-only plugin package");
assert.equal(manifest.themes?.[0]?.id, "demo.midnight", "theme-only demo is missing the expected theme");

const require = createRequire(import.meta.url);
let tsc;
try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
const syntaxFiles = ["src/App.tsx", "src/dialogs.tsx", "src/plugins/PluginManager.tsx", "sdk/theme.ts", "sdk/design.ts", "src/nodes/layout.ts", "src/plugins/packages.ts", "src/plugins/archive.ts"].map((file) => path.join(root, file));
const transpile = spawnSync(tsc.command, [...tsc.args, ...syntaxFiles, "--jsx", "react-jsx", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--skipLibCheck", "--noCheck", "--noEmit"], { cwd: root, encoding: "utf8" });
if (transpile.error || transpile.status !== 0) throw new Error(transpile.stderr || transpile.stdout || transpile.error?.message);

console.log("UI Theme Contract smoke: PASS (opt-in theme overlay, core.default visual compatibility, material/motion registry, no geometry injection, theme-only package, TSX syntax)");
