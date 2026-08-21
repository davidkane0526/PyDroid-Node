import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { dedupeInterfacesBySubnet, parseWindowsDefaultRoute, selectInterfaceForRemote } = require("../desktop/lan/network.cjs");

const routePrint = `
IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      10.10.0.1       10.10.0.9    400
          0.0.0.0          0.0.0.0     192.168.3.1    192.168.3.185     35
`;
assert.equal(parseWindowsDefaultRoute(routePrint), "192.168.3.185", "Windows route table parsing must choose the lowest-metric default route interface");

const dualWlanSameSubnet = [
  { name: "WLAN 2", address: "192.168.3.16", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
  { name: "Wi-Fi", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: true },
];
const same = dedupeInterfacesBySubnet(dualWlanSameSubnet);
assert.equal(same.length, 1, "same-subnet adapters must not publish the same UPnP identity twice");
assert.equal(same[0].address, "192.168.3.185", "same-subnet deduplication must preserve the actual default route interface");
assert.equal(selectInterfaceForRemote(same, "192.168.3.88")?.address, "192.168.3.185");

const separateSubnets = dedupeInterfacesBySubnet([
  { name: "Ethernet", address: "192.168.4.20", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: false },
  { name: "Wi-Fi", address: "192.168.3.185", netmask: "255.255.255.0", private: true, virtual: false, defaultRoute: true },
]);
assert.equal(separateSubnets.length, 2, "different physical LAN subnets must remain publishable in parallel");
assert.equal(separateSubnets[0].address, "192.168.3.185", "primary advertised address must prefer the Windows default route interface");
assert.equal(selectInterfaceForRemote(separateSubnets, "192.168.4.55")?.address, "192.168.4.20", "known remote subnets should select their matching interface");
assert.equal(selectInterfaceForRemote(separateSubnets, "10.0.0.5")?.address, "192.168.3.185", "unknown remote subnets must fall back to the default route interface");

console.log("LAN interface selection smoke passed: route.exe default route selection, subnet dedupe and remote-subnet selection are deterministic");
