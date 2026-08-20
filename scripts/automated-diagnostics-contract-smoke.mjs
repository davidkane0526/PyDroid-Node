import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = readFileSync(path.join(root, "src/diagnostics/automated-debug.ts"), "utf8");
const docs = readFileSync(path.join(root, "docs/automated-diagnostics.md"), "utf8");

const expectedCases = [
  "editorSessionIsolationCase",
  "editorCommandTransactionCase",
  "editorNodeMutationCase",
  "editorConnectionAndMetadataCase",
  "editorDragHistoryCase",
  "editorLifecycleAutosaveCase",
  "editorDocumentLifecycleCase",
  "resourceContractCase",
  "resourceLibraryPersistenceCase",
  "workspaceSessionIdentityCase",
  "executionSessionLifecycleCase",
  "agentEditorBatchCase",
  "editorRequirementOwnershipCase",
  "runtimeInteractionIsolationCase",
  "remoteHostE2ECase",
  "remoteSecurityPolicyCase",
  "remoteAgentProxyBoundaryCase",
  "gestureContractCase",
];

const runner = source.slice(source.indexOf("export async function runAutomatedDiagnostics"));
assert.ok(runner, "runAutomatedDiagnostics must exist");
for (const caseName of expectedCases) {
  assert.match(runner, new RegExp(`cases\\.push\\(await\\s+${caseName}\\(`), `${caseName} must remain in the automated diagnostic runner`);
}
assert.match(runner, /workspacePersistenceCase\("javascript", deps\)/, "JavaScript workspace persistence diagnostic must remain enabled");
assert.match(runner, /reusableFunctionCase\("javascript", deps\)/, "JavaScript reusable-function diagnostic must remain enabled");
assert.match(runner, /workspacePersistenceCase\("python", deps\)/, "Python workspace persistence diagnostic must remain enabled for capable hosts");
assert.match(runner, /reusableFunctionCase\("python", deps\)/, "Python reusable-function diagnostic must remain enabled for capable hosts");
assert.match(runner, /platformId === "browser" && !deps\.remote/, "plain-browser Python diagnostics must remain explicitly skippable");
assert.match(docs, /22\s*\/\s*22|22\s*项/, "diagnostics documentation must describe the 22-case Phase 10 host contract");

const fullHostTotal = expectedCases.length + 4;
assert.equal(fullHostTotal, 22, "Phase 10 full-host automated diagnostic contract must contain 22 cases");
console.log(`Automated diagnostics contract smoke passed (${fullHostTotal} full-host cases).`);
