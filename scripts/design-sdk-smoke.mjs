import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCoreStyles } from "./style-test-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const sdk = read("sdk/design.ts");
const theme = read("sdk/theme.ts");
const contract = read("src/styles/theme-contract.css");
const styles = readCoreStyles(root);
const publicSdk = read("sdk/index.ts");

assert.match(sdk, /UI_DESIGN_SDK_VERSION\s*=\s*1/, "Unified Design SDK version missing");
for (const token of ["material-panel-shadow", "material-card-shadow", "material-control-shadow", "material-popup-shadow", "material-node-shadow", "material-overlay-blur", "motion-duration-fast", "motion-duration-normal", "motion-ease-standard", "motion-hover-lift", "motion-press-scale", "motion-enter-distance"]) {
  assert.ok(sdk.includes(`\"${token}\"`), `Design SDK missing ${token}`);
  assert.ok(styles.includes(`--${token}:`) || contract.includes(`--${token}:`), `Core default missing ${token}`);
}
assert.match(theme, /material\?: UiThemeMaterial/, "Theme contract must accept semantic material tokens");
assert.match(theme, /motion\?: UiMotionTokens/, "Theme contract must accept semantic motion tokens");
assert.match(theme, /Object\.entries\(material\)/, "Theme CSS variable resolver must include material");
assert.match(theme, /Object\.entries\(motion\)/, "Theme CSS variable resolver must include motion");
assert.match(publicSdk, /export \* from "\.\/design"/, "Plugin SDK must export the unified Design SDK");
assert.match(contract, /var\(--material-popup-shadow\)/, "Dialogs/popups must consume shared material elevation");
assert.match(contract, /var\(--material-node-shadow\)/, "Installed themes must be able to consume shared node material elevation");
assert.match(contract, /var\(--motion-duration-normal\)/, "Installed themes must be able to consume shared motion timing");
assert.match(contract, /data-ui-theme="core\.default"/, "Design overlay must explicitly exclude core.default");
assert.doesNotMatch(styles, /var\(--material-|var\(--motion-/, "Core default component styling must not be rewritten through Design SDK tokens");
assert.match(contract, /@media \(prefers-reduced-motion: reduce\)/, "Motion contract must respect reduced motion");
for (const forbidden of ["ui-control-height", "node-width", "node-min-height", "node-scale", "endpoint-scale", "font-size", "padding", "gap"]) {
  assert.ok(!sdk.includes(`\"${forbidden}\"`), `Design SDK must not expose Core geometry token ${forbidden}`);
}
console.log("Unified Design SDK smoke: PASS (opt-in material/motion overlay, core.default compatibility, geometry isolation, reduced-motion contract)");
