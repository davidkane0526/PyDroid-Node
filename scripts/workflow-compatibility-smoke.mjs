import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pydroid-phase11-migrations-"));
const cleanup = () => fs.rmSync(temp, { recursive: true, force: true });

function withTsRelativeImports(source) {
  return source.replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (match, before, specifier, after) => {
    if (/\.[cm]?[jt]sx?$/.test(specifier)) return match;
    return `${before}${specifier}.ts${after}`;
  });
}

function copyExecutableTs(relativePath, targetRoot) {
  const sourcePath = path.join(root, relativePath);
  const targetPath = path.join(targetRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, withTsRelativeImports(fs.readFileSync(sourcePath, "utf8")));
}

function copyExecutableTsTree(relativeDirectory, targetRoot) {
  const sourceDirectory = path.join(root, relativeDirectory);
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) copyExecutableTsTree(relativePath, targetRoot);
    else if (entry.isFile() && entry.name.endsWith(".ts")) copyExecutableTs(relativePath, targetRoot);
  }
}

function pythonCandidates() {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return [{ command: configured, args: [] }];
  const portable = process.platform === "win32"
    ? path.join(root, ".tools", "python313-runtime", "python.exe")
    : path.join(root, ".tools", "python313-runtime", "bin", "python");
  return [
    ...(fs.existsSync(portable) ? [{ command: portable, args: [] }] : []),
    ...(process.platform === "win32"
      ? [{ command: "py", args: ["-3.13"] }, { command: "python", args: [] }]
      : [{ command: "python3.13", args: [] }, { command: "python3", args: [] }, { command: "python", args: [] }]),
  ];
}

function executePythonWorkflow(workflowDocument, csvText) {
  const input = JSON.stringify({ workflow: workflowDocument, csvText, inputFiles: [] });
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate.command, [...candidate.args, path.join(root, "scripts/runtime-parity-python.py")], {
      cwd: root, input, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    if (result.error) continue;
    if (result.status !== 0) throw new Error(`Python migrated-workflow runner failed: ${result.stderr || result.stdout}`);
    return JSON.parse(result.stdout);
  }
  throw new Error("Python 3.13 was not found for migrated-workflow compatibility smoke");
}

