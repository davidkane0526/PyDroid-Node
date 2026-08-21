import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const buildHome = process.env.PYDROID_BUILD_HOME || (process.platform === "win32" ? "D:\\PyDroidTemp" : path.join(process.env.TMPDIR || "/tmp", "pydroid-flow"));
const environment = {
  ...process.env,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE || path.join(buildHome, "cache", "electron"),
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || path.join(buildHome, "cache", "electron-builder"),
};

const rendererSource = path.join(root, "dist-desktop");
const rendererStage = path.join(root, "desktop", "package-renderer");
const remoteRendererSource = path.join(root, "dist");
const remoteRendererStage = path.join(root, "desktop", "package-remote");
const releaseDir = path.join(root, "release", "win-unpacked");
const smokeLog = path.join(root, "release", "desktop-package-smoke.log");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBuilder = path.join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? 1}`);
}

function runNodeTool(script, args) {
  if (!fs.existsSync(script)) throw new Error(`Required local build tool is missing: ${script}`);
  run(process.execPath, [script, ...args]);
}

function buildRenderer(configPath = null) {
  runNodeTool(tsc, ["--noEmit", "-p", configPath ? "desktop/tsconfig.json" : "tsconfig.json"]);
  const args = ["build"];
  if (configPath) args.push("--config", configPath);
  runNodeTool(vite, args);
}

function findPackagedExecutable() {
  if (!fs.existsSync(releaseDir)) return null;
  const expected = path.join(releaseDir, "PyDroid Flow.exe");
  return fs.existsSync(expected) ? expected : null;
}

try {
  buildRenderer();
  buildRenderer("desktop/vite.config.ts");

  // electron-builder consumes explicit staging directories from package.json.
  fs.rmSync(rendererStage, { recursive: true, force: true });
  fs.cpSync(rendererSource, rendererStage, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(rendererStage, "index.html"))) throw new Error("Desktop renderer staging failed: index.html is missing");

  fs.rmSync(remoteRendererStage, { recursive: true, force: true });
  fs.cpSync(remoteRendererSource, remoteRendererStage, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(remoteRendererStage, "index.html"))) throw new Error("Remote Web renderer staging failed: browser index.html is missing");

  runNodeTool(electronBuilder, ["--win", "dir"]);
  const packagedExecutable = findPackagedExecutable();
  if (!packagedExecutable) throw new Error(`Packaged desktop executable is missing: ${path.join(releaseDir, "PyDroid Flow.exe")}`);

  fs.rmSync(smokeLog, { force: true });
  run(packagedExecutable, [], {
    env: { ...environment, PYDROID_DESKTOP_SMOKE: "1", PYDROID_DESKTOP_SMOKE_LOG: smokeLog },
    timeout: 120_000,
  });
  if (!fs.existsSync(smokeLog) || fs.readFileSync(smokeLog, "utf8").trim() !== "passed") {
    throw new Error("Packaged desktop smoke test did not report success");
  }
  console.log("Packaged desktop UI/IPC/Python/Remote Web smoke test passed");
} finally {
  fs.rmSync(rendererStage, { recursive: true, force: true });
  fs.rmSync(remoteRendererStage, { recursive: true, force: true });
}
