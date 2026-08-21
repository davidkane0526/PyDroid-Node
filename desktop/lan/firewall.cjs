const { execFile, execFileSync } = require("node:child_process");

const LAN_WEB_PORT = 8765;
// The LAN service is explicitly enabled by the user. Keep Windows exceptions
// confined to LocalSubnet, but do not make reachability depend on the mutable
// Public/Private network category.
const FIREWALL_PROFILE = "Any";
const FIREWALL_REMOTE_ADDRESS = "LocalSubnet";
const RULE_VERSION = 2;
const RULES = [
  { name: `PyDroid Node LAN Web TCP 8765 v${RULE_VERSION}`, legacyName: "PyDroid Node LAN Web TCP 8765", protocol: "TCP", port: 8765 },
  { name: `PyDroid Node LAN Discovery SSDP UDP 1900 v${RULE_VERSION}`, legacyName: "PyDroid Node LAN Discovery SSDP UDP 1900", protocol: "UDP", port: 1900 },
  { name: `PyDroid Node LAN Discovery mDNS UDP 5353 v${RULE_VERSION}`, legacyName: "PyDroid Node LAN Discovery mDNS UDP 5353", protocol: "UDP", port: 5353 },
];

let cachedInspection = { at: 0, value: null };
let cachedFastInspection = { at: 0, value: null };
let ensurePromise = null;
let elevationAttemptedThisProcess = false;

function powershellJson(script, timeoutMs = 8000) {
  if (process.platform !== "win32") return { ok: true, value: null, error: null };
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
    }).trim();
    return { ok: true, value: output ? JSON.parse(output) : null, error: null };
  } catch (error) {
    return { ok: false, value: null, error: error?.message ?? String(error) };
  }
}

function normalizeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function nonWindowsStatus() {
  return {
    applicable: false,
    inspectionComplete: true,
    firewallEnabled: false,
    rulesReady: true,
    networkBoundaryReady: true,
    privateNetworkActive: true,
    activeProfiles: [],
    profiles: [],
    rules: RULES.map((rule) => ({ name: rule.name, protocol: rule.protocol, port: rule.port, present: true })),
    reason: null,
    error: null,
  };
}

function fastRulePresence({ force = false } = {}) {
  if (process.platform !== "win32") return Promise.resolve(nonWindowsStatus());
  const now = Date.now();
  if (!force && cachedFastInspection.value && now - cachedFastInspection.at < 60_000) return Promise.resolve(cachedFastInspection.value);
  const desired = RULES.map((rule) => `@{name='${rule.name.replace(/'/g, "''")}';protocol='${rule.protocol}';port='${rule.port}'}`).join(",");
  const script = [
    "$ErrorActionPreference='Stop'",
    `$desired=@(${desired}) | ForEach-Object { [pscustomobject]$_ }`,
    "$rules=@()",
    "foreach($d in $desired){",
    "  $r=Get-NetFirewallRule -DisplayName $d.name -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | Select-Object -First 1",
    "  $ok=$false",
    "  if($r){ $pf=$r|Get-NetFirewallPortFilter; $af=$r|Get-NetFirewallAddressFilter; $profile=[string]$r.Profile; $protocol=[string]$pf.Protocol; $profileOk=($profile -eq 'Any' -or ($profile -match 'Domain' -and $profile -match 'Private' -and $profile -match 'Public')); $protocolOk=($protocol -eq $d.protocol -or ($d.protocol -eq 'TCP' -and $protocol -eq '6') -or ($d.protocol -eq 'UDP' -and $protocol -eq '17')); $remoteOk=(@($af.RemoteAddress) | Where-Object { [string]$_ -match '^LocalSubnet' } | Select-Object -First 1) -ne $null; $ok=($profileOk -and $protocolOk -and [string]$pf.LocalPort -eq $d.port -and $remoteOk) }",
    "  $rules += [pscustomobject]@{name=$d.name;present=[bool]$ok}",
    "}",
    "$firewallEnabled=@(Get-NetFirewallProfile -ErrorAction Stop | Where-Object { $_.Enabled }).Count -gt 0",
    "[pscustomobject]@{rules=$rules;firewallEnabled=[bool]$firewallEnabled}|ConvertTo-Json -Compress -Depth 4",
  ].join(";");
  const probe = powershellJson(script, 4000);
  const rawRules = normalizeArray(probe.value?.rules);
  const rules = RULES.map((rule) => ({ name: rule.name, protocol: rule.protocol, port: rule.port, present: Boolean(rawRules.find((item) => String(item?.name) === rule.name)?.present) }));
  const firewallEnabled = probe.ok ? Boolean(probe.value?.firewallEnabled) : true;
  const rulesReady = probe.ok && rules.every((rule) => rule.present);
  const networkBoundaryReady = probe.ok && (!firewallEnabled || rulesReady);
  const result = {
    applicable: true,
    inspectionComplete: probe.ok,
    firewallEnabled,
    rulesReady,
    networkBoundaryReady,
    privateNetworkActive: true,
    activeProfiles: [],
    profiles: [],
    rules,
    reason: networkBoundaryReady ? null : (probe.ok ? "firewall-rules-missing" : "firewall-inspection-failed"),
    error: probe.error,
  };
  cachedFastInspection = { at: now, value: result };
  return Promise.resolve(result);
}

