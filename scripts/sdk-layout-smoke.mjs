import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const required = ["index.ts", "node.ts", "plugin.ts", "archive.ts", "resources.ts", "theme.ts", "design.ts", "README.md"];
for (const file of required) assert.ok(existsSync(path.join(root, "sdk", file)), `SDK file missing: sdk/${file}`);

const index = readFileSync(path.join(root, "sdk", "index.ts"), "utf8");
for (const module of ["node", "plugin", "archive", "resources", "theme", "design"]) assert.match(index, new RegExp(`export \\* from "\\./${module}"`), `SDK index does not export ${module}`);
assert.match(index, /PLUGIN_SDK_VERSION\s*=\s*4\s+as const/, "unexpected unified SDK version");

for (const legacy of ["nodePluginSdk.ts", "nodeSpecSdk.ts", "themePluginSdk.ts", "designSystemSdk.ts", "nodePluginResources.ts"]) {
  assert.equal(existsSync(path.join(root, "src", legacy)), false, `legacy SDK file remains in src/: ${legacy}`);
}
for (const implementation of ["plugins/packages.ts", "plugins/archive.ts", "plugins/PluginManager.tsx", "nodes/layout.ts", "styles/theme-contract.css"]) {
  assert.ok(existsSync(path.join(root, "src", implementation)), `organized implementation missing: src/${implementation}`);
}
assert.doesNotMatch(index, /src\/plugins|installNodePluginPackage|installNodePluginArchive/, "public SDK barrel must not re-export plugin-host implementation");

console.log("SDK layout smoke: PASS (single /sdk public surface, separated plugin host/node/style ownership)");
