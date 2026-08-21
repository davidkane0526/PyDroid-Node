import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(path.join(root, "tools/build-pydroid.ps1"), "utf8");
const moduleDir = path.join(root, "tools/modules");
const required = [
  "PyDroid.Build.Network.psm1",
  "PyDroid.Build.Paths.psm1",
  "PyDroid.Build.Node.psm1",
  "PyDroid.Build.Java.psm1",
  "PyDroid.Build.Android.psm1",
  "PyDroid.Build.Python.psm1",
  "PyDroid.Build.Packaging.psm1",
];
const present = new Set(readdirSync(moduleDir));
for (const name of required) {
  assert.ok(present.has(name), `missing build-tool module ${name}`);
  assert.match(main, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `main must import ${name}`);
  const body = readFileSync(path.join(moduleDir, name), "utf8");
  assert.match(body, /Export-ModuleMember\s+-Function/);
  assert.doesNotMatch(body, /Import-Module[\s\S]*PyDroid\.Build\./i);
}

assert.match(main, /Import-Module\s+-Name\s+\$modulePath\s+-Force\s+-Global\s+-DisableNameChecking/);
assert.match(main, /PyDroid\.Build\.Paths\\Resolve-AbsolutePath/);
assert.match(main, /function\s+Remove-BuildDirectory[\s\S]*Remove-PyDroidBuildDirectory/);
assert.doesNotMatch(main, /Start-DeferredCleanup|Queue-DeferredCleanup|deferred-cleanup\.ps1|Remove-BuildDirectoryRobust|Remove-PyDroidBuildDirectoryRobust/);
assert.equal(existsSync(path.join(root, "tools", "deferred-cleanup.ps1")), false);
assert.match(main, /Write-BuildStage -Percent 100 -Message "构建完成"/);
assert.match(main, /Windows Desktop 已编译完成，可直接运行目录/);
assert.match(main, /Android APK 已编译完成，可直接安装/);

const mainLines = main.split(/\r?\n/).length;
assert.ok(mainLines < 1000, `build-pydroid.ps1 should remain a small orchestrator (currently ${mainLines} lines)`);
console.log(`Build-tool architecture smoke passed (${required.length} modules; main ${mainLines} lines).`);