async function inspectWindowsLanFirewall({ force = false } = {}) {
  if (process.platform !== "win32") return nonWindowsStatus();
  const now = Date.now();
  if (!force && cachedInspection.value && now - cachedInspection.at < 15_000) return cachedInspection.value;

  const desired = RULES.map((rule) => `@{name='${rule.name.replace(/'/g, "''")}';protocol='${rule.protocol}';port='${rule.port}'}`).join(",");
  const script = [
    "$ErrorActionPreference='Stop'",
    `$desired=@(${desired}) | ForEach-Object { [pscustomobject]$_ }`,
    "$rules=@()",
    "foreach($d in $desired){",
    "  $r=Get-NetFirewallRule -DisplayName $d.name -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | Select-Object -First 1",
    "  $ok=$false; $profile=''; $remote=@()",
    "  if($r){",
    "    $pf=$r|Get-NetFirewallPortFilter; $af=$r|Get-NetFirewallAddressFilter; $profile=[string]$r.Profile; $remote=@($af.RemoteAddress)",
    "    $profileOk=($profile -eq 'Any' -or ($profile -match 'Domain' -and $profile -match 'Private' -and $profile -match 'Public'))",
    "    $protocol=[string]$pf.Protocol; $protocolOk=($protocol -eq $d.protocol -or ($d.protocol -eq 'TCP' -and $protocol -eq '6') -or ($d.protocol -eq 'UDP' -and $protocol -eq '17'))",
    "    $remoteOk=(@($remote) | Where-Object { [string]$_ -match '^LocalSubnet' } | Select-Object -First 1) -ne $null",
    "    $ok=($protocolOk -and [string]$pf.LocalPort -eq $d.port -and $profileOk -and $remoteOk)",
    "  }",
    "  $rules += [pscustomobject]@{name=$d.name;present=[bool]$ok;profile=$profile;remoteAddress=$remote}",
    "}",
    "$profiles=Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { [pscustomobject]@{name=$_.Name.ToString();enabled=[bool]$_.Enabled;defaultInboundAction=$_.DefaultInboundAction.ToString()} }",
    "[pscustomobject]@{rules=$rules;profiles=$profiles}|ConvertTo-Json -Compress -Depth 6",
  ].join(";");

  const probe = powershellJson(script);
  const raw = probe.value ?? { rules: [], profiles: [] };
  const rawRules = normalizeArray(raw.rules);
  const profiles = normalizeArray(raw.profiles).map((item) => ({
    name: String(item?.name ?? "Unknown"),
    enabled: Boolean(item?.enabled),
    defaultInboundAction: String(item?.defaultInboundAction ?? "Unknown"),
  }));
  const rules = RULES.map((rule) => {
    const match = rawRules.find((item) => String(item?.name) === rule.name);
    return {
      name: rule.name,
      protocol: rule.protocol,
      port: rule.port,
      present: Boolean(match?.present),
      profile: String(match?.profile ?? ""),
      remoteAddress: normalizeArray(match?.remoteAddress).map(String),
    };
  });
  const firewallEnabled = profiles.some((profile) => profile.enabled);
  const rulesReady = rules.every((rule) => rule.present);
  const result = {
    applicable: true,
    inspectionComplete: probe.ok,
    firewallEnabled,
    rulesReady,
    networkBoundaryReady: probe.ok && (!firewallEnabled || rulesReady),
    privateNetworkActive: true,
    activeProfiles: profiles.filter((profile) => profile.enabled).map((profile) => profile.name),
    profiles,
    rules,
    reason: probe.ok ? (rulesReady || !firewallEnabled ? null : "firewall-rules-missing") : "firewall-inspection-failed",
    error: probe.error,
  };
  cachedInspection = { at: now, value: result };
  return result;
}

