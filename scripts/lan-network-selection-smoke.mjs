import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { dedupeInterfacesBySubnet, selectInterfaceForRemote } = require("../desktop/lan/network.cjs");

const dualWlanSameSubnet = [
  { name: "WLAN 2", address: "192.168.3.16", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
  { name: "WLAN", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: true },
];
const same = dedupeInterfacesBySubnet(dualWlanSameSubnet);
assert.equal(same.length, 1, "same-subnet adapters must not publish the same UPnP identity twice");
assert.equal(same[0].address, "192.168.3.185", "same-subnet deduplication must retain the default-route address");
assert.equal(selectInterfaceForRemote(same, "192.168.3.88")?.address, "192.168.3.185");

const separateSubnets = dedupeInterfacesBySubnet([
  { name: "Wi-Fi", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
  { name: "Ethernet", address: "192.168.4.20", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: true },
]);
assert.equal(separateSubnets.length, 2, "different physical LAN subnets must remain publishable in parallel");
assert.equal(separateSubnets[0].address, "192.168.4.20", "the primary advertised address must follow the active default route, not adapter-name scoring");
assert.equal(selectInterfaceForRemote(separateSubnets, "10.0.0.5")?.address, "192.168.4.20", "unknown remote subnets must fall back to the active default-route interface");

console.log("LAN interface selection smoke passed: default-route address is the primary entrypoint; distinct LAN subnets remain publishable");