try {
  const migrationsSource = fs.readFileSync(path.join(root, "src/workflow-core/migrations.ts"), "utf8");
  const nodeMigrationsSource = fs.readFileSync(path.join(root, "src/workflow-core/node-migrations.ts"), "utf8")
    .replace('from "./migrations"', 'from "./migrations.ts"');
  const functionMigrationsSource = fs.readFileSync(path.join(root, "src/workflow-core/function-migrations.ts"), "utf8")
    .replace('from "./migrations"', 'from "./migrations.ts"');
  fs.writeFileSync(path.join(temp, "migrations.ts"), migrationsSource);
  fs.writeFileSync(path.join(temp, "node-migrations.ts"), nodeMigrationsSource);
  fs.writeFileSync(path.join(temp, "function-migrations.ts"), functionMigrationsSource);

  const migrations = await import(pathToFileURL(path.join(temp, "migrations.ts")).href);
  const nodeMigrations = await import(pathToFileURL(path.join(temp, "node-migrations.ts")).href);
  const functionMigrations = await import(pathToFileURL(path.join(temp, "function-migrations.ts")).href);

  migrations.registerWorkflowMigration(1, (document) => ({ ...document, schemaVersion: 2, functions: Array.isArray(document.functions) ? document.functions : [] }));
  migrations.registerWorkflowMigration(2, (document) => ({ ...document, schemaVersion: 3, functions: Array.isArray(document.functions) ? document.functions : [], requirements: Array.isArray(document.requirements) ? document.requirements : [] }));
  migrations.registerWorkflowMigration(3, (document) => ({ ...document, schemaVersion: 4, environment: document.environment && typeof document.environment === "object" && !Array.isArray(document.environment) ? document.environment : { pythonImports: [], pythonDefinitions: [] }, parameters: Array.isArray(document.parameters) ? document.parameters : [] }));
  assert.throws(() => migrations.registerWorkflowMigration(1, (document) => ({ ...document, schemaVersion: 2 })), /already registered/, "historical schema migration steps must be immutable once registered");
  assert.throws(() => migrations.migrateWorkflowDocumentWithReport({ schemaVersion: 70 }, 71), (error) => error?.code === "missing-schema-migration", "missing schema steps must fail closed");
  migrations.registerWorkflowMigration(80, (document) => ({ ...document, schemaVersion: 82 }));
  assert.throws(() => migrations.migrateWorkflowDocumentWithReport({ schemaVersion: 80 }, 81), (error) => error?.code === "invalid-schema-migration", "invalid schema migration output must fail closed");

  const fixtureRoot = path.join(root, "tests/workflow-compatibility/fixtures");
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8"));
  for (const fixture of manifest.fixtures) {
    const rawText = fs.readFileSync(path.join(fixtureRoot, fixture.file), "utf8");
    const raw = JSON.parse(rawText);
    assert.equal(raw.schemaVersion, fixture.schemaVersion, `${fixture.file}: manifest schema mismatch`);
    if (!fixture.expectedCurrent) {
      assert.throws(() => migrations.migrateWorkflowDocumentWithReport(raw, 4), (error) => error?.code === "future-schema-version", `${fixture.file}: future schema must be rejected without rewrite`);
      assert.equal(fs.readFileSync(path.join(fixtureRoot, fixture.file), "utf8"), rawText, `${fixture.file}: source fixture changed`);
      continue;
    }
    const migrated = migrations.migrateWorkflowDocumentWithReport(raw, 4);
    assert.equal(migrated.document.schemaVersion, 4, `${fixture.file}: did not reach schema v4`);
    assert.ok(Array.isArray(migrated.document.functions), `${fixture.file}: missing functions canonical array`);
    assert.ok(Array.isArray(migrated.document.requirements), `${fixture.file}: missing requirements canonical array`);
    assert.equal(migrated.steps.length, 4 - fixture.schemaVersion, `${fixture.file}: incorrect migration trace`);
    const normalized = migrations.normalizeWorkflowNodeVersions(migrated.document);
    for (const node of normalized.nodes ?? []) assert.ok(Number.isInteger(Number(node?.data?.nodeVersion)), `${fixture.file}: root node version missing`);
    for (const fn of normalized.functions ?? []) for (const node of fn?.nodes ?? []) assert.ok(Number.isInteger(Number(node?.data?.nodeVersion)), `${fixture.file}: function node version missing`);
    assert.equal(raw.schemaVersion, fixture.schemaVersion, `${fixture.file}: migration mutated parsed source`);
  }

  // Execute the real Workflow Core parser against the historical corpus. This copies only
  // dependency-free TypeScript modules and lets Node strip types at runtime, so the smoke
  // exercises the same schema migration, NodeContract default hydration and validation code
  // that the application uses instead of reimplementing those rules in the test.
  const fullParserRoot = path.join(temp, "full-parser");
  for (const relativePath of [
    "src/workflow.ts",
    "src/nodeCatalog.ts",
    "src/nodeSpec.ts",
    "src/customNode.ts",
    "src/nodeContract.ts",
    "src/runtime/javascript/engine/providers.ts",
    "src/runtime/pythonProviders.ts",
    "src/workflow-core/migrations.ts",
    "src/workflow-core/schema-migrations.ts",
    "src/workflow-core/node-migrations.ts",
    "src/workflow-core/function-migrations.ts",
    "src/workflow-core/validation.ts",
    "src/editor-core/resource-contract.ts",
    "src/editor-core/resource-migrations.ts",
  ]) copyExecutableTs(relativePath, fullParserRoot);
  const workflow = await import(pathToFileURL(path.join(fullParserRoot, "src/workflow.ts")).href);
  assert.throws(() => workflow.parseWorkflow(JSON.stringify({ schemaVersion: "1", name: "broken", nodes: [], edges: [] })), (error) => error?.code === "invalid-schema-version", "schemaVersion must not coerce strings or booleans into historical versions");
  assert.throws(() => workflow.parseWorkflow(JSON.stringify({ schemaVersion: 3, name: "broken", nodes: [{ id: "n", data: { nodeType: "table.absolute", nodeVersion: "1", parameters: {} } }], edges: [], functions: [], requirements: [] })), (error) => error?.code === "invalid-node-migration", "nodeVersion must not be coerced from strings");
  assert.throws(() => workflow.parseWorkflow(JSON.stringify({ schemaVersion: 3, name: "broken", nodes: [], edges: [], functions: [{ id: "fn", name: "fn", version: "1", inputs: [], outputs: [], nodes: [], edges: [] }], requirements: [] })), /版本无效/, "function definition version must remain a strict integer");
  assert.throws(() => workflow.parseWorkflow(JSON.stringify({ schemaVersion: 1, name: "broken", nodes: "invalid", edges: [] })), (error) => error?.code === "invalid-document", "supported legacy structure must be checked before migration");
  assert.throws(() => workflow.parseWorkflow(JSON.stringify({ schemaVersion: 2, name: "broken", nodes: [], edges: [], requirements: "numpy" })), (error) => error?.code === "invalid-document", "migration must not silently discard malformed known fields");
  for (const fixture of manifest.fixtures) {
    const fixturePath = path.join(fixtureRoot, fixture.file);
    const rawText = fs.readFileSync(fixturePath, "utf8");
    if (!fixture.expectedCurrent) {
      assert.throws(() => workflow.parseWorkflowWithReport(rawText), (error) => error?.code === "future-schema-version", `${fixture.file}: real parser must reject a future schema`);
      assert.equal(fs.readFileSync(fixturePath, "utf8"), rawText, `${fixture.file}: real parser must not mutate fixture bytes`);
      continue;
    }
    const parsed = workflow.parseWorkflowWithReport(rawText);
    assert.equal(parsed.document.schemaVersion, workflow.WORKFLOW_SCHEMA_VERSION, `${fixture.file}: real parser did not reach current schema`);
    assert.equal(parsed.report.schemaFromVersion, fixture.schemaVersion, `${fixture.file}: real parser reported wrong source schema`);
    assert.equal(parsed.report.schemaSteps.length, workflow.WORKFLOW_SCHEMA_VERSION - fixture.schemaVersion, `${fixture.file}: real parser migration trace incomplete`);
    for (const node of parsed.document.nodes) assert.ok(Number.isInteger(node.data.nodeVersion), `${fixture.file}: real parser left a root node unversioned`);
    for (const fn of parsed.document.functions) for (const node of fn.nodes) assert.ok(Number.isInteger(node.data.nodeVersion), `${fixture.file}: real parser left a function node unversioned`);
    const canonical = JSON.stringify(parsed.document);
    const reopened = workflow.parseWorkflowWithReport(canonical);
    assert.deepEqual(reopened.document, parsed.document, `${fixture.file}: canonical save/reopen changed document semantics`);
    assert.equal(reopened.report.schemaSteps.length, 0, `${fixture.file}: canonical reopen should not schema-migrate`);
    assert.equal(reopened.report.nodeSteps.length, 0, `${fixture.file}: canonical reopen should not node-migrate`);
  }


  const resourceMigrations = await import(pathToFileURL(path.join(fullParserRoot, "src/editor-core/resource-migrations.ts")).href);
  const legacySavedNode = {
    id: "legacy-node", name: "Legacy", savedAt: "old",
    node: { id: "n", type: "workflow", position: { x: 0, y: 0 }, data: { label: "abs", nodeType: "table.absolute", parameters: {}, status: "idle" } },
  };
  const migratedSavedNode = resourceMigrations.migrateSavedNodeEntry(legacySavedNode);
  assert.equal(migratedSavedNode.resourceSchemaVersion, resourceMigrations.EDITOR_RESOURCE_SCHEMA_VERSION, "saved-node resource schema did not migrate");
  assert.equal(migratedSavedNode.node.data.nodeVersion, 1, "saved-node NodeSpec version was not hydrated");
  const contextualCall = {
    id: "call", type: "workflow", position: { x: 0, y: 0 },
    data: { label: "call", nodeType: "function.call", nodeVersion: 1, parameters: { functionId: "defined-in-destination", functionVersion: 1 }, status: "idle", functionInputs: [{ id: "input", label: "Input", valueType: "table" }], functionOutputs: [{ id: "output", label: "Output", valueType: "table" }] },
  };
  assert.notEqual(resourceMigrations.migrateSavedNodeEntry({ id: "context", name: "Context", savedAt: "old", node: contextualCall }).compatibility, "invalid", "fragment migration incorrectly required document-level function context");
  const futureFlowPayload = JSON.stringify({ schemaVersion: 99, name: "Future", nodes: [], edges: [], functions: [], requirements: [] });
  const futureResource = resourceMigrations.migrateFlowEntry({ id: "future", name: "Future", savedAt: "future", document: futureFlowPayload });
  assert.equal(futureResource.compatibility, "future", "future flow resource was not protected");
  assert.equal(futureResource.document, futureFlowPayload, "future flow resource payload was rewritten");


  // Execute the actual Resource Library Service with lightweight dependency stubs.
  // Protected future/invalid payloads must remain non-actionable and semantically
  // untouched even though the current library is persisted/reloaded around them.
  copyExecutableTs("src/workflow-core/persistence.ts", fullParserRoot);
  const resourceLibraryTarget = path.join(fullParserRoot, "src/editor-core/resource-library.ts");
  let resourceLibrarySource = fs.readFileSync(path.join(root, "src/editor-core/resource-library.ts"), "utf8")
    .replaceAll('from "../workflow-core"', 'from "../workflow-core/persistence"');
  fs.mkdirSync(path.dirname(resourceLibraryTarget), { recursive: true });
  fs.writeFileSync(resourceLibraryTarget, withTsRelativeImports(resourceLibrarySource));
  fs.writeFileSync(path.join(fullParserRoot, "src/editor-core/workflow-structure.ts"), `export function repairWorkflowGroupInterfaces(nodes) { return nodes; }\n`);
  const resourceLibrary = await import(pathToFileURL(resourceLibraryTarget).href);
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const futureFlowRecord = { id: "future-service-flow", name: "Future", savedAt: "future", resourceSchemaVersion: 99, document: futureFlowPayload, futureMetadata: { nested: [1, { keep: true }] } };
  const invalidNodeRecord = { id: "invalid-service-node", name: "Invalid", savedAt: "future", resourceSchemaVersion: "99", node: legacySavedNode.node, futureMetadata: { keep: "invalid-version" } };
  store.set(resourceLibrary.RESOURCE_LIBRARY_STORAGE_KEYS.flows, JSON.stringify([futureFlowRecord]));
  store.set(resourceLibrary.RESOURCE_LIBRARY_STORAGE_KEYS.groups, "[]");
  store.set(resourceLibrary.RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes, JSON.stringify([invalidNodeRecord]));
  const service = new resourceLibrary.EditorResourceLibraryService(storage);
  assert.equal(service.getState().flows[0].compatibility, "future", "future resource was not classified as protected");
  assert.equal(service.getState().savedNodes[0].compatibility, "invalid", "invalid resource schema version was silently treated as legacy v1");
  assert.equal(service.renameFlow("future-service-flow", "changed"), null, "future flow should be immutable in the current app");
  assert.equal(service.removeFlow("future-service-flow"), false, "future flow should not be removable through current resource actions");
  assert.equal(service.renameNode("invalid-service-node", "changed"), false, "invalid saved node should be immutable in the current app");
  assert.deepEqual(JSON.parse(store.get(resourceLibrary.RESOURCE_LIBRARY_STORAGE_KEYS.flows))[0], futureFlowRecord, "future flow metadata was rewritten while persisting the library");
  assert.deepEqual(JSON.parse(store.get(resourceLibrary.RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes))[0], invalidNodeRecord, "invalid resource metadata was rewritten while persisting the library");
  service.reload();
  assert.deepEqual(JSON.parse(store.get(resourceLibrary.RESOURCE_LIBRARY_STORAGE_KEYS.flows))[0], futureFlowRecord, "future flow metadata changed after reload");

  // Run an actual historical v1 workflow through the current JavaScript engine after
  // migration. This closes the gap between "the file parsed" and "the migrated graph
  // still executes with current runtime semantics" without requiring Vite/Vitest.
  const jsRuntimeRoot = path.join(temp, "js-runtime");
  copyExecutableTsTree("src/runtime/javascript/engine", jsRuntimeRoot);
  const jsEngine = await import(pathToFileURL(path.join(jsRuntimeRoot, "src/runtime/javascript/engine/index.ts")).href);
  const legacyRuntimeText = fs.readFileSync(path.join(fixtureRoot, "phase7-v1-basic.workflow.json"), "utf8");
  const migratedRuntimeDocument = workflow.parseWorkflowWithReport(legacyRuntimeText).document;
  const runtimeResult = JSON.parse(jsEngine.executeWorkflowJson(JSON.stringify(migratedRuntimeDocument), "value\n-2\n3\n-4"));
  assert.equal(runtimeResult.status, "success", `migrated v1 JavaScript runtime failed: ${runtimeResult.error ?? "unknown error"}`);
  const valueIndex = runtimeResult.preview.columns.indexOf("value");
  assert.ok(valueIndex >= 0, "migrated v1 runtime preview lost value column");
  const migratedValues = runtimeResult.preview.rows.map((row) => Number(row[valueIndex]));
  assert.deepEqual(migratedValues, [2, 3, 4], "migrated v1 workflow changed JavaScript execution semantics");
  const pythonRuntimeResult = executePythonWorkflow(migratedRuntimeDocument, "value\n-2\n3\n-4");
  assert.equal(pythonRuntimeResult.status, "success", `migrated v1 Python runtime failed: ${pythonRuntimeResult.message ?? "unknown error"}`);
  const pythonValueIndex = pythonRuntimeResult.preview.columns.indexOf("value");
  assert.ok(pythonValueIndex >= 0, "migrated v1 Python runtime preview lost value column");
  const pythonMigratedValues = pythonRuntimeResult.preview.rows.map((row) => Number(row[pythonValueIndex]));
  assert.deepEqual(pythonMigratedValues, migratedValues, "migrated v1 Python/JavaScript semantics diverged");


  nodeMigrations.registerNodeMigration("phase11.smoke", 1, (node) => ({
    node: { ...node, data: { ...node.data, nodeVersion: 2, parameters: { renamed: node.data?.parameters?.legacy ?? "default" } } },
    inputHandleRenames: { legacyIn: "input" },
    outputHandleRenames: { legacyOut: "output" },
  }));
  assert.throws(() => nodeMigrations.registerNodeMigration("phase11.smoke", 1, (node) => ({ ...node, data: { ...node.data, nodeVersion: 2 } })), /already registered/, "historical NodeSpec migration steps must be immutable once registered");
  const graphSource = {
    schemaVersion: 3,
    nodes: [
      { id: "n", data: { nodeType: "phase11.smoke", nodeVersion: 1, parameters: { legacy: 7 } } },
      { id: "g", data: { nodeType: "workflow.group", nodeVersion: 1, parameters: {}, groupInputs: [{ id: "gi", internalNodeId: "n", internalHandle: "legacyIn" }], groupOutputs: [{ id: "go", internalNodeId: "n", internalHandle: "legacyOut" }] } },
    ],
    edges: [{ id: "e", source: "n", sourceHandle: "legacyOut", target: "n", targetHandle: "legacyIn" }],
    functions: [{ id: "fn", inputs: [{ id: "in", internalNodeId: "f", internalHandle: "legacyIn" }], outputs: [{ id: "out", internalNodeId: "f", internalHandle: "legacyOut" }], nodes: [{ id: "f", data: { nodeType: "phase11.smoke", nodeVersion: 1, parameters: { legacy: 9 } } }], edges: [] }],
  };
  const migratedGraph = nodeMigrations.migrateWorkflowNodeContracts(graphSource, (type) => type === "phase11.smoke" ? 2 : 1, () => ({ stableDefault: true }));
  assert.equal(migratedGraph.document.nodes[0].data.nodeVersion, 2);
  assert.deepEqual(migratedGraph.document.nodes[0].data.parameters, { stableDefault: true, renamed: 7 });
  assert.equal(migratedGraph.document.edges[0].sourceHandle, "output");
  assert.equal(migratedGraph.document.edges[0].targetHandle, "input");
  assert.equal(migratedGraph.document.nodes[1].data.groupInputs[0].internalHandle, "input");
  assert.equal(migratedGraph.document.functions[0].inputs[0].internalHandle, "input");
  assert.equal(graphSource.nodes[0].data.nodeVersion, 1, "node migration mutated source graph");
  nodeMigrations.registerNodeMigration("phase11.id-smoke", 1, (node) => ({ ...node, id: "changed", data: { ...node.data, nodeVersion: 2 } }));
  assert.throws(() => nodeMigrations.migrateWorkflowNodeContracts({
    nodes: [{ id: "stable", data: { nodeType: "phase11.id-smoke", nodeVersion: 1, parameters: {} } }],
    edges: [],
  }, () => 2, () => ({})), (error) => error?.code === "invalid-node-migration", "node migration must preserve stable node ids");

  const functionResult = functionMigrations.reconcileWorkflowFunctionCalls({
    functions: [{ id: "fn", version: 2, inputs: [{ id: "input", label: "Input", valueType: "table" }], outputs: [{ id: "output", label: "Output", valueType: "table" }], nodes: [], edges: [] }],
    nodes: [{ id: "call", data: { nodeType: "function.call", parameters: { functionId: "fn", functionVersion: 1 }, functionInputs: [{ id: "input", valueType: "table" }], functionOutputs: [{ id: "output", valueType: "table" }] } }],
    edges: [],
  });
  assert.equal(functionResult.document.nodes[0].data.parameters.functionVersion, 2, "compatible function call did not advance version");
  assert.equal(functionResult.steps.length, 1, "function-call migration trace missing");
  assert.throws(() => functionMigrations.reconcileWorkflowFunctionCalls({
    functions: [{ id: "fn", version: 2, inputs: [{ id: "input", valueType: "table" }], outputs: [], nodes: [], edges: [] }],
    nodes: [{ id: "call", data: { nodeType: "function.call", parameters: { functionId: "fn", functionVersion: 1 }, functionInputs: [{ id: "legacy", valueType: "table" }], functionOutputs: [] } }],
  }), (error) => error?.code === "incompatible-function-signature", "changed function signature should never be guessed");

  const workflowSource = fs.readFileSync(path.join(root, "src/workflow.ts"), "utf8");
  const schemaSource = fs.readFileSync(path.join(root, "src/workflow-core/schema-migrations.ts"), "utf8");
  assert.match(schemaSource, /CURRENT_WORKFLOW_SCHEMA_VERSION = 4/);
  assert.match(schemaSource, /registerWorkflowMigration\(1/);
  assert.match(schemaSource, /registerWorkflowMigration\(2/);
  assert.match(schemaSource, /registerWorkflowMigration\(3/);
  assert.match(workflowSource, /ensureBuiltInWorkflowMigrationsRegistered/);
  assert.match(workflowSource, /migrateWorkflowNodeContracts/);
  assert.match(workflowSource, /parseWorkflowWithReport/);

  const lifecycleSource = fs.readFileSync(path.join(root, "src/editor-core/lifecycle.ts"), "utf8");
  assert.match(lifecycleSource, /status: "incompatible"/);
  assert.match(lifecycleSource, /JSON\.parse\(saved\)/, "autosave should separate JSON corruption from semantic incompatibility");
  assert.match(lifecycleSource, /status: "incompatible"/);
  assert.match(lifecycleSource, /reason: "protected"/, "future autosave must be protected from overwrite");
  const resourceSource = fs.readFileSync(path.join(root, "src/editor-core/resource-migrations.ts"), "utf8");
  assert.match(resourceSource, /EDITOR_RESOURCE_SCHEMA_VERSION = 2/);
  assert.match(resourceSource, /compatibility: "future"/);

  console.log(`Workflow compatibility smoke passed (${manifest.fixtures.length} historical/future fixtures through the real parser + graph/function migration guards + migrated-v1 Python/JS execution).`);
} finally {
  cleanup();
}
