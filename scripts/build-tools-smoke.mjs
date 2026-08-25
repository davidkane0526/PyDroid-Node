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
const setupDesktop = read("scripts/setup-desktop-development.ps1");
const startDesktop = read("scripts/start-desktop.ps1");
const desktopPackage = read("scripts/desktop-package.mjs");
const packageJson = JSON.parse(read("package.json"));
const gradleProperties = read("android/gradle.properties");
const gradleWrapperBat = read("android/gradlew.bat");
const gradleWrapper = read("android/gradlew");

assert.match(build, new RegExp(`BuildScriptRevision = "${packageJson.version.replaceAll(".", "\\.")}-`));
assert.match(build, /return "D:\\PyDroidTemp"/);
assert.match(build, /return "D:\\Code"/);
assert.match(nodeModule, /Join-Path \$ToolRoot 'NodeJs\\node\.exe'/);
assert.match(nodeModule, /Join-Path \$ToolRoot 'Language\\NodeJs\\node\.exe'/);
assert.match(nodeModule, /Join-Path \$env:LOCALAPPDATA 'pnpm\\bin\\pnpm\.cmd'/);
assert.match(nodeModule, /Join-Path \$env:APPDATA 'npm\\pnpm\.cmd'/);
assert.match(nodeModule, /foreach \(\$commandName in @\('node\.exe', 'node'\)\)/);
assert.match(nodeModule, /foreach \(\$commandName in @\('pnpm\.cmd', 'pnpm'\)\)/);

assert.match(javaModule, /Resolve-PyDroidJavaHome/);
assert.match(javaModule, /Join-Path \$ToolRoot 'Java'/);
assert.match(javaModule, /Join-Path \$ToolRoot 'Language\\Java'/);
assert.match(javaModule, /Get-PyDroidJavaHomesFromRegistry/);
assert.match(javaModule, /Get-Command \$commandName -All/);

assert.match(androidModule, /Join-Path \$env:LOCALAPPDATA 'Android\\Sdk'/);
assert.match(androidModule, /Join-Path \$ToolRoot 'Language\\Android'/);
assert.match(androidModule, /RequiredApi/);

