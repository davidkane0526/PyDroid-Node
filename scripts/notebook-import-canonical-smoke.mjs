import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const expect = (condition, message) => { if (!condition) throw new Error(message); };

const app = read("src/App.tsx");
const notebook = read("src/workflowNotebook.ts");
const productionFiles = [
  "src/App.tsx",
  "src/workflowNotebook.ts",
  "src/nodeCatalog.ts",
  "src/nodeContract.ts",
  "src/runtime/javascript/engine/workflow/execute.ts",
  "src/runtime/javascript/engine/workflow/functions.ts",
  "src/runtime/javascript/engine/workflow/graph.ts",
  "python/pydroid_flow/notebook.py",
  "python/pydroid_flow/engine_parts/workflow_execution.py",
  "python/pydroid_flow/engine_parts/graph.py",
];

expect(app.includes("const installCompiledNotebook ="), "App must expose one canonical compiled-notebook installer");
const installerCalls = [...app.matchAll(/installCompiledNotebook\(/g)].length;
expect(installerCalls === 2, `Expected both Notebook import entry points to call the canonical installer, got ${installerCalls}`);
expect(app.includes("const importNotebook = async"), "Dedicated Notebook import entry must remain present");
expect(app.includes("const loadWorkflowFile = async"), "General workflow-file import entry must remain present");
expect(app.includes('analysis.kind === "AnnotationOnly"'), "Notebook analyzer fallback must recognize annotation-only code cells");
expect(notebook.includes('analysis?.kind === "AnnotationOnly"'), "Annotation-only code cells must be excluded from executable workflow nodes");
expect(notebook.includes("const importedSourceKeys = new Set<string>();"), "Notebook environment imports must be deduplicated canonically");
expect(notebook.includes("importedSourceKeys.has(normalizedSource)"), "Notebook import deduplication must use normalized source");

const forbidden = [
  "notebookSourceFunctionId",
  "notebookSourceFunctionName",
  "notebook.if_block",
  "notebook.for_block",
  "notebook.while_block",
  "table.group_mean",
  "table.periodic_group_mean",
];
for (const file of productionFiles) {
  const source = read(file);
  for (const token of forbidden) {
    expect(!source.includes(token), `${file} must not restore removed Notebook/runtime compatibility token ${token}`);
  }
}

console.log("Notebook import canonical-path smoke passed (dual entry + annotation/import cleanup + legacy bridge guard). ");
