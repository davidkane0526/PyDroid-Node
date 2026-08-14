const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const electron = require("electron");
const url = "http://127.0.0.1:5173";

const vite = spawn(pnpm, ["exec", "vite", "--config", "desktop/vite.config.ts", "--host", "127.0.0.1"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  shell: process.platform === "win32",
});

let desktop;
let stopped = false;

function stop(exitCode = 0) {
  if (stopped) return;
  stopped = true;
  if (desktop && !desktop.killed) desktop.kill();
  if (!vite.killed) vite.kill();
  process.exitCode = exitCode;
}

function waitForVite(attempt = 0) {
  if (stopped) return;
  const request = http.get(url, (response) => {
    response.resume();
    desktop = spawn(electron, ["desktop/main.cjs"], {
      cwd: root,
      env: { ...process.env, PYDROID_DESKTOP_URL: url },
      stdio: "inherit",
      windowsHide: true,
    });
    desktop.on("exit", (code) => stop(code ?? 0));
  });
  request.on("error", () => {
    if (attempt >= 120) stop(1);
    else setTimeout(() => waitForVite(attempt + 1), 250);
  });
}

vite.on("exit", (code) => {
  if (!stopped && code) stop(code);
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
waitForVite();
