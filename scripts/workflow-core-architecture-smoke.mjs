import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8");
const workflow = readFileSync(fileURLToPath(new URL("../src/workflow.ts", import.meta.url)), "utf8");
const history = readFileSync(fileURLToPath(new URL("../src/workflow-core/history.ts", import.meta.url)), "utf8");
const session = readFileSync(fileURLToPath(new URL("../src/workflow-core/session.ts", import.meta.url)), "utf8");
const persistence = readFileSync(fileURLToPath(new URL("../src/workflow-core/persistence.ts", import.meta.url)), "utf8");
const commands = readFileSync(fileURLToPath(new URL("../src/workflow-core/commands.ts", import.meta.url)), "utf8");


const remoteBrowserDeclaration = app.indexOf("const remoteBrowser = isRemoteRuntime();");
const remotePairState = app.indexOf("const [remotePaired, setRemotePaired]");
const hostPolling = app.indexOf("const refresh = async () =>", remotePairState);
assert.ok(remoteBrowserDeclaration >= 0, "FlowEditor should declare remoteBrowser");
assert.ok(remotePairState > remoteBrowserDeclaration, "remote pairing state should be declared after runtime detection");
assert.ok(hostPolling > remotePairState, "host execution polling should run after remote pairing state exists");
assert.match(app.slice(remotePairState, hostPolling + 900), /remoteBrowser && !remotePaired/, "remote browser should poll host state immediately after pairing instead of waiting for UI interaction");

assert.match(app, /session={sessionStoreRef\.current\.ensure/, "FlowEditor should consume the Editor Core session owner");
assert.match(app, /new EditorSessionStore\(/, "App should delegate per-tab runtime/view state to EditorSessionStore");
assert.doesNotMatch(app, /const historyRef\s*=\s*useRef/, "App should not recreate the legacy history-array owner");
assert.match(app, /writeStorage\(localStorage/, "autosave should use the guarded Workflow Core persistence wrapper");
assert.match(app, /upstreamSubgraph\(/, "interactive alert preflight should reuse Workflow Core graph slicing");
assert.match(workflow, /migrateWorkflowDocument/, "workflow parsing should pass through migration infrastructure");
assert.match(workflow, /validateWorkflowDocument/, "workflow parsing should pass through structural validation");
assert.match(history, /class WorkflowHistory/, "Workflow Core should own history behavior");
assert.match(session, /class WorkspaceSessionStore/, "Workflow Core should own workspace dirty-state sessions");
assert.match(session, /histories = new Map/, "WorkspaceSessionStore should retain independent undo\/redo history across tab switches");
assert.match(app, /const initialRuntimeState = session\.getRuntimeState\(\)/, "workspace input selections should be restored through Editor Core sessions");
assert.doesNotMatch(app, /pydroid-flow\.tabs\.v1/, "session-only tabs should not leave dead localStorage persistence behind");
assert.match(persistence, /QuotaExceededError/, "Workflow Core persistence should classify storage quota failures");
assert.match(commands, /function upstreamSubgraph/, "Workflow Core should expose reusable graph slicing commands");
assert.match(commands, /function deleteNodesFromGraph/, "Workflow Core should own graph deletion semantics instead of App.tsx");
assert.match(commands, /function disconnectNodesFromGraph/, "Workflow Core should own graph disconnection semantics instead of App.tsx");

console.log("workflow-core architecture smoke passed");
