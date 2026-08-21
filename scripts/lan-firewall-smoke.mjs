import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const remoteServerSource = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
const networkSource = readFileSync(path.join(root, "desktop/lan/network.cjs"), "utf8");

assert.match(remoteServerSource, /const LAN_WEB_PORT = 8765;/,
  "Remote Web production port must remain an explicit fixed constant");
assert.match(remoteServerSource, /listen\(LAN_WEB_PORT, "0\.0\.0\.0"/,
  "Remote Web production startup must bind the fixed port directly");
assert.doesNotMatch(remoteServerSource, /firewall\.cjs|ensureWindowsLanFirewall|inspectWindowsLanFirewall|child_process|powershell|Start-Process|RunAs|New-NetFirewallRule|Get-NetFirewallRule/i,
  "Remote Web production startup must not probe or modify Windows firewall state");
assert.doesNotMatch(networkSource, /child_process|powershell|Get-NetIPConfiguration|execFile/i,
  "LAN address selection must use Node OS interfaces directly and must not probe Windows routing state");

console.log("LAN host-boundary smoke passed: fixed TCP 8765, direct bind, no firewall/UAC/routing automation.");
