import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const nodeView = readFileSync(path.join(root, "src/nodes/WorkflowNodeView.tsx"), "utf8");
const session = readFileSync(path.join(root, "src/editor-core/session.ts"), "utf8");
const resourceLibrary = readFileSync(path.join(root, "src/editor-core/resource-library.ts"), "utf8");
const agentOperations = readFileSync(path.join(root, "src/editor-core/agent-operations.ts"), "utf8");
const sharedExecution = readFileSync(path.join(root, "src/execution.ts"), "utf8");
const desktopExecution = readFileSync(path.join(root, "desktop/renderer/execution.ts"), "utf8");

const appLines = app.split(/\r?\n/).length;
assert.ok(appLines < 4300, `App.tsx still owns too much Phase 9 business logic (${appLines} lines)`);
const nodeViewLines = nodeView.split(/\r?\n/).length;
assert.ok(nodeViewLines < 360, `WorkflowNodeView.tsx is becoming another UI monolith (${nodeViewLines} lines)`);
assert.ok(!app.includes("function WorkflowNodeCard") && !app.includes("function InlineNodeControl"), "App.tsx must not reclaim node-view rendering ownership");
assert.match(app, /from "\.\/nodes\/WorkflowNodeView"/, "App.tsx should consume the extracted node-view boundary");

for (const key of [
  "pydroid-flow.workflow-library.v1",
  "pydroid-flow.group-library.v1",
  "pydroid-flow.saved-node-library.v1",
]) assert.ok(!app.includes(key), `App.tsx still owns resource persistence key ${key}`);

for (const legacy of ["setFlowLibrary", "setGroupLibrary", "setSavedNodeLibrary", "let draftNodes =", "let draftEdges ="]) {
  assert.ok(!app.includes(legacy), `App.tsx still contains legacy ownership pattern: ${legacy}`);
}

for (const rawExecution of ["getExecutionStatus(tabId)", "cancelActiveExecution(tabId)", "subscribeExecutionStatus(tab.id"]) {
  assert.ok(!app.includes(rawExecution), `App.tsx still addresses execution by raw tab id: ${rawExecution}`);
}

assert.match(app, /useSyncExternalStore\(resourceLibrary\.subscribe, resourceLibrary\.getState/, "resource library must be an observable service source of truth");
assert.match(app, /session\.identity/, "FlowEditor must consume identity owned by EditorWorkspaceSession");
assert.match(session, /readonly identity: WorkspaceSessionIdentity/, "EditorWorkspaceSession must own a stable identity");
assert.match(resourceLibrary, /class EditorResourceLibraryService/, "resource persistence must live behind EditorResourceLibraryService");
assert.match(agentOperations, /session\.applyGraphCommandBatch/, "AI graph surgery must commit through Session batch commands");
assert.match(sharedExecution, /executionManager\.execute\(identity\.key/, "shared execution manager must be keyed by full identity");
assert.match(desktopExecution, /executionManager\.execute\(identity\.key/, "desktop execution manager must be keyed by full identity");

console.log(`phase9 ownership audit passed (App.tsx ${appLines} lines; WorkflowNodeView.tsx ${nodeViewLines} lines)`);
