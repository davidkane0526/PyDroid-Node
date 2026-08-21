import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const frozen = {
  "desktop/services/remote-server.cjs": "913da0fe0b03beaa9647054bd4d4feb79c4ff343a523ecdf6c7ffd4ce0fe7e7c",
  "desktop/lan/firewall.cjs": "37bc8a2d2aad3f220fe8e87d0d736530f00538fb6440de3f12695e07e5e13f11",
  "desktop/lan/LanDiscoveryService.cjs": "41b314b41160cab070916d0f5a0c352bc74b453f9043e03b2958cd741030963c",
  "desktop/lan/ssdp.cjs": "878be5e501e146ef103f1a993993fd3643677f611e8c2a91b89dbdc19a195b24",
  "desktop/lan/mdns.cjs": "c7f05cf0b80345846a5453a71cf9e76600c71db78e67afad00407a8b2fed9ad1",
  "desktop/lan/upnp.cjs": "cd6c480f5028c70f753c5cd00901c6abff3324019c3ad4b9abc892efbfe3fdc2",
  "android/app/src/main/java/com/dk/pydroidflow/RemoteWorkflowServer.java": "5ae34bc94fa5ed1fe340dcd4e2c9450af076c0737e134c0a9f3b6785c0762554",
  "android/app/src/main/java/com/dk/pydroidflow/LanDiscoveryService.java": "ca60a5b0614a46e254f825165767e57623cf80195ea09aedb04949d5fe685a51",
  "android/app/src/main/java/com/dk/pydroidflow/MdnsService.java": "5c2f1f74c2f90fde9e30eaecc08cf8c3d4a3eda1bcbc5bd38db89913640c95da",
  "android/app/src/main/java/com/dk/pydroidflow/UpnpDeviceDescription.java": "c8f6845d420eb8129855cfa2b3535970f8b637aefbf41924ae4d231cf8e71734",
};

for (const [file, expected] of Object.entries(frozen)) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  assert.equal(actual, expected, `${file} is a frozen Remote Web/LAN production file; change it only after an explicit defect-backed unfreeze`);
}

console.log(`Remote production freeze smoke passed (${Object.keys(frozen).length} frozen host/network files).`);
