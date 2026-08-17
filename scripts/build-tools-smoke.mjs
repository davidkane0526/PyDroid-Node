import assert from "node:assert/strict";
import { packageManagerInvocation } from "./desktop-package-invocation.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const buildScriptPath = fileURLToPath(new URL("../tools/build-pydroid.ps1", import.meta.url));
const buildScript = readFileSync(buildScriptPath, "utf8");
assert.doesNotMatch(
  buildScript,
  /param\s*\([^)]*\$Home\b/i,
  "PowerShell parameters must not shadow the read-only automatic $HOME variable",
);
assert.doesNotMatch(
  buildScript,
  /^\s*\$Home\s*=/im,
  "PowerShell code must not assign to the read-only automatic $HOME variable",
);

assert.match(
  buildScript,
  /@@PYDROID_STAGE@@\|\{0\}\|\{1\}/,
  "build script should emit machine-readable GUI stage events",
);
assert.match(
  buildScript,
  /& robocopy @robocopyArgs \| Out-Null/,
  "source synchronization should suppress robocopy EXTRA-file spam",
);
assert.match(
  buildScript,
  /Microsoft\\jdk-\*/,
  "JDK discovery should scan Microsoft OpenJDK common install directories",
);
assert.match(
  buildScript,
  /Get-JavaHomesFromRegistry/,
  "JDK discovery should inspect Windows registry/uninstall metadata",
);
assert.match(
  buildScript,
  /Get-Command \$commandName -All/,
  "JDK discovery should inspect all Java/Javac commands instead of only the first PATH hit",
);

const buildGuiPath = fileURLToPath(new URL("../tools/build-pydroid-gui.ps1", import.meta.url));
const buildGui = readFileSync(buildGuiPath, "utf8");
assert.match(buildGui, /ProgressBar/, "build GUI should expose a stage progress bar");
assert.match(buildGui, /\^@@PYDROID_STAGE@@/, "build GUI should consume stage events");


const args = ["desktop:build"];
const existsSync = () => true;

assert.deepEqual(
  packageManagerInvocation(args, {
    env: { npm_execpath: "C:\\pnpm\\pnpm.exe", npm_node_execpath: "C:\\node\\node.exe" },
    platform: "win32",
    nodeExecPath: "fallback-node.exe",
    existsSync,
  }),
  { command: "C:\\pnpm\\pnpm.exe", args, shell: false },
  "native pnpm.exe must be executed directly instead of being loaded by node.exe",
);

assert.deepEqual(
  packageManagerInvocation(args, {
    env: { npm_execpath: "C:\\corepack\\pnpm.cjs", npm_node_execpath: "C:\\node\\node.exe" },
    platform: "win32",
    nodeExecPath: "fallback-node.exe",
    existsSync,
  }),
  { command: "C:\\node\\node.exe", args: ["C:\\corepack\\pnpm.cjs", ...args], shell: false },
  "JavaScript package-manager launchers should run through Node",
);

assert.deepEqual(
  packageManagerInvocation(args, {
    env: { npm_execpath: "C:\\pnpm\\pnpm.cmd" },
    platform: "win32",
    nodeExecPath: "node.exe",
    existsSync,
  }),
  { command: "C:\\pnpm\\pnpm.cmd", args, shell: true },
  "Windows cmd launchers require a shell",
);

assert.deepEqual(
  packageManagerInvocation(args, { env: {}, platform: "win32", nodeExecPath: "node.exe", existsSync: () => false }),
  { command: "pnpm.cmd", args, shell: true },
  "Windows fallback should use pnpm.cmd through the shell",
);

console.log("build-tool package-manager invocation smoke passed");
