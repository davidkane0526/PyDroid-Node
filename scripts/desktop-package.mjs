import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cache = path.join(root, ".tools", "electron-builder-cache");
const environment = {
  ...process.env,
  ELECTRON_CACHE: path.join(root, ".tools", "electron-cache"),
  ELECTRON_BUILDER_CACHE: cache,
};

const rendererSource = path.join(root, "dist-desktop");
const rendererStage = path.join(root, "desktop", "package-renderer");
const packagedExecutable = path.join(root, "release", "win-unpacked", "PyDroid Flow.exe");
const smokeLog = path.join(root, "release", "desktop-package-smoke.log");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32" && command === pnpm,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? 1}`);
}

try {
  run(pnpm, ["desktop:build"]);

  // OneDrive workspaces use junctions for generated output. electron-builder's
  // file matcher does not follow that junction, so make a temporary real copy
  // beside the desktop entry point before packaging.
  fs.rmSync(rendererStage, { recursive: true, force: true });
  fs.cpSync(rendererSource, rendererStage, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(rendererStage, "index.html"))) {
    throw new Error("Desktop renderer staging failed: index.html is missing");
  }

  run(pnpm, ["exec", "electron-builder", "--win", "dir"]);

  if (!fs.existsSync(packagedExecutable)) {
    throw new Error(`Packaged desktop executable is missing: ${packagedExecutable}`);
  }
  fs.rmSync(smokeLog, { force: true });
  run(packagedExecutable, [], {
    env: {
      ...environment,
      PYDROID_DESKTOP_SMOKE: "1",
      PYDROID_DESKTOP_SMOKE_LOG: smokeLog,
    },
    shell: false,
    timeout: 120_000,
  });
  if (fs.readFileSync(smokeLog, "utf8").trim() !== "passed") {
    throw new Error("Packaged desktop smoke test did not report success");
  }
  console.log("Packaged desktop UI/IPC/Python smoke test passed");
} finally {
  fs.rmSync(rendererStage, { recursive: true, force: true });
}
