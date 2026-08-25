import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const base = read("src/styles/base.css");
const canvas = read("src/styles/canvas.css");
const plugin = read("src/plugins/plugin-manager.css");
const overlay = read("src/styles/theme-contract.css");

assert.match(overlay, /\[data-ui-theme\]:not\(\[data-ui-theme="core\.default"\]\)/, "theme overlay must be opt-in and exclude core.default");
assert.doesNotMatch(base, /var\(--material-|var\(--motion-/, "legacy Core component styles must not consume new material/motion tokens");
assert.doesNotMatch(canvas, /var\(--material-|var\(--motion-/, "legacy canvas styles must not consume new material/motion tokens");
assert.doesNotMatch(plugin, /var\(--material-|var\(--motion-/, "legacy plugin-manager styles must not consume new material/motion tokens");
assert.match(base, /\.button\.secondary \{ background: var\(--border\); \}/, "legacy secondary-button material changed");
assert.match(base, /\.button:hover \{ filter: brightness\(1\.12\); \}/, "legacy button hover effect changed");
assert.match(base, /\.react-flow__node\.node-entering \{ animation: node-drop-in \.3s cubic-bezier\(\.16, 1\.1, \.3, 1\); \}/, "legacy node enter animation changed");
assert.match(base, /@keyframes node-drop-in \{ from \{ opacity: 0; transform: translateY\(-8px\) scale\(\.9\); \}/, "legacy node enter motion shape changed");
assert.match(base, /\.settings-dialog \{[^}]*box-shadow: 0 24px 70px #000c;/, "legacy settings dialog material changed");
assert.match(plugin, /background: #020617d9;[\s\S]*backdrop-filter: blur\(5px\);/, "legacy plugin-manager backdrop changed");
assert.match(canvas, /linear-gradient\(180deg, #1a293b 0%, #182738 100%\)/, "legacy dark Soft node material changed");
assert.match(canvas, /border-color: #496682;/, "legacy dark Soft hover border changed");
assert.match(canvas, /border-color: #5480a7;/, "legacy dark Soft selected border changed");
assert.match(base, /workflow-node\.node-kind-group/, "semantic group class must survive visual restoration");
assert.doesNotMatch(base, /:has\(\.workflow-node__type\[title="workflow\.group"\]\)/, "group appearance must not depend on hidden node-type DOM");
assert.match(base, /workflow-node--dynamic-ui[\s\S]*text-overflow: ellipsis;/, "dynamic-node anti-overlap layout fix must survive visual restoration");

console.log("Core default visual baseline smoke: PASS (legacy product appearance/effects preserved; SDK overlay opt-in)");
