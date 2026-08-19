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
const remoteBrowserPollingUse = app.indexOf("if (remoteBrowser) return;");
assert.ok(remoteBrowserDeclaration >= 0, "FlowEditor should declare remoteBrowser");
assert.ok(remoteBrowserPollingUse >= 0, "FlowEditor should use remoteBrowser in host execution polling");
assert.ok(
  remoteBrowserDeclaration < remoteBrowserPollingUse,
  "remoteBrowser must be declared before the host execution polling hook uses it",
);

assert.match(app, /new WorkflowHistory\(50\)/, "App should delegate undo/redo storage to WorkflowHistory");
assert.match(app, /new WorkspaceSessionStore\(/, "App should delegate per-tab runtime state to WorkspaceSessionStore");
assert.doesNotMatch(app, /const historyRef\s*=\s*useRef/, "App should not recreate the legacy history-array owner");
assert.match(app, /writeStorage\(localStorage/, "autosave should use the guarded Workflow Core persistence wrapper");
assert.match(app, /upstreamSubgraph\(/, "interactive alert preflight should reuse Workflow Core graph slicing");
assert.match(workflow, /migrateWorkflowDocument/, "workflow parsing should pass through migration infrastructure");
assert.match(workflow, /validateWorkflowDocument/, "workflow parsing should pass through structural validation");
assert.match(history, /class WorkflowHistory/, "Workflow Core should own history behavior");
assert.match(session, /class WorkspaceSessionStore/, "Workflow Core should own workspace dirty-state sessions");
assert.match(persistence, /QuotaExceededError/, "Workflow Core persistence should classify storage quota failures");
assert.match(commands, /function upstreamSubgraph/, "Workflow Core should expose reusable graph slicing commands");

console.log("workflow-core architecture smoke passed");
