import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const app = read("src/App.tsx");
const commands = read("src/editor-core/commands.ts");
const runtimeInteraction = read("src/editor-core/runtime-interaction.ts");
const reactAdapter = read("src/editor-core/react.ts");
const lifecycle = read("src/editor-core/lifecycle.ts");

const appLines = app.split(/\r?\n/).length;
assert.ok(appLines < 4300, `Phase 9 freeze audit: App.tsx still exceeds the ownership guard (${appLines} lines)`);

for (const legacy of [
  "PACKAGE_REQUIREMENTS_KEY",
  "loadPackageRequirements",
  "setRequirements(",
  "setNodes(nextNodes)",
  "session.updateSnapshot(",
]) assert.ok(!app.includes(legacy), `Phase 9 freeze audit: legacy business mutation remains in App.tsx: ${legacy}`);

assert.match(app, /applyRuntimeNodeParameterOverride\(context\.nodes, inputDialogNode\.id/, "input dialog runtime response must be execution-only");
assert.match(app, /applyRuntimeNodeParameterOverride\(context\.nodes, alertDialogNode\.id/, "alert runtime response must be execution-only");
assert.match(commands, /type: "upsert-requirement"/, "workflow dependency add/update must be an Editor Command");
assert.match(commands, /type: "remove-requirement"/, "workflow dependency remove must be an Editor Command");
assert.match(app, /session\.applyGraphCommand\(\{ type: "upsert-requirement"/, "package manager must mutate requirements through Session commands");
assert.match(app, /session\.applyGraphCommand\(\{ type: "remove-requirement"/, "package manager removal must mutate requirements through Session commands");
assert.match(runtimeInteraction, /applyRuntimeNodeParameterOverride/, "runtime interaction override helper is missing");
assert.match(reactAdapter, /session\.updateSnapshot/, "React Flow adapter must stream presentation changes into Session, not own a second graph");
assert.match(lifecycle, /class EditorWorkspaceLifecycleService/, "document lifecycle must remain behind the lifecycle service");

// Direct setNodes/setEdges calls are allowed only for transient presentation state.
// Persistent workflow fields must go through Editor Commands/Session transactions.
function callBodies(source, callee) {
  const result = [];
  const token = `${callee}(`;
  let cursor = 0;
  while ((cursor = source.indexOf(token, cursor)) >= 0) {
    const start = cursor + token.length;
    let depth = 1;
    let index = start;
    let quote = null;
    let escaped = false;
    for (; index < source.length && depth > 0; index += 1) {
      const ch = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    result.push(source.slice(start, Math.max(start, index - 1)));
    cursor = Math.max(index, cursor + token.length);
  }
  return result;
}

const directSetNodeCalls = callBodies(app, "setNodes");
const persistentNodeTokens = ["parameters:", "nodeType:", "label:", "tags:", "canvasParentId:", "parentId:", "position:"];
for (const call of directSetNodeCalls) {
  for (const token of persistentNodeTokens) {
    assert.ok(!call.includes(token), `Phase 9 freeze audit: direct setNodes persistent mutation (${token}) found`);
  }
}
const directSetEdgeCalls = callBodies(app, "setEdges");
for (const call of directSetEdgeCalls) {
  assert.ok(call.includes("selected"), "Phase 9 freeze audit: direct setEdges business mutation found");
}

console.log(`phase9 freeze audit passed (App.tsx ${appLines} lines; ${directSetNodeCalls.length} direct node writes are presentation-only)`);
