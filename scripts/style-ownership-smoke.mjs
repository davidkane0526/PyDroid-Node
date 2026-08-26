import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const main = read("src/main.tsx");

assert.equal(existsSync(path.join(root, "src/styles/fixes.css")), false, "generic fixes.css patch layer must not return");
const orderedStyles = [
  '"./styles/base.css"',
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
  ["src/styles/shell-responsive.css", 180],
  ["src/styles/panels.css", 420],
  ["src/styles/result-presentation.css", 220],
]) {
  const lines = read(file).split(/\r?\n/).length;
  assert.ok(lines <= maxLines, `${file} is becoming another generic patch bucket (${lines} lines)`);
}
console.log("Style ownership smoke passed (no generic fixes layer; explicit shared/panel/result/theme cascade).");
