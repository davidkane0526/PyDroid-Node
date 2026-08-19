import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const contract = JSON.parse(read("src/platform/host-contract.json"));
assert.equal(contract.version, 1, "host contract version must stay explicit");
assert.ok(Array.isArray(contract.operations) && contract.operations.length >= 25, "host contract should cover the stable host surface");

const operationIds = contract.operations.map((item) => `${item.capability}.${item.operation}`);
assert.equal(new Set(operationIds).size, operationIds.length, "host contract operations must be unique");

const preload = read("desktop/preload.cjs");
const desktopIpc = readdirSync(path.join(root, "desktop/ipc")).filter((name) => name.endsWith(".cjs")).map((name) => read(`desktop/ipc/${name}`)).join("\n");
const androidTypes = read("src/platform/android-plugin.ts");
const androidPlugin = read("android/app/src/main/java/com/dk/pydroidflow/PythonExecutorPlugin.java");
const uiChromePlugin = read("android/app/src/main/java/com/dk/pydroidflow/UiChromePlugin.java");

for (const entry of contract.operations) {
  if (entry.desktop?.bridge) {
    assert.match(preload, new RegExp(`\\b${entry.desktop.bridge}\\s*:`), `desktop preload is missing ${entry.desktop.bridge}`);
  }
  if (entry.desktop?.channel) {
    const escaped = entry.desktop.channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(preload, new RegExp(escaped), `desktop preload is missing channel ${entry.desktop.channel}`);
    assert.match(desktopIpc, new RegExp(escaped), `desktop IPC registration is missing channel ${entry.desktop.channel}`);
  }
  if (entry.android?.method) {
    const typePattern = new RegExp(`\\b${entry.android.method}\\s*\\(`);
    assert.match(androidTypes, typePattern, `Android TypeScript contract is missing ${entry.android.method}`);
    const javaSource = entry.android.plugin === "UiChrome" ? uiChromePlugin : androidPlugin;
    assert.match(javaSource, typePattern, `Android Java binding is missing ${entry.android.method}`);
  }
}

const platformTypes = read("src/platform/types.ts");
for (const capability of ["files", "smb", "profile", "secrets", "remote", "system"]) {
  assert.match(platformTypes, new RegExp(`readonly\\s+${capability}\\s*:`), `PlatformAdapter must expose ${capability}`);
}

console.log(`Host contract smoke passed (${contract.operations.length} stable operations).`);
