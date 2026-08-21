import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PHASE11_BASE = "64f7c98"; // 1.4.76 accepted baseline.
const root = process.cwd();

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const changed = [...new Set([
  ...git(["diff", "--name-only", PHASE11_BASE]).split(/\r?\n/).filter(Boolean),
  ...git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean),
])];
const frozenNetworkFiles = new Set([
  "desktop/ipc/remote-ipc.cjs",
  "desktop/lan/LanDiscoveryService.cjs",
  "desktop/lan/firewall.cjs",
  "desktop/lan/identity.cjs",
  "desktop/lan/mdns.cjs",
  "desktop/lan/network.cjs",
  "desktop/lan/ssdp.cjs",
  "desktop/lan/upnp.cjs",
  "desktop/services/remote-security.cjs",
  "desktop/services/remote-server.cjs",
  "android/app/src/main/java/com/dk/pydroidflow/LanDeviceIdentity.java",
  "android/app/src/main/java/com/dk/pydroidflow/LanDiscoveryService.java",
  "android/app/src/main/java/com/dk/pydroidflow/LanNetworkInterfaceManager.java",
  "android/app/src/main/java/com/dk/pydroidflow/MdnsService.java",
  "android/app/src/main/java/com/dk/pydroidflow/RemoteAccessGuard.java",
  "android/app/src/main/java/com/dk/pydroidflow/RemoteWorkflowServer.java",
  "android/app/src/main/java/com/dk/pydroidflow/SsdpService.java",
  "android/app/src/main/java/com/dk/pydroidflow/host/AndroidRemoteService.java",
]);
const networkChanges = changed.filter((file) => frozenNetworkFiles.has(file));
const approvedFinalBoundaryHotfix = new Set(["desktop/lan/firewall.cjs", "desktop/services/remote-server.cjs"]);
const unauthorizedNetworkChanges = networkChanges.filter((file) => !approvedFinalBoundaryHotfix.has(file));
if (unauthorizedNetworkChanges.length) throw new Error(`Phase 11 modified frozen Remote/LAN files outside the evidence-backed final boundary hotfix:\n${unauthorizedNetworkChanges.join("\n")}`);

const appDiff = git(["diff", "-U0", PHASE11_BASE, "--", "src/App.tsx"]);
const addedAppLines = appDiff.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++"));
const newMessages = addedAppLines.filter((line) => /\bsetMessage\s*\(/.test(line));
if (newMessages.length) throw new Error(`Phase 11 added unapproved App UI message calls:\n${newMessages.join("\n")}`);

const app = readFileSync("src/App.tsx", "utf8");
if (/register(?:Workflow|Node)Migration\s*\(/.test(app)) throw new Error("App.tsx must not own compatibility migration registration");
if (!app.includes("resourceLibraryState.groups.filter(isEditorResourceUsable)")) throw new Error("Future/invalid groups are not filtered from interactive UI");
if (!app.includes("resourceLibraryState.savedNodes.filter(isEditorResourceUsable)")) throw new Error("Future/invalid saved nodes are not filtered from interactive UI");
if (!app.includes("resourceLibraryState.flows.filter(isEditorResourceUsable)")) throw new Error("Future/invalid flows are not filtered from interactive UI");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const compatScript = packageJson.scripts?.["test:workflow-compatibility"] ?? "";
for (const required of ["workflow-history-corpus-audit.mjs", "workflow-compatibility-smoke.mjs", "workflow-compatibility-typecheck-smoke.mjs", "phase11-freeze-audit.mjs"]) {
  if (!compatScript.includes(required)) throw new Error(`test:workflow-compatibility is missing ${required}`);
}

const schema = readFileSync("src/workflow-core/schema-migrations.ts", "utf8");
if (!/CURRENT_WORKFLOW_SCHEMA_VERSION\s*=\s*3\b/.test(schema)) throw new Error("Phase 11 must freeze Workflow schema v3");
const resourceMigration = readFileSync("src/editor-core/resource-migrations.ts", "utf8");
if (!/EDITOR_RESOURCE_SCHEMA_VERSION\s*=\s*2\b/.test(resourceMigration)) throw new Error("Phase 11 must freeze Editor resource schema v2");

console.log(`Phase 11 freeze audit passed (${changed.length} changed paths; Remote/LAN frozen except the evidence-backed desktop boundary hotfix; no new App UI messages).`);
