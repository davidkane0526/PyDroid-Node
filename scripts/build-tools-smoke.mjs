import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const build = read("tools/build-pydroid.ps1");
const gui = read("tools/build-pydroid-gui.ps1");
const network = read("tools/modules/PyDroid.Build.Network.psm1");
const nodeModule = read("tools/modules/PyDroid.Build.Node.psm1");
const javaModule = read("tools/modules/PyDroid.Build.Java.psm1");
const androidModule = read("tools/modules/PyDroid.Build.Android.psm1");
const pythonModule = read("tools/modules/PyDroid.Build.Python.psm1");
const packagingModule = read("tools/modules/PyDroid.Build.Packaging.psm1");
const androidPackage = read("scripts/android-package.ps1");
const desktopPackage = read("scripts/desktop-package.mjs");
const packageJson = JSON.parse(read("package.json"));

assert.match(build, new RegExp(`BuildScriptRevision = "${packageJson.version.replaceAll(".", "\\.")}-`));
assert.match(build, /return "D:\\PyDroidTemp"/);
assert.match(build, /return "D:\\Code"/);
assert.match(nodeModule, /Join-Path \$ToolRoot 'NodeJs\\node\.exe'/);
assert.match(build, /Join-Path \$ToolRoot 'Language\\Java'/);
assert.match(pythonModule, /Join-Path \$ToolRoot 'Python\\3\.13\\python\.exe'/);
assert.match(androidModule, /Join-Path \$ToolRoot 'Android\\Sdk'/);
assert.match(build, /Invoke-Pnpm \$installArgs/);
assert.match(build, /Invoke-Pnpm @\("desktop:package"\)/);
assert.match(build, /Join-Path \$OutputRoot "\$outputBaseName-Desktop"/, "default Desktop output must use a stable executable path across versions");
assert.match(build, /@\(\$unpacked, \$desktopDest, '\/MIR'/, "stable Desktop output must be replaced by one robocopy mirror operation");
assert.doesNotMatch(build, /Remove-BuildDirectory -Path \$desktopDest/, "stable Desktop output must not be recursively deleted before replacement");
assert.doesNotMatch(build, /Corepack|COREPACK_HOME|Install-Node|Install-Jdk|Install-AndroidSdk|Install-Python|SearchRoots|DeferredCleanup|compatibility package|PLAIN_EXE_FALLBACK/i);

assert.match(nodeModule, /Join-Path \$env:LOCALAPPDATA 'pnpm\\bin\\pnpm\.cmd'/);
assert.doesNotMatch(nodeModule, /Get-Command|Get-ItemProperty|Registry|CurrentVersion\\Uninstall|where\.exe|py\.exe|Program Files|recursive|fallback/i,
  "Node build helper must not scan alternate machine locations");
for (const [name, source] of [
  ["Java", javaModule], ["Android", androidModule], ["Python", pythonModule],
]) {
  assert.doesNotMatch(source, /Get-Command|Get-ItemProperty|Registry|CurrentVersion\\Uninstall|where\.exe|py\.exe|Program Files|LOCALAPPDATA|recursive|fallback/i,
    `${name} build helper must not scan alternate machine locations`);
}
assert.match(packagingModule, /Remove-Item -LiteralPath \$Path -Recurse -Force -ErrorAction Stop/);
assert.doesNotMatch(packagingModule, /cmd\.exe|robocopy|\\\\\?\\|fallback|retry/i);
assert.equal(existsSync(path.join(root, "tools/deferred-cleanup.ps1")), false, "deferred cleanup worker must be removed");

assert.match(network, /ValidateSet\('Direct','Manual'\)/);
assert.match(network, /PNPM_CONFIG_FETCH_RETRIES = '0'/);
assert.doesNotMatch(network, /Internet Settings|AutoConfigURL|Get-WindowsInternetProxy|Test-LocalProxyEndpoint|Get-ItemProperty/i);

assert.match(desktopPackage, /node_modules", "typescript", "bin", "tsc/);
assert.match(desktopPackage, /node_modules", "vite", "bin", "vite\.js/);
assert.match(desktopPackage, /node_modules", "electron-builder", "out", "cli", "cli\.js/);
assert.doesNotMatch(desktopPackage, /packageManagerInvocation|npm_execpath|packageWithRetry|signExecutable=false|signAndEditExecutable=false|plain exe|compatibility fallback|retry/i);
assert.equal(existsSync(path.join(root, "scripts/desktop-package-invocation.mjs")), false, "package-manager launcher fallback must be removed");
assert.equal(existsSync(path.join(root, "scripts/local-storage.ps1")), false, "junction-based local-storage shim must be removed");
assert.equal(existsSync(path.join(root, "scripts/fix-capacitor-paths.ps1")), false, "junction path rewrite shim must be removed");
assert.equal(packageJson.scripts["android:sync"], "pnpm build && cap sync android");
assert.match(androidPackage, /& "\.\\gradlew\.bat" @gradleArgs/);
assert.match(androidPackage, /if \(\$disableGradleDaemon\) \{ \$gradleArgs \+= "--no-daemon" \} else \{ \$gradleArgs \+= "--daemon" \}/);
assert.doesNotMatch(androidPackage, /gradlew\.bat --stop|Clear-PyDroidGradleDaemonState|Kill\(|BUILD SUCCESSFUL.*APK|py -3\.13|LOCALAPPDATA|\.tools\\jdk|retry|fallback|recovery/i);

assert.match(gui, /@\("直连", "手动代理"\)/);
assert.match(gui, /"Android SDK"/);
assert.match(gui, /"Python 3\.13"/);
assert.match(gui, /"桌面 Python"/);
assert.doesNotMatch(gui, /KeepWorkspace|自动补齐缺失工具|DownloadRetryCount|AutoInstall|Retries|BuildCache'\)/i);
assert.match(gui, /构建器只使用界面中确定的工具路径，缺失或版本错误立即失败/);

console.log("build-tool deterministic-path smoke passed");
