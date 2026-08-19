import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const desktop = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
const android = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/RemoteWorkflowServer.java"), "utf8");
const session = readFileSync(path.join(root, "src/platform/remote-session.ts"), "utf8");
const desktopDiscovery = readFileSync(path.join(root, "desktop/lan/LanDiscoveryService.cjs"), "utf8");
const desktopUpnp = readFileSync(path.join(root, "desktop/lan/upnp.cjs"), "utf8");
const androidDiscovery = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/LanDiscoveryService.java"), "utf8");
const androidUpnp = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/UpnpDeviceDescription.java"), "utf8");

assert.match(desktop, /function resolveRendererRoot\(/, "Desktop Remote Web must verify the packaged renderer root before reporting success");
assert.match(desktop, /index\.html[\s\S]*Remote Web renderer not found/, "Desktop Remote Web must fail clearly when its renderer is missing");
assert.match(desktop, /remote=1&v=\$\{encodeURIComponent\(app\.getVersion\(\)\)\}/, "Desktop Remote Web URL must cache-bust the SPA shell per app version");
assert.match(desktop, /Cache-Control[\s\S]*no-store/, "Desktop Remote Web index must not be served as a stale cached shell");
assert.match(android, /resolveAssetRoot\(\)/, "Android Remote Web must verify the packaged asset root before reporting success");
assert.match(android, /Remote Web index\.html is missing from packaged Android assets/, "Android Remote Web must fail clearly when packaged web assets are missing");
assert.match(android, /remote=1&v=" \+ BuildConfig\.VERSION_NAME/, "Android Remote Web URL must cache-bust the SPA shell per app version");
assert.match(android, /Cache-Control: no-store/, "Android Remote Web responses must prevent stale shell reuse");

assert.match(desktopDiscovery, /&v=\$\{encodeURIComponent\(this\.version\)\}/, "Desktop discovery URLs must carry the version cache-buster");
assert.match(desktopUpnp, /presentationUrl[\s\S]*&v=/, "Desktop UPnP presentation URL must carry the version cache-buster");
assert.match(androidDiscovery, /remote=1&v=" \+ BuildConfig\.VERSION_NAME/, "Android discovery URLs must carry the version cache-buster");
assert.match(androidUpnp, /remote=1&v=" \+ BuildConfig\.VERSION_NAME/, "Android UPnP presentation URL must carry the version cache-buster");
assert.match(session, /parameters\.get\("remote"\) === "1"/, "Remote session detection must tolerate extra version query parameters");
console.log("Remote Web smoke passed.");
