import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-node-plugin-manager-"));
try {
  const source = readFileSync(path.join(root, "src", "NodePluginManager.tsx"), "utf8");
  for (const token of ["installNodePluginPackage", "installNodePluginArchive", "activateInstalledNodePluginPackage", "unloadNodePluginPackage", "uninstallNodePluginPackage", "安装插件", "启用", "停用", "卸载"]) {
    if (!source.includes(token)) throw new Error(`plugin manager is missing ${token}`);
  }
  if (!source.includes("export function NodePluginManager({ open, language, onClose }")) throw new Error("plugin manager is not a controlled localized panel");
  for (const token of ["node-plugin-manager__stats", "node-plugin-manager__filters", "node-plugin-manager__search", "statusFilter", "runtimeFilter", "pluginDisplayName", "nodeDisplayName"]) {
    if (!source.includes(token)) throw new Error(`plugin manager compact dashboard is missing ${token}`);
  }

  const app = readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  if (app.includes("NodePluginManagerButton")) throw new Error("plugin manager still exposes a main-toolbar/menu button");
  if ((app.match(/<NodePluginManager open=/g) ?? []).length !== 1) throw new Error("controlled plugin manager panel is not mounted once by App");
  if (!app.includes("<NodePluginManager open={pluginManagerOpen} language={language}")) throw new Error("plugin manager must receive the app UI language");
  if (!app.includes("nodeDisplayName(spec.nodeType, spec.label, language)")) throw new Error("official demo node names are not localized in the palette");
  const topbar = app.slice(app.indexOf('<header className="topbar">'), app.indexOf('</header>', app.indexOf('<header className="topbar">')));
  if (topbar.includes("Python 包管理") || topbar.includes("节点插件")) throw new Error("package/plugin management must not be present in the main toolbar");

  const dialogs = readFileSync(path.join(root, "src", "dialogs.tsx"), "utf8");
  for (const token of ["settings-extension-section", "onOpenPackageManager", "onOpenPluginManager", "Python 包管理", "节点插件"]) {
    if (!dialogs.includes(token)) throw new Error(`settings extensions section is missing ${token}`);
  }

  const result = spawnSync(process.platform === "win32" ? "tsc.cmd" : "tsc", [
    path.join(root, "src", "NodePluginManager.tsx"),
    path.join(root, "src", "nodePluginPackages.ts"),
    path.join(root, "src", "nodePluginArchive.ts"),
    "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--jsx", "react-jsx",
    "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", path.join(root, "src"),
  ], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  console.log("Node Plugin Manager smoke: PASS (settings-only entry, localized compact dashboard, stats/search/status/runtime filters, manifest/archive lifecycle, TSX transpile)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
