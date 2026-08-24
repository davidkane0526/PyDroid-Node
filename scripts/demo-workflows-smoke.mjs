import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const files = [
  "demo-01-scientific-pipeline.workflow.json",
  "demo-02-native-function.workflow.json",
  "demo-03-composite-group.workflow.json",
  "demo-04-control-flow.workflow.json",
  "demo-05-dynamic-sockets.workflow.json",
  "demo-06-if-zone.workflow.json",
  "demo-07-dynamic-types.workflow.json",
  "demo-08-dynamic-operators.workflow.json",
  "demo-09-loop-zones.workflow.json",
  "demo-10-parameter-sockets.workflow.json",
  "demo-11-dynamic-data-nodes.workflow.json",
  "demo-12-dynamic-table-parameters.workflow.json",
  "demo-13-dynamic-pulse-plot.workflow.json",
  "demo-14-dynamic-multi-input-concat.workflow.json",
  "demo-15-groupby-multi-series.workflow.json",
  "demo-16-dynamic-pulse-channels.workflow.json",
  "demo-17-column-math-pipeline.workflow.json",
  "demo-18-series-registry.workflow.json",
];

let failed = 0;
for (const file of files) {
  try {
    const document = JSON.parse(readFileSync(path.join(root, "examples", file), "utf8"));
    const valid = document.schemaVersion === 4
      && typeof document.name === "string"
      && Array.isArray(document.nodes) && document.nodes.length > 0
      && Array.isArray(document.edges)
      && Array.isArray(document.functions)
      && Array.isArray(document.requirements)
      && Array.isArray(document.parameters)
      && document.environment && typeof document.environment === "object";
    if (!valid) throw new Error("invalid canonical workflow envelope");
    const ids = new Set(document.nodes.map((node) => node.id));
    if (ids.size !== document.nodes.length) throw new Error("duplicate node id");
    for (const edge of document.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`dangling edge ${edge.id}`);
    }
    console.log(`✓ ${file} (${document.nodes.length} nodes)`);
  } catch (error) {
    console.error(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}
const moduleSource = readFileSync(path.join(root, "src", "workflow-demos.ts"), "utf8");
for (const file of files) {
  if (!moduleSource.includes(file)) { console.error(`✗ built-in demo registry misses ${file}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`Demo workflow smoke passed (${files.length}/${files.length}).`);
