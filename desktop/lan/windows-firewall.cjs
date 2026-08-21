const { execFile } = require("node:child_process");

const RULES = [
  { name: "PyDroid Node Web TCP 8765", protocol: "TCP", port: 8765 },
  { name: "PyDroid Node SSDP UDP 1900", protocol: "UDP", port: 1900 },
  { name: "PyDroid Node mDNS UDP 5353", protocol: "UDP", port: 5353 },
];

function runPowerShell(script, timeout = 8000) {
  if (process.platform !== "win32") return Promise.resolve({ ok: true, output: "1" });
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout,
    }, (error, stdout) => resolve({ ok: !error, output: String(stdout ?? "").trim(), error: error?.message || null }));
  });
}

async function rulesReady() {
  if (process.platform !== "win32") return true;
  const checks = RULES.map((rule) => {
    const name = rule.name.replace(/'/g, "''");
    return `$r=Get-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | Select-Object -First 1; if(-not $r){exit 2}; $p=$r|Get-NetFirewallPortFilter; if(([string]$p.Protocol -ne '${rule.protocol}' -and [string]$p.Protocol -ne '${rule.protocol === "TCP" ? "6" : "17"}') -or [string]$p.LocalPort -ne '${rule.port}'){exit 3}`;
  }).join(";");
  const result = await runPowerShell(`$ErrorActionPreference='Stop';${checks};Write-Output 1`);
  return result.ok && result.output === "1";
}

async function installRulesElevated() {
  const inner = RULES.map((rule) => {
    const name = rule.name.replace(/'/g, "''");
    return `Get-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '${name}' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol ${rule.protocol} -LocalPort ${rule.port} | Out-Null`;
  }).join(";");
  const encoded = Buffer.from(`$ErrorActionPreference='Stop';${inner}`, "utf16le").toString("base64");
  const outer = `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}'; exit $p.ExitCode`;
  return runPowerShell(outer, 120000);
}

async function ensureWindowsLanAccess({ log = () => {} } = {}) {
  if (process.platform !== "win32") return;
  if (await rulesReady()) return;
  const installed = await installRulesElevated();
  if (!installed.ok || !(await rulesReady())) {
    throw new Error("Windows 防火墙未允许 PyDroid Node 的局域网端口，请允许管理员授权后重试");
  }
  log("[LAN] Windows inbound rules ready for TCP 8765 / UDP 1900 / UDP 5353");
}

module.exports = { RULES, ensureWindowsLanAccess };
