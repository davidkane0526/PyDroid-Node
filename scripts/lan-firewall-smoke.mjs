import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const remoteServerSource = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
const firewallSource = readFileSync(path.join(root, "desktop/lan/windows-firewall.cjs"), "utf8");
const networkSource = readFileSync(path.join(root, "desktop/lan/network.cjs"), "utf8");

assert.match(remoteServerSource, /const LAN_WEB_PORT = 8765;/,
  "Remote Web production port must remain an explicit fixed constant");
assert.match(remoteServerSource, /listen\(LAN_WEB_PORT, "0\.0\.0\.0"/,
  "Remote Web production startup must bind the fixed port directly");
assert.match(remoteServerSource, /await ensureWindowsLanAccess\(\{ log \}\)/,
  "Windows production startup must own the inbound boundary before reporting the service open");
assert.match(firewallSource, /TCP[^\n]*8765[\s\S]*UDP[^\n]*1900[\s\S]*UDP[^\n]*5353/,
  "Windows integration must own only the fixed Remote Web/discovery ports");
assert.match(firewallSource, /New-NetFirewallRule[\s\S]*-Profile Any/,
  "Firewall rules must not depend on mutable Public/Private network classification");
assert.doesNotMatch(firewallSource, /Get-NetConnectionProfile|NetworkCategory|LocalSubnet|setInterval|setTimeout\([^,]+,\s*\d+\).*retry|readiness|recovery/i,
  "Windows LAN setup must stay a one-shot fixed-port prerequisite, not a profile/readiness/recovery subsystem");
assert.match(networkSource, /Get-NetIPConfiguration[\s\S]*IPv4DefaultGateway/,
  "Windows LAN address selection must prefer the actual default-route interface so the advertised URL is externally useful");

console.log("LAN boundary smoke passed: fixed TCP 8765, one-shot Windows inbound rules, default-route URL selection, no profile/readiness/recovery state machine.");
