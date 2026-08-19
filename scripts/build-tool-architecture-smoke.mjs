import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  assert.match(main, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `build-pydroid.ps1 must import ${name}`);
  const body = readFileSync(path.join(moduleDir, name), "utf8");
  assert.match(body, /Export-ModuleMember\s+-Function/, `${name} should expose an explicit public surface`);
}

assert.match(main, /Import-Module\s+-Name\s+\$modulePath\s+-Force\s+-DisableNameChecking/, "main build script must load focused modules explicitly");
assert.doesNotMatch(main, /^function\s+Resolve-JavaHomeCandidate\b/m, "Java probing implementation belongs in the Java module");
assert.doesNotMatch(main, /^function\s+Normalize-ProxyUrl\b/m, "network parsing implementation belongs in the Network module");
assert.doesNotMatch(main, /^function\s+Get-ExtendedLengthPath\b/m, "path implementation belongs in the Paths module");
assert.doesNotMatch(main, /^function\s+Get-PythonVersionLabel\b/m, "Python version probing belongs in the Python module");
assert.match(main, /function\s+Test-NodeCandidate[\s\S]*Test-PyDroidNodeCandidate/, "Node wrapper should delegate version validation to its module");
assert.match(main, /function\s+Test-PythonSeries[\s\S]*Test-PyDroidPythonSeries/, "Python wrapper should delegate series validation to its module");
assert.match(main, /function\s+Remove-BuildDirectoryRobust[\s\S]*Remove-PyDroidBuildDirectoryRobust/, "packaging cleanup should delegate to its module");

const mainLines = main.split(/\r?\n/).length;
assert.ok(mainLines < 2500, `build-pydroid.ps1 should keep shrinking as orchestration root (currently ${mainLines} lines)`);
console.log(`Build-tool architecture smoke passed (${required.length} modules; main ${mainLines} lines).`);
