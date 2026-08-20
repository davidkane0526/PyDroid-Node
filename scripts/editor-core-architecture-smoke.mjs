import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const session = readFileSync(path.join(root, "src/editor-core/session.ts"), "utf8");
const commands = readFileSync(path.join(root, "src/editor-core/commands.ts"), "utf8");
const reactAdapter = readFileSync(path.join(root, "src/editor-core/react.ts"), "utf8");
const gestures = readFileSync(path.join(root, "src/editor-core/gesture-policy.ts"), "utf8");
const diagnostics = readFileSync(path.join(root, "src/diagnostics/automated-debug.ts"), "utf8");

assert.match(app, /new EditorSessionStore\("default"/, "multi-tab shell should be owned by EditorSessionStore");
assert.doesNotMatch(app, /new WorkspaceSessionStore\(/, "App.tsx must not own the legacy Workflow Core session store");
assert.doesNotMatch(app, /useNodesState|useEdgesState/, "App.tsx must not own a second graph-state copy beside EditorWorkspaceSession");
assert.match(app, /useEditorWorkspaceSession\(session\)/, "FlowEditor should subscribe to the session-backed React adapter");
assert.match(reactAdapter, /useSyncExternalStore\(session\.subscribe, session\.getState/, "React should render EditorWorkspaceSession as the graph source of truth");
assert.match(reactAdapter, /session\.updateSnapshot/, "graph setters should write directly into EditorWorkspaceSession");
assert.match(reactAdapter, /session\.patchViewState/, "selection/canvas setters should write directly into EditorWorkspaceSession");
assert.doesNotMatch(app, /const \[selectedId, setSelectedId\]|const \[selectedIds, setSelectedIds\]|const \[selectionMode, setSelectionMode\]|const \[currentCanvasId, setCurrentCanvasId\]/, "FlowEditor view state must not keep a second React useState mirror beside EditorWorkspaceSession");
assert.match(app, /useRef\(session\.history\)/, "undo/redo history must be owned by the workspace session");
assert.match(session, /class EditorWorkspaceSession/, "Editor Core should own one explicit workspace session object");
assert.match(session, /class EditorSessionStore/, "Editor Core should own the tab-to-session registry");
assert.match(session, /selectedNodeIds/, "selection state should cross the session boundary rather than reset on every tab switch");
assert.match(commands, /type EditorGraphCommand/, "Editor Core should expose a command boundary");
assert.match(app, /session\.applyGraphCommand\(/, "common graph edits should route through the session-owned Editor Command boundary");
assert.match(session, /applyGraphCommand\(command: EditorGraphCommand\)/, "EditorWorkspaceSession should own command application and history capture");
assert.match(gestures, /type EditorInputProfile = "desktop" \| "mobile"/, "gesture interpretation must distinguish desktop and mobile profiles");
assert.match(gestures, /type GestureTargetKind = "node" \| "group" \| "canvas" \| "resource" \| "tab"/, "gesture interpretation must distinguish target kinds");
assert.match(gestures, /mobile:[\s\S]*MOBILE|const PROFILES/, "gesture policy should remain profile-driven");
assert.match(app, /gestureTargetForNodeType/, "node/group pointer handling should route through Gesture Policy");
assert.match(app, /resolveGesturePolicy\("mobile", targetKind\)/, "mobile node/group holds should be resolved by target policy");
assert.match(diagnostics, /editor-session-isolation/, "one-click diagnostics should cover editor-session isolation");
assert.match(diagnostics, /editor-gesture-contract/, "one-click diagnostics should report the gesture policy contract");

console.log("editor-core architecture smoke passed");
