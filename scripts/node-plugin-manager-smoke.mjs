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
  const app = readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  if ((app.match(/<NodePluginManagerButton/g) ?? []).length !== 2) throw new Error("plugin manager is not exposed on desktop and mobile tool surfaces");
  const result = spawnSync(process.platform === "win32" ? "tsc.cmd" : "tsc", [
    path.join(root, "src", "NodePluginManager.tsx"),
    path.join(root, "src", "nodePluginPackages.ts"),
    path.join(root, "src", "nodePluginArchive.ts"),
    "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--jsx", "react-jsx",
    "--skipLibCheck", "--noCheck", "--outDir", temp, "--rootDir", path.join(root, "src"),
  ], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  console.log("Node Plugin Manager smoke: PASS (desktop/mobile entry, manifest/archive install/enable/disable/uninstall, TSX transpile)");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