assert.match(pythonModule, /Join-Path \$WorkRoot \("tools\\pydroid-flow\\Python\\\{0\}\\python\.exe"/);
assert.match(pythonModule, /Join-Path \$ToolRoot 'Language\\Python\\python\.exe'/);
assert.match(pythonModule, /Programs\\Python\\Python/);
assert.match(pythonModule, /Get-Command py\.exe/);
assert.match(pythonModule, /Get-Command python\.exe/);

for (const [name, source] of [
  ["Node", nodeModule], ["Java", javaModule], ["Android", androidModule], ["Python", pythonModule],
]) {
  assert.doesNotMatch(source, /Install-|Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|sdkmanager|Corepack|New-TemporaryAndroidSdkOverlay/i,
    `${name} discovery must remain read-only and must not install or repair tools`);
}
assert.match(build, /Resolve-PyDroidAndroidSdk -ConfiguredSdk \$AndroidSdkHome -ToolRoot \$ToolRoot -WorkRoot \$WorkRoot -RequiredApi \$resolvedAndroidApi/);
assert.match(build, /Resolve-PyDroidJavaHome -ConfiguredHome \$JavaHome -ToolRoot \$ToolRoot -RequiredMajor \$JdkMajor/);
assert.match(build, /Resolve-PyDroidPythonExecutable -ConfiguredExecutable \$PythonExecutable -WorkRoot \$WorkRoot -ToolRoot \$ToolRoot/);
assert.match(packagingModule, /System\.IO\.Directory/);
assert.match(packagingModule, /Delete\(\$deletePath, \$true\)/);
assert.doesNotMatch(packagingModule, /Remove-Item[^\n]*-Recurse|cmd\.exe|robocopy|fallback|retry/i);
assert.equal(existsSync(path.join(root, "tools/deferred-cleanup.ps1")), false, "deferred cleanup worker must be removed");

assert.match(network, /ValidateSet\('Direct','Manual'\)/);
assert.match(network, /PNPM_CONFIG_FETCH_RETRIES = '0'/);
assert.doesNotMatch(network, /Internet Settings|AutoConfigURL|Get-WindowsInternetProxy|Test-LocalProxyEndpoint|Get-ItemProperty/i);

assert.match(desktopPackage, /node_modules", "typescript", "bin", "tsc/);
assert.match(desktopPackage, /node_modules", "vite", "bin", "vite\.js/);
assert.match(desktopPackage, /node_modules", "electron-builder", "out", "cli", "cli\.js/);
assert.match(build, /使用已验证 Node 直接启动桌面打包/);
assert.match(build, /& \$script:NodeExecutable \$desktopPackageScript/);
assert.doesNotMatch(build, /Invoke-Pnpm @\(\"desktop:package\"\)/);
assert.match(desktopPackage, /\[desktop-package\] \$\{label\}/);
assert.doesNotMatch(desktopPackage, /packageManagerInvocation|npm_execpath|packageWithRetry|signExecutable=false|signAndEditExecutable=false|plain exe|compatibility fallback|retry/i);
assert.equal(existsSync(path.join(root, "scripts/desktop-package-invocation.mjs")), false, "package-manager launcher fallback must be removed");
assert.equal(existsSync(path.join(root, "scripts/local-storage.ps1")), false, "junction-based local-storage shim must be removed");
assert.equal(existsSync(path.join(root, "scripts/fix-capacitor-paths.ps1")), false, "junction path rewrite shim must be removed");
assert.equal(packageJson.scripts["android:sync"], "pnpm build && cap sync android");
assert.match(gradleProperties, /org\.gradle\.daemon=false/);
assert.doesNotMatch(gradleProperties, /org\.gradle\.jvmargs/);
assert.match(gradleWrapperBat, /DEFAULT_JVM_OPTS="-Xms64m" "-Xmx1536m"/);
assert.match(gradleWrapper, /DEFAULT_JVM_OPTS='"-Xms64m" "-Xmx1536m"'/);
assert.doesNotMatch(build, /DisableGradleDaemon|PYDROID_DISABLE_GRADLE_DAEMON/);
assert.match(androidPackage, /& "\.\\gradlew\.bat" @gradleArgs/);
assert.match(androidPackage, /\$gradleArgs = @\("assembleDebug", "--stacktrace", "--no-daemon", "--console=plain"\)/);
assert.doesNotMatch(androidPackage, /--daemon|PYDROID_DISABLE_GRADLE_DAEMON|disableGradleDaemon/);
assert.match(androidPackage, /Resolve-PyDroidJavaHome/);
assert.match(androidPackage, /Resolve-PyDroidAndroidSdk/);
assert.match(androidPackage, /Resolve-PyDroidPythonExecutable/);
assert.doesNotMatch(androidPackage, /gradlew\.bat --stop|Clear-PyDroidGradleDaemonState|Kill\(|BUILD SUCCESSFUL.*APK|Install-|retry|fallback|recovery/i);
assert.match(setupDesktop, /Resolve-PyDroidPnpmExecutable/);
assert.match(startDesktop, /Resolve-PyDroidPnpmExecutable/);
assert.doesNotMatch(setupDesktop, /Join-Path \$env:LOCALAPPDATA "pnpm\bin\pnpm\.cmd"/);
assert.doesNotMatch(startDesktop, /Join-Path \$env:LOCALAPPDATA "pnpm\bin\pnpm\.cmd"/);

assert.match(gui, /@\("直连", "手动代理"\)/);
assert.match(gui, /"Android SDK"/);
assert.match(gui, /"Python 3\.13"/);
assert.match(gui, /"桌面 Python"/);
assert.match(gui, /storedSdk -ieq 'D:\\Code\\Android\\Sdk'/,
  "GUI must clear the stale generated Android SDK path so auto-discovery can run");
assert.match(gui, /留空自动发现本机 JDK 21/);
assert.match(gui, /留空自动发现本机 Android SDK/);
assert.match(gui, /留空自动发现完整 64 位 Python 3\.13/);
assert.doesNotMatch(gui, /KeepWorkspace|自动补齐缺失工具|DownloadRetryCount|AutoInstall|Retries|BuildCache'\)/i);
assert.match(gui, /工具路径留空时自动发现本机现有安装，显式填写时严格使用指定路径/);

console.log("build-tool local-discovery policy smoke passed");
