import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { LAN_WEB_PORT, FIREWALL_PROFILE, FIREWALL_REMOTE_ADDRESS, RULES, inspectWindowsLanFirewall } = require("../desktop/lan/firewall.cjs");

assert.equal(LAN_WEB_PORT, 8765, "LAN Web port must stay stable at 8765");
assert.equal(FIREWALL_PROFILE, "Any", "explicitly enabled LAN service must not depend on Windows Public/Private category");
assert.equal(FIREWALL_REMOTE_ADDRESS, "LocalSubnet", "LAN firewall must stay limited to the local subnet");
assert.deepEqual(RULES.map((item) => [item.protocol, item.port]), [["TCP", 8765], ["UDP", 1900], ["UDP", 5353]]);
const status = await inspectWindowsLanFirewall();
if (process.platform !== "win32") {
  assert.equal(status.applicable, false);
  assert.equal(status.rulesReady, true);
  assert.equal(status.networkBoundaryReady, true);
}

const firewallSource = readFileSync(path.join(root, "desktop/lan/firewall.cjs"), "utf8");
assert.match(firewallSource, /let ensurePromise = null;/, "firewall provisioning must be single-flight");
assert.match(firewallSource, /elevationAttemptedThisProcess/, "a cancelled/failed elevation must not repeatedly prompt during the same app process");
assert.match(firewallSource, /-Profile \$\{FIREWALL_PROFILE\}/, "elevated rules must use the declared profile scope");
assert.match(firewallSource, /-RemoteAddress \$\{FIREWALL_REMOTE_ADDRESS\}/, "elevated rules must remain LocalSubnet-scoped");

const remoteServerSource = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
assert.match(remoteServerSource, /ensureWindowsLanFirewall\(\{ log \}\)/, "real Remote Web startup must provision the Windows LAN boundary exactly through the backend helper");
assert.match(remoteServerSource, /networkBoundaryReady:\s*Boolean\(firewall\?\.networkBoundaryReady\) \|\| Boolean\(externalClient\)/, "host readiness must accept either verified LocalSubnet rules or stronger real external-client evidence");
assert.match(remoteServerSource, /externalClientObserved:\s*Boolean\(externalClient\)/, "host readiness must distinguish self-probes from a real external LAN client");

console.log("LAN firewall contract smoke passed: Any-profile LocalSubnet boundary, single-flight provisioning, TCP 8765, UDP 1900/5353.");
