import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
const localPython = process.platform === "win32"
  ? path.join(root, ".tools", "python312-runtime", "python.exe")
  : path.join(root, ".tools", "python312-runtime", "bin", "python");

const candidates = configured
  ? [{ command: configured, prefix: [] }]
  : [
      ...(existsSync(localPython) ? [{ command: localPython, prefix: [] }] : []),
      ...(process.platform === "win32"
        ? [{ command: "py", prefix: ["-3.12"] }]
        : [
            { command: "python3.12", prefix: [] },
            { command: "python", prefix: [] },
          ]),
    ];

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, [...candidate.prefix, ...process.argv.slice(2)], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (!result.error) process.exit(result.status ?? 1);
}

console.error("Python 3.12 was not found. Run `pnpm env:windows` or set PYDROID_PYTHON_EXECUTABLE.");
process.exit(1);
