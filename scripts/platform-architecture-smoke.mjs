import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const app = read("src/App.tsx");
const execution = read("src/execution.ts");
const desktopExecution = read("desktop/renderer/execution.ts");
const platformTypes = read("src/platform/types.ts");
const platformIndex = read("src/platform/index.ts");
const desktopPlatform = read("desktop/renderer/platform.ts");
const desktopBridge = read("desktop/renderer/bridge.ts");
const desktopVite = read("desktop/vite.config.ts");

assert(app.includes('from "./platform"'), "App.tsx must consume host capabilities from ./platform");
assert(app.includes('from "./execution"'), "App.tsx must keep runtime capabilities in ./execution");
assert(!app.includes("window.pyDroidDesktop"), "App.tsx must not access the Electron bridge directly");
assert(!app.includes("Capacitor.isNativePlatform"), "App.tsx must not select native platforms directly");

for (const source of [execution, desktopExecution]) {
  for (const symbol of [
    "discoverSmbServers",
    "listSmbDirectory",
    "scanSmbShares",
    "readSmbCsvFiles",
    "pickCsvFiles",
    "saveSmbSecret",
    "startRemoteServer",
    "chooseWorkflowFolder",
  ]) {
    assert(
      !new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`).test(source),
      `${symbol} must stay out of execution facades`,
    );
  }
}

for (const capability of ["files", "smb", "profile", "secrets", "remote", "system"]) {
  assert(platformTypes.includes(`readonly ${capability}:`), `PlatformAdapter must expose ${capability}`);
}

assert(platformIndex.includes("Capacitor.isNativePlatform()"), "shared platform facade must select Android vs browser adapter");
assert(desktopPlatform.includes('id: "desktop"'), "desktop PlatformAdapter implementation is missing");
assert(desktopBridge.includes("DesktopRuntimeBridge"), "desktop runtime bridge contract is missing");
assert(desktopBridge.includes("DesktopPlatformBridge"), "desktop platform bridge contract is missing");
assert(desktopVite.includes('find: /^\\.\\/platform$/'), "desktop Vite must alias ./platform to its renderer adapter");

console.log("PlatformAdapter architecture smoke passed");
