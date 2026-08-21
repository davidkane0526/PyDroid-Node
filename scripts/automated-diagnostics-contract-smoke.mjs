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

// Phase 11 strengthens existing cases rather than adding new user-visible diagnostic labels.
assert.match(source, /compatibility:\s*\{\s*schemaFromVersion:\s*migrated\.report\.schemaFromVersion/, "workspace persistence diagnostics must embed migrated-workflow runtime coverage");
assert.match(source, /futureAutosavePreserved:\s*true/, "document lifecycle diagnostics must embed future-version preservation coverage");
assert.match(source, /futureResourcePreserved:\s*true/, "resource persistence diagnostics must embed future-resource preservation coverage");
assert.doesNotMatch(source, /workflow-compatibility-migration|workflow-compatibility-runtime-/, "Phase 11 must not add new user-visible diagnostic cases without UI approval");
assert.match(docs, /22\s*\/\s*22|22\s*项/, "diagnostics documentation must describe the 22-case full-host contract");

const fullHostTotal = expectedCases.length + 4;
assert.equal(fullHostTotal, 22, "full-host automated diagnostic contract must contain 22 cases");
assert.doesNotMatch(source, /LAN_EXTERNAL_BOUNDARY_UNVERIFIED/, "diagnostics must not turn optional Windows boundary inspection into a production-host failure gate");
assert.match(source, /externalClientObserved === false[\s\S]*status: "skip"/, "host diagnostics must not claim external LAN reachability until a real peer has been observed");
console.log(`Automated diagnostics contract smoke passed (${fullHostTotal} full-host cases, Phase 11 coverage embedded without new UI cases).`);
