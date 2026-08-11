import { spawnSync } from "node:child_process";
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

for (const args of [
  ["desktop:build"],
  ["exec", "electron-builder", "--win", "portable"],
]) {
  const result = spawnSync(pnpm, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
