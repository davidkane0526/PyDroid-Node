import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const javaRoot = path.join(root, "android", "app", "src", "main", "java", "com", "dk", "pydroidflow");
const hostRoot = path.join(javaRoot, "host");
const pluginFile = path.join(javaRoot, "PythonExecutorPlugin.java");
const read = (file) => fs.readFileSync(file, "utf8");
const lines = (file) => read(file).split(/\r?\n/).length;
const plugin = read(pluginFile);

const requiredServices = [
  "AndroidHostServices.java",
  "AndroidSmbService.java",
  "AndroidProfileService.java",
  "AndroidFileService.java",
  "AndroidSecretService.java",
  "AndroidPythonService.java",
  "AndroidRemoteService.java",
];
for (const file of requiredServices) assert.ok(fs.existsSync(path.join(hostRoot, file)), `missing Android host service: ${file}`);

assert.ok(lines(pluginFile) <= 140, `PythonExecutorPlugin.java must remain a Capacitor binding facade (currently ${lines(pluginFile)} lines)`);
assert.doesNotMatch(plugin, /com\.chaquo\.python|jcifs\.|new\s+RemoteWorkflowServer|new\s+PythonExecutionController|DocumentsContract|FileOutputStream|Socket\s*\(/, "Capacitor plugin must not own host service implementations");
assert.match(plugin, /new AndroidHostServices\(getContext\(\)\)/, "plugin must compose Android host services in load()");
assert.match(plugin, /services\.close\(\)/, "plugin must release Android host services on destroy");

const expectedMethods = [
  "warmUp", "getEnvironment", "getRuntimeStats", "saveUserProfileFile", "exportTextFile", "saveAgentSecret", "loadAgentSecret",
  "saveSmbSecret", "loadSmbSecret", "getUserProfileInfo", "chooseWorkflowFolder", "openWorkflowFolder",
  "listWorkflowLibrary", "renameWorkflowFile", "deleteWorkflowFile", "analyzeNotebook", "analyzeSignature",
  "runWorkflow", "cancelWorkflow", "getExecutionStatus", "pickCsv", "listSmb", "scanSmbShares",
  "discoverSmbServers", "readSmbCsv", "startRemoteServer", "stopRemoteServer",
];
for (const method of expectedMethods) assert.match(plugin, new RegExp(`@PluginMethod\\s+public void ${method}\\(`), `Capacitor method contract must preserve ${method}`);
for (const callback of ["pickCsvResult", "openWorkflowFolderResult", "chooseWorkflowFolderResult", "exportTextFileResult"]) {
  assert.match(plugin, new RegExp(`@ActivityCallback\\s+private void ${callback}\\(`), `Activity callback must preserve ${callback}`);
}

const hostComposition = read(path.join(hostRoot, "AndroidHostServices.java"));
for (const service of ["AndroidSmbService", "AndroidProfileService", "AndroidFileService", "AndroidSecretService", "AndroidPythonService", "AndroidRemoteService"]) {
  assert.match(hostComposition, new RegExp(`new ${service}\\(`), `AndroidHostServices must own ${service}`);
}
assert.match(hostComposition, /PythonExecutionController/, "AndroidHostServices must own execution-controller lifetime");
assert.match(hostComposition, /remoteRequests\.shutdownNow\(\)/, "AndroidHostServices must release remote request workers");
assert.match(hostComposition, /worker\.shutdownNow\(\)/, "AndroidHostServices must release host worker");

const smb = read(path.join(hostRoot, "AndroidSmbService.java"));
const profile = read(path.join(hostRoot, "AndroidProfileService.java"));
const files = read(path.join(hostRoot, "AndroidFileService.java"));
const secrets = read(path.join(hostRoot, "AndroidSecretService.java"));
const python = read(path.join(hostRoot, "AndroidPythonService.java"));
const remote = read(path.join(hostRoot, "AndroidRemoteService.java"));
assert.match(smb, /jcifs\.smb\.client\.maxVersion/, "SMB service must own jcifs negotiation settings");
assert.match(smb, /discoverServers\(/, "SMB service must own LAN discovery");
assert.match(profile, /WORKFLOW_TREE_KEY/, "Profile service must own workflow-folder persistence");
assert.match(profile, /DocumentsContract\.renameDocument/, "Profile service must own workflow-library mutations");
assert.match(profile, /ACTION_CREATE_DOCUMENT/, "Profile service must export user-visible files through Android SAF");
assert.match(profile, /openOutputStream\(uri, "wt"\)/, "Android SAF export must write the selected destination URI");
assert.match(files, /ACTION_OPEN_DOCUMENT_TREE/, "File service must own SAF folder selection");
assert.match(files, /MAX_TOTAL_BYTES/, "File service must own file-size safety limits");
assert.match(secrets, /AgentSecretStore/, "Secret service must own keystore-backed secret access");
assert.match(python, /executionController\.submit/, "Python service must own workflow submission");
assert.match(python, /pydroid_flow\.engine/, "Python service must own Chaquopy engine access");
assert.match(remote, /RemoteWorkflowServer\.start/, "Remote service must own LAN server lifecycle");

for (const file of requiredServices) {
  const count = lines(path.join(hostRoot, file));
  assert.ok(count <= 240, `${file} grew beyond 240 lines (${count}); split the host domain again instead of recreating a monolith`);
}

console.log(`Android host architecture smoke passed (plugin ${lines(pluginFile)} lines; ${requiredServices.length} host services).`);
