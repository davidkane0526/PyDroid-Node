const os = require("node:os");
const { execFileSync } = require("node:child_process");

const VIRTUAL_INTERFACE = /(^|\b)(vEthernet|vmware|virtualbox|virtual|hyper-v|wsl|docker|tailscale|zerotier|loopback|bluetooth)(\b|$)/i;
let cachedRoute = { at: 0, address: null };

function ipv4ToInt(value) {
  const parts = String(value).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isPrivateIpv4(address) {
  const value = ipv4ToInt(address);
  if (value == null) return false;
  const a = value >>> 24;
  const b = (value >>> 16) & 0xff;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isUsableIpv4(address) {
  return ipv4ToInt(address) != null && !address.startsWith("127.") && !address.startsWith("169.254.") && address !== "0.0.0.0";
}

function windowsDefaultRouteAddress() {
  if (process.platform !== "win32") return null;
  const now = Date.now();
  if (now - cachedRoute.at < 10_000) return cachedRoute.address;
  let address = null;
  try {
    const script = "$c=Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address -ne $null } | Sort-Object { $_.NetIPv4Interface.InterfaceMetric } | Select-Object -First 1; if($c){ @($c.IPv4Address)[0].IPAddress }";
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 3500 }).trim();
    if (isUsableIpv4(output)) address = output;
  } catch { /* use generic scoring */ }
  cachedRoute = { at: now, address };
  return address;
}

function getLanInterfaces() {
  const preferredAddress = windowsDefaultRouteAddress();
  const candidates = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !isUsableIpv4(entry.address)) continue;
      candidates.push({
        name,
        address: entry.address,
        netmask: entry.netmask || "255.255.255.0",
        private: isPrivateIpv4(entry.address),
        virtual: VIRTUAL_INTERFACE.test(name),
        defaultRoute: entry.address === preferredAddress,
      });
    }
  }
  const privatePhysical = candidates.filter((item) => item.private && !item.virtual);
  const privateAny = candidates.filter((item) => item.private);
  const selected = privatePhysical.length ? privatePhysical : privateAny.length ? privateAny : candidates.filter((item) => !item.virtual);
  const fallback = selected.length ? selected : candidates;
  const unique = new Map();
  for (const item of fallback) if (!unique.has(item.address)) unique.set(item.address, item);
  return dedupeInterfacesBySubnet([...unique.values()]);
}

function subnetKey(item) {
  const address = ipv4ToInt(item.address);
  const mask = ipv4ToInt(item.netmask);
  if (address == null || mask == null) return `${item.address}/${item.netmask}`;
  return `${((address & mask) >>> 0).toString(16)}/${mask.toString(16)}`;
}

function dedupeInterfacesBySubnet(interfaces) {
  const sorted = [...interfaces].sort((a, b) => interfaceScore(b) - interfaceScore(a) || a.name.localeCompare(b.name));
  const subnets = new Map();
  for (const item of sorted) {
    const key = subnetKey(item);
    if (!subnets.has(key)) subnets.set(key, item);
  }
  return [...subnets.values()];
}

function interfaceScore(item) {
  let score = 0;
  if (item.defaultRoute) score += 250;
  if (item.private) score += 100;
  if (!item.virtual) score += 50;
  if (/wi-?fi|wlan|wireless/i.test(item.name)) score += 20;
  if (/ethernet|以太网/i.test(item.name)) score += 18;
  return score;
}

function sameSubnet(addressA, addressB, netmask) {
  const a = ipv4ToInt(addressA);
  const b = ipv4ToInt(addressB);
  const mask = ipv4ToInt(netmask);
  return a != null && b != null && mask != null && ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

function selectInterfaceForRemote(interfaces, remoteAddress) {
  const subnetMatches = interfaces.filter((item) => sameSubnet(item.address, remoteAddress, item.netmask));
  return subnetMatches.find((item) => item.defaultRoute) ?? subnetMatches[0] ?? interfaces.find((item) => item.defaultRoute) ?? interfaces[0] ?? null;
}

function networkKey(interfaces) {
  return interfaces.map((item) => `${item.name}:${item.address}/${item.netmask}:${item.defaultRoute ? "default" : "secondary"}`).sort().join("|");
}

module.exports = { getLanInterfaces, isPrivateIpv4, selectInterfaceForRemote, networkKey, windowsDefaultRouteAddress, dedupeInterfacesBySubnet };
