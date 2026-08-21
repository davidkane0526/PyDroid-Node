import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { LAN_WEB_PORT, inspectWindowsLanFirewall, ensureWindowsLanFirewall } = require("../desktop/lan/firewall.cjs");

assert.equal(LAN_WEB_PORT, 8765, "LAN Web port must stay stable at 8765");

const firewallSource = readFileSync(path.join(root, "desktop/lan/firewall.cjs"), "utf8");
assert.doesNotMatch(firewallSource, /child_process|powershell|Start-Process|RunAs|New-NetFirewallRule|Get-NetFirewallRule/i,
  "the personal-use runtime must not spawn PowerShell/UAC or manage Windows firewall rules");

const inspected = await inspectWindowsLanFirewall();
const ensured = await ensureWindowsLanFirewall();
assert.equal(inspected.managedByApplication, false);
assert.equal(ensured.managedByApplication, false);

const remoteServerSource = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
assert.doesNotMatch(remoteServerSource, /ensureWindowsLanFirewall|inspectWindowsLanFirewall|powershell|Start-Process|RunAs|New-NetFirewallRule|Get-NetFirewallRule/i,
  "Remote Web production startup must remain completely independent from firewall automation");

console.log("LAN runtime simplicity smoke passed: fixed TCP 8765 with no PowerShell/UAC/firewall automation in the production start path.");
