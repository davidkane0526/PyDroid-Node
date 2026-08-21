import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { dedupeInterfacesBySubnet, selectInterfaceForRemote } = require("../desktop/lan/network.cjs");

const dualWlanSameSubnet = [
  { name: "WLAN 2", address: "192.168.3.16", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
  { name: "Wi-Fi", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
];
const same = dedupeInterfacesBySubnet(dualWlanSameSubnet);
assert.equal(same.length, 1, "same-subnet adapters must not publish the same UPnP identity twice");
assert.equal(same[0].address, "192.168.3.185", "same-subnet deduplication should prefer the normal Wi-Fi adapter deterministically");
assert.equal(selectInterfaceForRemote(same, "192.168.3.88")?.address, "192.168.3.185");

const separateSubnets = dedupeInterfacesBySubnet([
  { name: "Wi-Fi", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
  { name: "Ethernet", address: "192.168.4.20", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
]);
assert.equal(separateSubnets.length, 2, "different physical LAN subnets must remain publishable in parallel");
assert.equal(separateSubnets[0].address, "192.168.3.185", "primary advertised address should use deterministic local interface ordering without route probes");
assert.equal(selectInterfaceForRemote(separateSubnets, "192.168.4.55")?.address, "192.168.4.20", "known remote subnets should select their matching interface");
assert.equal(selectInterfaceForRemote(separateSubnets, "10.0.0.5")?.address, "192.168.3.185", "unknown remote subnets should fall back to the first deterministic LAN interface");

console.log("LAN interface selection smoke passed: local interface table only; same-subnet dedupe and remote-subnet selection are deterministic");
