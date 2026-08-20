import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const lines = (file) => read(file).split(/\r?\n/).length;
const pkg = JSON.parse(read("package.json"));
const main = read("desktop/main.cjs");
const ipcRegister = read("desktop/ipc/register.cjs");
const runtimeIpc = read("desktop/ipc/runtime-ipc.cjs");
const remoteIpc = read("desktop/ipc/remote-ipc.cjs");
const smbIpc = read("desktop/ipc/smb-ipc.cjs");
const fileIpc = read("desktop/ipc/file-ipc.cjs");
const python = read("desktop/services/python-service.cjs");
const remote = read("desktop/services/remote-server.cjs");
const smb = read("desktop/services/smb-service.cjs");
const secrets = read("desktop/services/secret-service.cjs");
const profile = read("desktop/services/profile-service.cjs");
const windowHost = read("desktop/window/create-window.cjs");
const desktopRendererExecution = read("desktop/renderer/execution.ts");
const ipc = [ipcRegister, runtimeIpc, remoteIpc, smbIpc, fileIpc].join("\n");

assert.ok(lines("desktop/main.cjs") <= 90, `desktop/main.cjs must remain a composition root (currently ${lines("desktop/main.cjs")} lines)`);
assert.doesNotMatch(main, /ipcMain\.(handle|on)\(/, "desktop/main.cjs must not own IPC registrations");
assert.doesNotMatch(main, /createServer\(|powershell\.exe|net use|safeStorage/, "desktop/main.cjs must not contain service implementations");
assert.match(main, /createPythonWorkflowService/, "composition root must create the Python workflow service");
assert.match(main, /createRemoteServerService/, "composition root must create the Remote Web service");
assert.match(main, /createDesktopSecretStore/, "composition root must create the secret service");
assert.match(main, /registerDesktopIpc/, "composition root must register IPC through the IPC composition module");
assert.match(ipcRegister, /registerRuntimeIpc/, "IPC composition must register runtime handlers");
assert.match(ipcRegister, /registerSmbIpc/, "IPC composition must register SMB handlers");
assert.match(ipcRegister, /registerFileIpc/, "IPC composition must register file handlers");
assert.match(ipcRegister, /registerRemoteIpc/, "IPC composition must register remote handlers");
assert.match(main, /createDesktopWindow/, "composition root must create windows through the window host module");

for (const channel of [
  "pydroid:run-workflow", "pydroid:cancel-workflow", "pydroid:get-execution-status",
  "pydroid:get-environment", "pydroid:analyze-notebook", "pydroid:analyze-signature",
  "pydroid:start-remote-server", "pydroid:stop-remote-server",
  "pydroid:discover-smb-servers", "pydroid:scan-smb-shares", "pydroid:list-smb", "pydroid:read-smb",
  "pydroid:save-smb-secret", "pydroid:load-smb-secret", "pydroid:pick-csv",
]) assert.ok(ipc.includes(channel), `desktop IPC registry must preserve ${channel}`);

assert.match(python, /PythonProcessController/, "Python host service must own process lifecycle");
assert.match(python, /WorkflowExecutionScheduler/, "Python host service must own multi-workspace scheduling");
assert.match(remote, /\/api\/execute/, "Remote service must own execute HTTP API");
assert.match(remote, /\/api\/cancel/, "Remote service must own cancel HTTP API");
assert.match(remote, /LanDiscoveryService/, "Remote service must own LAN discovery lifecycle");
assert.match(smb, /discoverSmbServers/, "SMB service must own LAN SMB discovery");
assert.match(smb, /shutdownSmbSessions/, "SMB service must own Windows session cleanup");
assert.match(secrets, /safeStorage/, "Secret service must own encrypted safeStorage access");
assert.match(profile, /ensureUserProfile/, "Profile module must own user profile directory initialization");
assert.match(windowHost, /new BrowserWindow/, "Window host must own BrowserWindow construction");
assert.ok(pkg.build.files.includes("desktop/services/**/*"), "Packaged desktop must include desktop service modules");
assert.ok(pkg.build.files.includes("desktop/ipc/**/*"), "Packaged desktop must include desktop IPC modules");
assert.ok(pkg.build.files.includes("desktop/window/**/*"), "Packaged desktop must include desktop window modules");


assert.match(desktopRendererExecution, /getWorkspaceVariableState/, "desktop renderer must preserve Phase 8 workspace state between runs");
assert.match(desktopRendererExecution, /setWorkspaceVariableState/, "desktop renderer must persist returned Phase 8 workspace state");
assert.match(desktopRendererExecution, /collectReachableFunctionNodes/, "desktop auto runtime selection must inspect reusable function bodies");
assert.match(desktopRendererExecution, /serializeWorkflow\("Windows 桌面流程"[\s\S]*functions/, "desktop Python bridge must serialize reusable function definitions");

console.log("Desktop host architecture smoke test passed");
