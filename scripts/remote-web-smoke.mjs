import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const desktop = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
const android = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/RemoteWorkflowServer.java"), "utf8");
const androidService = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/host/AndroidRemoteService.java"), "utf8");
const session = readFileSync(path.join(root, "src/platform/remote-session.ts"), "utf8");
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const desktopDiscovery = readFileSync(path.join(root, "desktop/lan/LanDiscoveryService.cjs"), "utf8");
const desktopUpnp = readFileSync(path.join(root, "desktop/lan/upnp.cjs"), "utf8");
const desktopMdns = readFileSync(path.join(root, "desktop/lan/mdns.cjs"), "utf8");
const androidDiscovery = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/LanDiscoveryService.java"), "utf8");
const androidUpnp = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/UpnpDeviceDescription.java"), "utf8");
const androidMdns = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/MdnsService.java"), "utf8");
const desktopPackage = readFileSync(path.join(root, "scripts/desktop-package.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(desktop, /function resolveRendererRoot\(/, "Desktop Remote Web must resolve the packaged browser bundle");
assert.match(desktop, /package-remote/, "Desktop Remote Web must serve the browser-native renderer bundle");
assert.match(desktopPackage, /remoteRendererStage[\s\S]*package-remote/, "desktop packaging must stage the Remote Web browser bundle");
assert.ok(packageJson.build.files.includes("desktop/package-remote/**/*"), "electron-builder must include the staged Remote Web browser bundle");
const buildScript = readFileSync(path.join(root, "tools/build-pydroid.ps1"), "utf8");
const packagedSmoke = readFileSync(path.join(root, "desktop/window/create-window.cjs"), "utf8");
assert.match(buildScript, /Invoke-DesktopCompatibilityPackage[\s\S]*remoteRendererSource[\s\S]*package-remote/, "Desktop compatibility packaging must stage the browser-native Remote Web bundle");
assert.match(packagedSmoke, /startRemoteServer\(true\)/, "Packaged desktop smoke must actually start Remote Web");
assert.match(desktop, /verifyLoopbackReady/, "Desktop Remote Web must verify a real loopback HTTP response before reporting startup success");
assert.match(android, /verifyLoopbackReady\(\)/, "Android Remote Web must verify a real loopback HTTP response before reporting startup success");
assert.doesNotMatch(desktop, /verifyEndpointAtHost|LAN self-test/i, "Desktop startup readiness must not depend on hairpin access through the selected LAN address");
assert.doesNotMatch(android, /verifyEndpointAtHost|LAN self-test/i, "Android startup readiness must not depend on hairpin access through the selected LAN address");
assert.match(androidService, /remoteRequests\.execute\(\(\) ->/, "Android Remote Web startup must run off the Capacitor/UI call path");
assert.match(android, /new JSONArray\(discovery\.urls\(\)\)/, "Android Remote Web should expose alternate LAN URLs when multiple interfaces exist");
assert.match(desktop, /index\.html[\s\S]*Remote Web renderer not found/, "Desktop Remote Web must fail clearly when its renderer is missing");
assert.match(android, /resolveAssetRoot\(\)/, "Android Remote Web must resolve the packaged asset root");
assert.match(android, /Remote Web index\.html is missing from packaged Android assets/, "Android Remote Web must fail clearly when packaged web assets are missing");
assert.match(desktop, /Cache-Control[\s\S]*no-store/, "Desktop Remote Web index should avoid stale shell caching without URL version noise");
assert.match(android, /Cache-Control: no-store/, "Android Remote Web responses should avoid stale shell caching without URL version noise");

for (const [name, source] of [
  ["Desktop service", desktop], ["Desktop discovery", desktopDiscovery], ["Desktop UPnP", desktopUpnp], ["Desktop mDNS", desktopMdns],
  ["Android service", android], ["Android discovery", androidDiscovery], ["Android UPnP", androidUpnp], ["Android mDNS", androidMdns],
]) {
  assert.doesNotMatch(source, /[?&]remote=1|[?&]v=/, `${name} must advertise short, memorable URLs without query parameters`);
}
assert.match(session, /location\.hostname/, "Remote browser detection must use the HTTP host so clean URLs work without query parameters");
assert.doesNotMatch(session, /parameters\.get\("remote"\)/, "Remote browser detection must not require ?remote=1");
assert.match(app, />计算服务已开启</, "Remote banner should use the concise service status text");
assert.match(app, />复制地址</, "Remote banner should use the concise copy action");
assert.doesNotMatch(app, /网页资源自检通过|复制首选地址|访问设备与本机需在同一局域网/, "Remote banner must not expose defensive diagnostics or redundant LAN instructions");
console.log("Remote Web smoke passed.");
