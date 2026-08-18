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
  /\[string\]\$JavaHome/,
  "build script should accept an explicit JavaHome path from the GUI/CLI",
);
assert.match(
  buildScript,
  /function Resolve-JavaHomeCandidate/,
  "manual JDK paths should be normalized through one resolver",
);
assert.match(
  buildScript,
  /\^\(java\|javac\)\\\.exe\$/,
  "manual JDK selection should accept java.exe or javac.exe paths",
);
assert.match(
  buildScript,
  /\(Split-Path \$candidate -Leaf\) -ieq 'bin'/,
  "manual JDK selection should accept a JDK bin directory",
);
assert.match(
  buildScript,
  /Find-JavaHomeInRoot -RootPath \$explicitRoot -MaxDepth 2/,
  "manual JDK path should accept a Java container directory and search nested JDK folders",
);
assert.match(
  buildScript,
  /Join-Path \$resolved 'bin\\java\.exe'/,
  "JDK validation should require bin/java.exe",
);
assert.match(
  buildScript,
  /Join-Path \$resolved 'bin\\javac\.exe'/,
  "JDK validation should require bin/javac.exe",
);
assert.match(
  buildScript,
  /foreach \(\$name in @\('java', 'javac'\)\)/,
  "JDK discovery should query both where java and where javac",
);
assert.match(
  buildScript,
  /Invoke-JavaVersionProbe/,
  "JDK version probing should isolate native stdout and stderr for Windows PowerShell 5.1",
);
assert.match(
  buildScript,
  /脚本不会在你手动指定 Java 后擅自下载另一个 JDK/,
  "an invalid manually-selected JDK path must fail instead of silently downloading another JDK",
);

assert.match(
  buildScript,
  /PYDROID_DISABLE_GRADLE_DAEMON/,
  "core build script should pass the Gradle daemon selection to android-package.ps1 without regex-rewriting its commands",
);
assert.match(
  buildScript,
  /org\.gradle\.jvmargs=\$effectiveJvmArgs/,
  "Gradle client and build JVM arguments should be synchronized for daemon/no-daemon compatibility",
);
assert.match(
  buildScript,
  /org\.gradle\.java\.home=\$gradleJavaHome/,
  "Gradle daemon JVM should be pinned to the validated JAVA_HOME",
);
assert.match(
  buildScript,
  /org\.gradle\.daemon\.idletimeout=600000/,
  "PyDroid Gradle daemons should have a bounded idle lifetime",
);
assert.match(
  buildScript,
  /Join-Path \(Join-Path \$CacheRoot "gradle"\) \$projectKey/,
  "Gradle user home should be isolated per project to avoid stale daemon collisions",
);
assert.match(
  buildScript,
  /ProjectPropertiesPath/,
  "Gradle network setup should patch the temporary project gradle.properties",
);

assert.match(
  buildScript,
  /function Test-PythonSeries/,
  "Android build Python candidates should be version-validated before use",
);
assert.match(
  buildScript,
  /Python\\runtime-3\.13\\python\.exe/,
  "Android should reuse the shared validated Python 3.13 desktop runtime when available",
);
assert.match(
  buildScript,
  /忽略 PYDROID_PYTHON_EXECUTABLE=.*Android 需要 Python/,
  "a stale PYDROID_PYTHON_EXECUTABLE must not be accepted only because its file exists",
);
assert.match(
  buildScript,
  /预检 Android Python 3\.13/,
  "Android Python compatibility should be checked before expensive packaging",
);

const androidPackagePath = fileURLToPath(new URL("../scripts/android-package.ps1", import.meta.url));
const androidPackage = readFileSync(androidPackagePath, "utf8");
assert.match(
  androidPackage,
  /PYDROID_DISABLE_GRADLE_DAEMON/,
  "Android packaging should honor the explicit Gradle daemon mode from the core build script",
);
assert.match(
  androidPackage,
  /automatic recovery enabled/,
  "Android packaging should enable daemon mode with automatic recovery by default",
);
assert.match(
  androidPackage,
  /Gradle daemon failed to start/,
  "Android packaging should detect daemon startup failures and recover automatically",
);
assert.match(
  androidPackage,
  /gradlew\.bat --stop/,
  "Android packaging should stop stale PyDroid daemons before daemon recovery",
);
assert.match(
  androidPackage,
  /Falling back to --no-daemon/,
  "Android packaging should fall back to no-daemon mode if daemon recovery still fails",
);

assert.match(
  androidPackage,
  /sys\.version_info\[:2\] == \(3, 13\)/,
  "android-package.ps1 should reject an incorrect PYDROID_PYTHON_EXECUTABLE before Gradle starts",
);

const buildGuiPath = fileURLToPath(new URL("../tools/build-pydroid-gui.ps1", import.meta.url));
const buildGui = readFileSync(buildGuiPath, "utf8");
assert.match(buildGui, /ProgressBar/, "build GUI should expose a stage progress bar");
assert.match(buildGui, /\^@@PYDROID_STAGE@@/, "build GUI should consume stage events");
assert.match(buildGui, /"JDK 目录"/, "build GUI should expose an editable JDK directory field");
assert.match(buildGui, /@\("-JavaHome", \$jdkHome\)/, "build GUI should pass the selected JDK directory to the core build script");
assert.match(buildGui, /JdkHome = \$jdkHome/, "build GUI should persist the selected JDK directory");
assert.doesNotMatch(buildGui, /finishedProcess\.WaitForExit\(\)/, "build GUI must not block the UI thread waiting for daemon-held pipes after process exit");
assert.match(buildGui, /Show-BuildMessage/, "build completion/failure dialogs should be owned by the GUI window");
assert.match(buildGui, /Stop-CurrentBuildSession/, "build GUI should have one cleanup path for cancel and close");
assert.match(buildGui, /taskkill\.exe \/PID \$script:buildProcess\.Id \/T \/F/, "closing/cancelling should terminate the build process tree");
assert.match(buildGui, /gradlew\.bat/, "GUI cleanup should explicitly stop the PyDroid Gradle daemon");
assert.match(buildGui, /--stop/, "GUI cleanup should run gradlew --stop for detached Gradle daemon processes");
assert.match(buildGui, /Add_FormClosing/, "GUI close should always run build-session cleanup");


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
