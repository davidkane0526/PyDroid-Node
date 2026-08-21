const { execFile } = require("node:child_process");

const LAN_WEB_PORT = 8765;
const FIREWALL_PROFILE = "Any";
const FIREWALL_REMOTE_ADDRESS = "LocalSubnet";
const RULE_VERSION = 2;
const RULES = [
  { name: `PyDroid Node LAN Web TCP 8765 v${RULE_VERSION}`, legacyName: "PyDroid Node LAN Web TCP 8765", protocol: "TCP", port: 8765 },
  { name: `PyDroid Node LAN Discovery SSDP UDP 1900 v${RULE_VERSION}`, legacyName: "PyDroid Node LAN Discovery SSDP UDP 1900", protocol: "UDP", port: 1900 },
  { name: `PyDroid Node LAN Discovery mDNS UDP 5353 v${RULE_VERSION}`, legacyName: "PyDroid Node LAN Discovery mDNS UDP 5353", protocol: "UDP", port: 5353 },
];

let ensurePromise = null;
let elevationAttemptedThisProcess = false;

function runPowerShell(script, timeoutMs = 8000) {
  if (process.platform !== "win32") return Promise.resolve({ ok: true, output: "", error: null });
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: timeoutMs },
      (error, stdout) => resolve({ ok: !error, output: String(stdout ?? "").trim(), error: error?.message ?? null }),
    );
  });
}

async function existingRuleNames() {
  if (process.platform !== "win32") return { applicable: false, ready: true, names: [] };
  const names = RULES.map((rule) => `'${rule.name.replace(/'/g, "''")}'`).join(",");
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$names=@(${names})`,
    "$present=@()",
    "foreach($n in $names){ if(Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | Select-Object -First 1){ $present += $n } }",
    "$present|ConvertTo-Json -Compress",
  ].join(";");
  const probe = await runPowerShell(script, 5000);
  if (!probe.ok) return { applicable: true, ready: false, names: [], error: probe.error };
  let present = [];
  try {
    const parsed = probe.output ? JSON.parse(probe.output) : [];
    present = Array.isArray(parsed) ? parsed.map(String) : parsed ? [String(parsed)] : [];
  } catch {}
  return { applicable: true, ready: RULES.every((rule) => present.includes(rule.name)), names: present, error: null };
}

function runElevatedLanRules() {
  if (process.platform !== "win32") return Promise.resolve({ ok: true, error: null });
  const inner = RULES.map((rule) => {
    const name = rule.name.replace(/'/g, "''");
    const legacyName = rule.legacyName.replace(/'/g, "''");
    return `Get-NetFirewallRule -DisplayName '${legacyName}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; Get-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '${name}' -Direction Inbound -Action Allow -Enabled True -Profile ${FIREWALL_PROFILE} -Protocol ${rule.protocol} -LocalPort ${rule.port} -RemoteAddress ${FIREWALL_REMOTE_ADDRESS} | Out-Null`;
  }).join(";");
  const encodedInner = Buffer.from(`$ErrorActionPreference='Stop';${inner}`, "utf16le").toString("base64");
  const outer = `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedInner}'; exit $p.ExitCode`;
  return runPowerShell(outer, 120000);
}

/**
 * Best-effort Windows integration only. This function must never be awaited by
 * Remote Web startup/readiness. A failed/cancelled elevation cannot make the
 * already-listening HTTP service fail, and one process attempts elevation at
 * most once.
 */
function ensureWindowsLanFirewall({ log = () => {} } = {}) {
  if (ensurePromise) return ensurePromise;
  const operation = (async () => {
    if (process.platform !== "win32" || process.env.PYDROID_DESKTOP_SMOKE === "1" || process.env.CI === "true") {
      return { applicable: process.platform === "win32", attempted: false, ready: process.platform !== "win32" };
    }
    const before = await existingRuleNames();
    if (!before.applicable || before.ready) return { ...before, attempted: false };
    if (elevationAttemptedThisProcess) return { ...before, attempted: false, reason: "elevation-already-attempted" };

    elevationAttemptedThisProcess = true;
    const elevated = await runElevatedLanRules();
    if (!elevated.ok) {
      log(`[LAN] Optional Windows LocalSubnet firewall provisioning was not completed: ${elevated.error || "cancelled"}`);
      return { ...before, attempted: true, ready: false, error: elevated.error };
    }
    const after = await existingRuleNames();
    if (after.ready) log("[LAN] Optional Windows LocalSubnet firewall rules are ready.");
    return { ...after, attempted: true, error: after.error ?? null };
  })().finally(() => {
    if (ensurePromise === operation) ensurePromise = null;
  });
  ensurePromise = operation;
  return operation;
}

module.exports = {
  LAN_WEB_PORT,
  FIREWALL_PROFILE,
  FIREWALL_REMOTE_ADDRESS,
  RULE_VERSION,
  RULES,
  ensureWindowsLanFirewall,
};
