import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const main = read("src/main.tsx");

assert.equal(existsSync(path.join(root, "src/styles/fixes.css")), false, "generic fixes.css patch layer must not return");
assert.equal(existsSync(path.join(root, "src/styles/base.css")), false, "monolithic base.css must not return");
const orderedStyles = [
  '"./styles/tokens.css"',
  '"./styles/workspace-shell.css"',
  '"./styles/nodes-base.css"',
  '"./styles/light-theme.css"',
  '"./styles/data-workspace.css"',
  '"./styles/workspace-chrome.css"',
  '"./styles/workspace-controls.css"',
  '"./styles/settings-services.css"',
  '"./styles/workflow-resources.css"',
  '"./styles/nodes-dynamic.css"',
  '"./styles/shell-responsive.css"',
  '"./styles/panels.css"',
  '"./styles/result-presentation.css"',
  '"./styles/canvas.css"',
  '"./plugins/plugin-manager.css"',
  '"./styles/theme-contract.css"',
];
let previous = -1;
for (const style of orderedStyles) {
  const current = main.indexOf(style);
  assert.ok(current > previous, `${style} is missing or violates the explicit CSS ownership/cascade order`);
  previous = current;
}
for (const [file, maxLines] of [
  ["src/styles/tokens.css", 120],
  ["src/styles/workspace-shell.css", 520],
  ["src/styles/nodes-base.css", 260],
  ["src/styles/light-theme.css", 240],
  ["src/styles/data-workspace.css", 180],
  ["src/styles/workspace-chrome.css", 1300],
  ["src/styles/workspace-controls.css", 1150],
  ["src/styles/settings-services.css", 950],
  ["src/styles/workflow-resources.css", 180],
  ["src/styles/nodes-dynamic.css", 1150],
  ["src/styles/shell-responsive.css", 180],
  ["src/styles/panels.css", 420],
  ["src/styles/result-presentation.css", 220],
]) {
  const lines = read(file).split(/\r?\n/).length;
  assert.ok(lines <= maxLines, `${file} is becoming another generic patch bucket (${lines} lines)`);
}
console.log("Style ownership smoke passed (no monolithic base/fixes layer; explicit ownership cascade).");