function runElevatedLanRules() {
  return new Promise((resolve) => {
    const inner = RULES.map((rule) => {
      const name = rule.name.replace(/'/g, "''");
      const legacyName = rule.legacyName.replace(/'/g, "''");
      return `Get-NetFirewallRule -DisplayName '${legacyName}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; Get-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '${name}' -Direction Inbound -Action Allow -Enabled True -Profile ${FIREWALL_PROFILE} -Protocol ${rule.protocol} -LocalPort ${rule.port} -RemoteAddress ${FIREWALL_REMOTE_ADDRESS} | Out-Null`;
    }).join(";");
    const encodedInner = Buffer.from(`$ErrorActionPreference='Stop';${inner}`, "utf16le").toString("base64");
    const outer = `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedInner}'; exit $p.ExitCode`;
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", outer], { windowsHide: true, timeout: 120000 }, (error) => {
      resolve({ ok: !error, error: error?.message ?? null });
    });
  });
}

function ensureWindowsLanFirewall(options = {}) {
  if (ensurePromise) return ensurePromise;
  const operation = ensureWindowsLanFirewallOnce(options).finally(() => {
    if (ensurePromise === operation) ensurePromise = null;
  });
  ensurePromise = operation;
  return operation;
}

async function ensureWindowsLanFirewallOnce({ log = () => {}, allowElevation = true } = {}) {
  const before = await fastRulePresence({ force: true });
  if (!before.applicable || before.networkBoundaryReady) {
    return { ...before, elevationAttempted: false, elevationSucceeded: before.networkBoundaryReady };
  }
  if (!allowElevation || process.env.PYDROID_DESKTOP_SMOKE === "1" || process.env.CI === "true") {
    return { ...before, elevationAttempted: false, elevationSucceeded: false };
  }
  if (elevationAttemptedThisProcess) {
    return { ...before, elevationAttempted: false, elevationSucceeded: false, reason: before.reason ?? "elevation-already-attempted" };
  }

  elevationAttemptedThisProcess = true;
  log("[LAN] Configuring one-time LocalSubnet inbound rules for TCP 8765 / UDP 1900 / UDP 5353.");
  const elevated = await runElevatedLanRules();
  cachedInspection = { at: 0, value: null };
  cachedFastInspection = { at: 0, value: null };
  const after = await fastRulePresence({ force: true });
  const succeeded = after.networkBoundaryReady || (!after.inspectionComplete && elevated.ok);
  if (succeeded) log("[LAN] Windows LAN inbound boundary is ready.");
  else log(`[LAN] Windows LAN inbound boundary is not verified${elevated.error ? `: ${elevated.error}` : ""}`);
  return {
    ...after,
    networkBoundaryReady: after.networkBoundaryReady || (!after.inspectionComplete && elevated.ok),
    elevationAttempted: true,
    elevationSucceeded: succeeded,
    reason: succeeded ? null : after.reason ?? "firewall-rules-missing",
    error: after.error ?? elevated.error,
  };
}

module.exports = {
  LAN_WEB_PORT,
  FIREWALL_PROFILE,
  FIREWALL_REMOTE_ADDRESS,
  RULE_VERSION,
  RULES,
  inspectWindowsLanFirewall,
  ensureWindowsLanFirewall,
};
