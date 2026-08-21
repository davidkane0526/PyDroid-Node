import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { dedupeInterfacesBySubnet, selectInterfaceForRemote } = require("../desktop/lan/network.cjs");

const dualWlanSameSubnet = [
  { name: "WLAN 2", address: "192.168.3.16", netmask: "255.255.255.0", private: true, virtual: false },
  { name: "WLAN", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false },
];
const same = dedupeInterfacesBySubnet(dualWlanSameSubnet);
assert.equal(same.length, 1, "same-subnet adapters must not publish the same UPnP identity twice");
assert.equal(same[0].address, "192.168.3.185", "same-subnet deduplication must use deterministic interface scoring without OS route probing");
assert.equal(selectInterfaceForRemote(same, "192.168.3.88")?.address, "192.168.3.185");

const separateSubnets = dedupeInterfacesBySubnet([
  { name: "Wi-Fi", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false },
  { name: "Ethernet", address: "192.168.4.20", netmask: "255.255.255.0", private: true, virtual: false },
]);
assert.equal(separateSubnets.length, 2, "different physical LAN subnets must remain publishable in parallel");
console.log("LAN interface selection smoke passed: deterministic OS-interface selection with no route probing; distinct LAN subnets remain");
