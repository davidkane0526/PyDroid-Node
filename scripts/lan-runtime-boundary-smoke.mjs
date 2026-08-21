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
assert.match(remoteServerSource, /const discovery = lanDiscovery\.start\(\{ port \}\);/,
  "HTTP startup must not await LAN discovery before returning the service URL");
assert.doesNotMatch(remoteServerSource, /await\s+lanDiscovery\.start/,
  "LAN discovery must never block Remote Web startup");
assert.equal(existsSync(legacyFirewallPath), false,
  "Remote/LAN runtime must not own or provision Windows firewall rules");
assert.doesNotMatch(runtimeLanSource, /powershell|Start-Process|runas|Get-NetFirewallRule|New-NetFirewallRule|Get-NetConnectionProfile|Get-NetIPConfiguration|dgram\.createSocket|socket\.connect/i,
  "Remote/LAN startup must not use PowerShell/UAC/firewall management or active UDP route probes");
assert.match(networkSource, /os\.networkInterfaces\(\)/,
  "LAN address enumeration must use the local OS interface table");
assert.doesNotMatch(networkSource, /child_process|execFile|spawn|route\.exe/i,
  "LAN address selection must not launch an external process");
assert.doesNotMatch(discoverySource, /\bawait\b/,
  "LAN discovery startup must remain synchronous from the Remote Web startup path");

console.log("LAN runtime boundary smoke passed: direct 8765 bind, local interface enumeration, non-blocking discovery, no external process/PowerShell/UAC/firewall management.");
