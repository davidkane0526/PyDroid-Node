const os = require("node:os");

const VIRTUAL_INTERFACE = /(^|\b)(vEthernet|vmware|virtualbox|virtual|hyper-v|wsl|docker|tailscale|zerotier|loopback|bluetooth)(\b|$)/i;

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

function subnetKey(item) {
  const address = ipv4ToInt(item.address);
  const mask = ipv4ToInt(item.netmask);
  if (address == null || mask == null) return `${item.address}/${item.netmask}`;
  return `${((address & mask) >>> 0).toString(16)}/${mask.toString(16)}`;
}

function interfaceScore(item) {
  let score = 0;
  if (item.private) score += 100;
  if (!item.virtual) score += 50;
  if (/wi-?fi|wlan|wireless/i.test(item.name)) score += 20;
  if (/ethernet|以太网/i.test(item.name)) score += 18;
  return score;
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

function getLanInterfaces() {
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
        defaultRoute: false,
      });
    }
  }

  const privatePhysical = candidates.filter((item) => item.private && !item.virtual);
  const privateAny = candidates.filter((item) => item.private);
  const physicalAny = candidates.filter((item) => !item.virtual);
  const selected = privatePhysical.length ? privatePhysical : privateAny.length ? privateAny : physicalAny.length ? physicalAny : candidates;
  return dedupeInterfacesBySubnet(selected);
}

function sameSubnet(addressA, addressB, netmask) {
  const a = ipv4ToInt(addressA);
  const b = ipv4ToInt(addressB);
  const mask = ipv4ToInt(netmask);
  return a != null && b != null && mask != null && ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

function selectInterfaceForRemote(interfaces, remoteAddress) {
  const subnetMatches = interfaces.filter((item) => sameSubnet(item.address, remoteAddress, item.netmask));
  return subnetMatches[0] ?? interfaces[0] ?? null;
}

module.exports = { getLanInterfaces, isPrivateIpv4, selectInterfaceForRemote, dedupeInterfacesBySubnet };
