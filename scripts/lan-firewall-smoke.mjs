import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { LAN_WEB_PORT, FIREWALL_PROFILE, FIREWALL_REMOTE_ADDRESS, RULES, inspectWindowsLanFirewall } = require("../desktop/lan/firewall.cjs");

assert.equal(LAN_WEB_PORT, 8765, "LAN Web port must stay stable at 8765");
assert.equal(FIREWALL_PROFILE, "Private", "LAN firewall must never default to Public profile");
assert.equal(FIREWALL_REMOTE_ADDRESS, "LocalSubnet", "LAN firewall must stay limited to the local subnet");
assert.deepEqual(RULES.map((item) => [item.protocol, item.port]), [["TCP", 8765], ["UDP", 1900], ["UDP", 5353]]);
for (const rule of RULES) {
  assert.doesNotMatch(rule.name, /public/i);
}
const status = await inspectWindowsLanFirewall();
if (process.platform !== "win32") {
  assert.equal(status.applicable, false);
  assert.equal(status.rulesReady, true);
}
console.log("LAN firewall contract smoke passed: Private + LocalSubnet, TCP 8765, UDP 1900/5353");
