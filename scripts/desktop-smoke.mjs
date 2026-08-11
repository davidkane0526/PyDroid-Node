import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const electron = require("electron");
const result = spawnSync(electron, ["desktop/main.cjs"], {
  cwd: root,
  env: { ...process.env, PYDROID_DESKTOP_SMOKE: "1" },
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
