import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { LAN_WEB_PORT, FIREWALL_PROFILE, FIREWALL_REMOTE_ADDRESS, RULES } = require("../desktop/lan/firewall.cjs");

assert.equal(LAN_WEB_PORT, 8765, "LAN Web port must stay stable at 8765");
assert.equal(FIREWALL_PROFILE, "Any", "optional LocalSubnet rules must not depend on the mutable Windows network category");
assert.equal(FIREWALL_REMOTE_ADDRESS, "LocalSubnet", "optional firewall integration must stay limited to the local subnet");
assert.deepEqual(RULES.map((item) => [item.protocol, item.port]), [["TCP", 8765], ["UDP", 1900], ["UDP", 5353]]);

const firewallSource = readFileSync(path.join(root, "desktop/lan/firewall.cjs"), "utf8");
assert.doesNotMatch(firewallSource, /execFileSync/, "firewall integration must never synchronously block the Electron main event loop");
assert.match(firewallSource, /let ensurePromise = null;/, "optional firewall provisioning must remain single-flight");
assert.match(firewallSource, /elevationAttemptedThisProcess/, "a cancelled elevation must not repeatedly prompt during one app process");

const remoteServerSource = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
assert.doesNotMatch(remoteServerSource, /await\s+ensureWindowsLanFirewall/, "Remote Web startup must never wait for firewall inspection/elevation");
assert.match(remoteServerSource, /resolve\(info\);[\s\S]{0,500}setImmediate\(\(\) => \{ ensureWindowsLanFirewall/, "optional firewall integration must run only after Remote Web startup has completed");
assert.match(remoteServerSource, /externalClientObserved:\s*Boolean\(externalClient\)/, "real external-client evidence must remain observational diagnostic data");

console.log("LAN boundary contract smoke passed: production startup is firewall-independent; optional LocalSubnet provisioning is asynchronous and non-gating.");
