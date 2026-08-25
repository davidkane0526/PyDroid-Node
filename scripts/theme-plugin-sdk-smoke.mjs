import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-theme-plugin-sdk-"));
try {
  const require = createRequire(import.meta.url);
  let tsc;
  try { tsc = { command: process.execPath, args: [require.resolve("typescript/bin/tsc")] }; }
  catch { tsc = { command: process.platform === "win32" ? "tsc.cmd" : "tsc", args: [] }; }
  const result = spawnSync(tsc.command, [...tsc.args, path.join(root, "src", "themePluginSdk.ts"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", temp, "--rootDir", path.join(root, "src")], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  writeFileSync(path.join(temp, "package.json"), '{"type":"commonjs"}\n');
  const module = await import(pathToFileURL(path.join(temp, "themePluginSdk.js")).href);
  const sdk = module.default ?? module;
  if (sdk.DEFAULT_UI_THEME_ID !== "core.default") throw new Error("unexpected default theme id");
  if (!sdk.listUiThemes().some((theme) => theme.id === "core.default")) throw new Error("core default theme missing");
  const definition = sdk.defineUiTheme({ id: "demo.contract", labelZh: "契约主题", labelEn: "Contract", tokens: { dark: { bg: "#010203", accent: "#336699", "canvas-node-face": "#112233" } } });
  const registration = sdk.registerUiTheme(definition);
  if (sdk.resolveUiTheme("demo.contract").id !== "demo.contract") throw new Error("registered theme not resolvable");
  const vars = sdk.uiThemeCssVariables("demo.contract", "dark");
  if (vars["--bg"] !== "#010203" || vars["--canvas-node-face"] !== "#112233") throw new Error("theme tokens were not mapped to CSS custom properties");
  let geometryRejected = false;
  try { sdk.defineUiTheme({ id: "demo.bad-layout", labelZh: "坏", labelEn: "Bad", tokens: { dark: { "node-width": "999px" } } }); } catch { geometryRejected = true; }
  if (!geometryRejected) throw new Error("theme SDK accepted a layout/geometry token");
  let duplicateRejected = false;
  try { sdk.registerUiTheme(definition); } catch { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error("duplicate theme registration was accepted");
  if (!registration.unregister() || registration.unregister()) throw new Error("theme unregister is not deterministic");
  if (sdk.resolveUiTheme("demo.contract").id !== "core.default") throw new Error("unregistered theme did not fall back to Core default");
  console.log("Theme Plugin SDK smoke: PASS (token whitelist, CSS variables, duplicate guard, deterministic unload, no layout injection)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
