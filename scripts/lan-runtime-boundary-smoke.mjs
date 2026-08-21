import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const remoteServerSource = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
const networkSource = readFileSync(path.join(root, "desktop/lan/network.cjs"), "utf8");
const discoverySource = readFileSync(path.join(root, "desktop/lan/LanDiscoveryService.cjs"), "utf8");
const legacyFirewallPath = path.join(root, "desktop/lan/windows-firewall.cjs");
const runtimeLanSource = `${remoteServerSource}\n${networkSource}\n${discoverySource}`;

assert.match(remoteServerSource, /const LAN_WEB_PORT = 8765;/,
  "Remote Web production port must remain an explicit fixed constant");
assert.match(remoteServerSource, /listen\(LAN_WEB_PORT, "0\.0\.0\.0"/,
  "Remote Web production startup must bind the fixed port directly");
assert.equal(existsSync(legacyFirewallPath), false,
  "Remote/LAN runtime must not own or provision Windows firewall rules");
assert.doesNotMatch(runtimeLanSource, /powershell|Start-Process|runas|Get-NetFirewallRule|New-NetFirewallRule|Get-NetConnectionProfile|Get-NetIPConfiguration|child_process/i,
  "Remote/LAN runtime must not launch PowerShell, elevate, manage firewall/profile state, or shell out for route discovery");
assert.match(networkSource, /dgram\.createSocket\("udp4"\)[\s\S]*socket\.connect\(9, "192\.0\.2\.1"/,
  "Primary LAN address should be derived from the OS socket routing decision without shelling out");
assert.match(discoverySource, /await resolvePreferredLanAddress\(\)/,
  "Discovery must use the native preferred LAN source address when available");

console.log("LAN runtime boundary smoke passed: direct 8765 bind, no PowerShell/UAC/firewall automation, native socket route selection.");
