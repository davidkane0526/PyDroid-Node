import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { packageManagerInvocation } from "./desktop-package-invocation.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(root, ".tools", "electron-builder-cache");
const environment = {
  ...process.env,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE || path.join(root, ".tools", "electron-cache"),
  ELECTRON_BUILDER_CACHE: cache,
};

const rendererSource = path.join(root, "dist-desktop");
const rendererStage = path.join(root, "desktop", "package-renderer");
const releaseDir = path.join(root, "release", "win-unpacked");
const smokeLog = path.join(root, "release", "desktop-package-smoke.log");
const retryCount = Math.max(1, Number.parseInt(process.env.PYDROID_DESKTOP_PACKAGE_RETRIES || "3", 10) || 3);
const allowPlainExeFallback = process.env.PYDROID_DESKTOP_PLAIN_EXE_FALLBACK !== "0";

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

function runPnpm(args, options = {}) {
  const invocation = packageManagerInvocation(args);
  run(invocation.command, invocation.args, { shell: invocation.shell, ...options });
}

function runPnpmCaptured(args) {
  const invocation = packageManagerInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    shell: invocation.shell,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    output: `${result.stdout || ""}\n${result.stderr || ""}`,
  };
}

function isNetworkFailure(text) {
  return /(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND|socket hang up|timed out|github\.com|githubusercontent\.com)/i.test(text);
}

function electronBuilderArgs(extra = []) {
  return ["exec", "electron-builder", "--win", "dir", ...extra];
}

function packageWithRetry() {
  let last = null;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    if (attempt > 1) {
      console.warn(`electron-builder network retry ${attempt}/${retryCount} ...`);
    }
    last = runPnpmCaptured(electronBuilderArgs());
    if (last.status === 0) return { degraded: false };
    if (!isNetworkFailure(last.output)) {
      throw new Error(`electron-builder exited with code ${last.status}`);
    }
  }

  if (!allowPlainExeFallback) {
    throw new Error(`electron-builder failed after ${retryCount} network attempts`);
  }

  console.warn(
    "electron-builder could not download its Windows helper files. " +
      "Retrying with Windows code signing explicitly disabled while preserving executable resources.",
  );
  const unsignedFallback = runPnpmCaptured(
    electronBuilderArgs(["--config.win.signExecutable=false"]),
  );
  if (unsignedFallback.status === 0) {
    return { degraded: false, unsignedFallback: true };
  }

  console.warn(
    "Unsigned resource-preserving packaging still failed. " +
      "Retrying without executable resource editing as the final compatibility fallback. " +
      "The application remains runnable, but the .exe may use generic Electron metadata/icon.",
  );
  const plainFallback = runPnpmCaptured(
    electronBuilderArgs([
      "--config.win.signAndEditExecutable=false",
      "--config.win.signExecutable=false",
    ]),
  );
  if (plainFallback.status !== 0) {
    throw new Error(`electron-builder compatibility fallback exited with code ${plainFallback.status}`);
  }
  return { degraded: true, unsignedFallback: false };
}

function findPackagedExecutable() {
  if (!fs.existsSync(releaseDir)) return null;
  const preferred = path.join(releaseDir, "PyDroid Flow.exe");
  if (fs.existsSync(preferred)) return preferred;
  const executable = fs.readdirSync(releaseDir).find((name) => name.toLowerCase().endsWith(".exe"));
  return executable ? path.join(releaseDir, executable) : null;
}

try {
  runPnpm(["desktop:build"]);

  // OneDrive workspaces may use junctions for generated output. electron-builder's
  // file matcher does not reliably follow those junctions, so stage a real copy.
  fs.rmSync(rendererStage, { recursive: true, force: true });
  fs.cpSync(rendererSource, rendererStage, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(rendererStage, "index.html"))) {
    throw new Error("Desktop renderer staging failed: index.html is missing");
  }

  const packageResult = packageWithRetry();
  const packagedExecutable = findPackagedExecutable();
  if (!packagedExecutable) {
    throw new Error(`Packaged desktop executable is missing under: ${releaseDir}`);
  }

  fs.rmSync(smokeLog, { force: true });
  run(packagedExecutable, [], {
    env: {
      ...environment,
      PYDROID_DESKTOP_SMOKE: "1",
      PYDROID_DESKTOP_SMOKE_LOG: smokeLog,
    },
    timeout: 120_000,
  });
  if (!fs.existsSync(smokeLog) || fs.readFileSync(smokeLog, "utf8").trim() !== "passed") {
    throw new Error("Packaged desktop smoke test did not report success");
  }
  console.log(
    packageResult.degraded
      ? "Packaged desktop smoke test passed (plain compatibility packaging mode)"
      : packageResult.unsignedFallback
        ? "Packaged desktop smoke test passed (unsigned resource-preserving mode)"
        : "Packaged desktop UI/IPC/Python smoke test passed",
  );
} finally {
  fs.rmSync(rendererStage, { recursive: true, force: true });
}
