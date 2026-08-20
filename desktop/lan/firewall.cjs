const { execFile, execFileSync } = require("node:child_process");

const LAN_WEB_PORT = 8765;
const FIREWALL_PROFILE = "Private";
const FIREWALL_REMOTE_ADDRESS = "LocalSubnet";
const RULES = [
  { name: "PyDroid Node LAN Web TCP 8765", protocol: "TCP", port: 8765 },
  { name: "PyDroid Node LAN Discovery SSDP UDP 1900", protocol: "UDP", port: 1900 },
  { name: "PyDroid Node LAN Discovery mDNS UDP 5353", protocol: "UDP", port: 5353 },
];

function powershellJson(script) {
  if (process.platform !== "win32") return null;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    }).trim();
    return output ? JSON.parse(output) : null;
  } catch {
    return null;
  }
}

function normalizeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function inspectWindowsLanFirewall() {
  if (process.platform !== "win32") {
    return Promise.resolve({
      applicable: false,
      rulesReady: true,
      privateNetworkActive: true,
      activeProfiles: [],
      rules: RULES.map((rule) => ({ ...rule, present: true })),
    });
  }
  const desired = RULES.map((rule) => `@{name='${rule.name.replace(/'/g, "''")}';protocol='${rule.protocol}';port='${rule.port}'}`).join(",");
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$desired=@(${desired}) | ForEach-Object { [pscustomobject]$_ }`,
    "$rules=@()",
    "foreach($d in $desired){ $r=Get-NetFirewallRule -DisplayName $d.name -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and ($_.Profile.ToString() -match 'Private') } | Select-Object -First 1; $ok=$false; if($r){ $pf=$r|Get-NetFirewallPortFilter; $af=$r|Get-NetFirewallAddressFilter; $ok=([string]$pf.Protocol -eq $d.protocol -and [string]$pf.LocalPort -eq $d.port -and (@($af.RemoteAddress) -contains 'LocalSubnet')) }; $rules += [pscustomobject]@{name=$d.name;present=[bool]$ok} }",
    "$profiles=Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | ForEach-Object { [pscustomobject]@{interface=$_.InterfaceAlias;category=$_.NetworkCategory.ToString();ipv4=$_.IPv4Connectivity.ToString()} }",
    "[pscustomobject]@{rules=$rules;profiles=$profiles}|ConvertTo-Json -Compress -Depth 5",
  ].join(";");
  const raw = powershellJson(script) ?? { rules: [], profiles: [] };
  const rawRules = normalizeArray(raw.rules);
  const profiles = normalizeArray(raw.profiles).map((item) => ({
    interface: String(item?.interface ?? ""),
    category: String(item?.category ?? "Unknown"),
    ipv4: String(item?.ipv4 ?? "Unknown"),
  }));
  const rules = RULES.map((rule) => ({ ...rule, present: Boolean(rawRules.find((item) => String(item?.name) === rule.name)?.present) }));
  const activeProfiles = [...new Set(profiles.map((item) => item.category).filter(Boolean))];
  return Promise.resolve({
    applicable: true,
    rulesReady: rules.every((rule) => rule.present),
    privateNetworkActive: profiles.some((profile) => /^private$/i.test(profile.category)),
    activeProfiles,
    profiles,
    rules,
  });
}

function runElevatedPrivateRules() {
  return new Promise((resolve) => {
    const inner = RULES.map((rule) => {
      const name = rule.name.replace(/'/g, "''");
      return `Get-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '${name}' -Direction Inbound -Action Allow -Enabled True -Profile ${FIREWALL_PROFILE} -Protocol ${rule.protocol} -LocalPort ${rule.port} -RemoteAddress ${FIREWALL_REMOTE_ADDRESS} | Out-Null`;
    }).join(";");
    const encodedInner = Buffer.from(`$ErrorActionPreference='Stop';${inner}`, "utf16le").toString("base64");
    const outer = `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedInner}'; exit $p.ExitCode`;
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", outer], { windowsHide: true, timeout: 120000 }, (error) => resolve({ ok: !error, error: error?.message ?? null }));
  });
}

async function ensureWindowsLanFirewall({ log = () => {}, allowElevation = true } = {}) {
  const before = await inspectWindowsLanFirewall();
  if (!before.applicable || before.rulesReady) return { ...before, elevationAttempted: false, elevationSucceeded: before.rulesReady };
  if (!before.privateNetworkActive) {
    return { ...before, elevationAttempted: false, elevationSucceeded: false, reason: "active-network-is-not-private" };
  }
  if (!allowElevation || process.env.PYDROID_DESKTOP_SMOKE === "1" || process.env.CI === "true") {
    return { ...before, elevationAttempted: false, elevationSucceeded: false, reason: "firewall-rules-missing" };
  }
  log("[LAN] Windows Private-network firewall rules are missing; requesting one-time elevation.");
  const elevated = await runElevatedPrivateRules();
  const after = await inspectWindowsLanFirewall();
  if (!after.rulesReady) log(`[LAN] Windows firewall rules are still incomplete${elevated.error ? `: ${elevated.error}` : ""}`);
  else log("[LAN] Windows Private-network firewall rules are ready.");
  return {
    ...after,
    elevationAttempted: true,
    elevationSucceeded: after.rulesReady,
    reason: after.rulesReady ? null : "firewall-rules-missing",
    error: elevated.error,
  };
}

module.exports = { LAN_WEB_PORT, FIREWALL_PROFILE, FIREWALL_REMOTE_ADDRESS, RULES, inspectWindowsLanFirewall, ensureWindowsLanFirewall };
