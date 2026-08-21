import assert from "node:assert/strict";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import Module from "node:module";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const dist = path.join(root, "dist");
const index = path.join(dist, "index.html");
const assetDir = path.join(dist, "assets");
const asset = path.join(assetDir, "diagnostic.js");
const createdFixture = !fs.existsSync(index);
const userData = path.join(root, ".remote-host-e2e-user-data");

if (createdFixture) {
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(index, '<!doctype html><html><body><div id="root"></div><script type="module" src="./assets/diagnostic.js"></script></body></html>', "utf8");
  fs.writeFileSync(asset, 'globalThis.__PYDROID_REMOTE_E2E__ = "browser-shell-asset-loaded-and-nontrivial";\n', "utf8");
}
fs.mkdirSync(userData, { recursive: true });

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        isPackaged: false,
        getPath: () => userData,
        getVersion: () => "e2e",
        getAppMetrics: () => [],
      },
      BrowserWindow: { getAllWindows: () => [] },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { createRemoteServerService } = require(path.join(root, "desktop/services/remote-server.cjs"));
const pythonService = {
  MAX_OUTPUT_BYTES: 64 * 1024 * 1024,
  DEFAULT_EXECUTION_TIMEOUT_MS: 10_000,
  runRequest: async () => "{}",
  cancelAndWait: async () => ({ cancelled: true }),
  cancel: () => true,
  status: () => ({ active: false }),
};
const logs = [];
const service = createRemoteServerService({ pythonService, log: (line) => logs.push(String(line)) });

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error(`HTTP timeout: ${url}`)));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function ssdpSearch() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const responses = [];
    const timer = setTimeout(() => {
      socket.close();
      if (responses.length) resolve(responses);
      else reject(new Error("SSDP M-SEARCH received no response from the live discovery service"));
    }, 1500);
    socket.on("message", (message) => {
      responses.push(message.toString("utf8"));
      if (responses.length >= 3) {
        clearTimeout(timer);
        socket.close();
        resolve(responses);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.bind(0, "127.0.0.1", () => {
      const body = Buffer.from([
        "M-SEARCH * HTTP/1.1",
        "HOST: 239.255.255.250:1900",
        'MAN: "ssdp:discover"',
        "MX: 1",
        "ST: ssdp:all",
        "",
        "",
      ].join("\r\n"), "utf8");
      socket.send(body, 1900, "127.0.0.1");
    });
  });
}

try {
  const info = await service.start(true);
  assert.equal(info.port, 8765, "Remote Web must use the stable LAN port from the proven LAN demo contract");
  assert.match(info.url, /^http:\/\//, "Remote Web must return an HTTP URL after bind succeeds");

  const loopback = `http://127.0.0.1:${info.port}`;
  const health = await request(`${loopback}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.body.trim(), "OK");

  const shell = await request(`${loopback}/`);
  assert.equal(shell.status, 200);
  assert.match(shell.body, /id=["']root["']/i);

  const upnp = await request(`${loopback}/upnp/device.xml`);
  assert.equal(upnp.status, 200);
  assert.match(upnp.body, /<presentationURL>http:\/\//);
  assert.match(upnp.body, /<UDN>uuid:/);

  if (!/127\.0\.0\.1|localhost/.test(info.url)) {
    const lanHealth = await request(new URL("/health", info.url));
    assert.equal(lanHealth.status, 200, `selected LAN address is not reachable from the live host: ${info.url}`);
  }

  const healthWrongMethod = await request(`${loopback}/api/health`, { method: "POST" });
  assert.equal(healthWrongMethod.status, 405, "Desktop /api/health must remain GET-only");

  const pairWrongMethod = await request(`${loopback}/api/pair`, { method: "GET" });
  assert.equal(pairWrongMethod.status, 405, "Desktop /api/pair must remain POST-only");

  const pair = await request(`${loopback}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: info.pin }),
  });
  assert.equal(pair.status, 200);
  const token = JSON.parse(pair.body).token;
  assert.ok(token, "live pairing must issue a token");

  const api = await request(`${loopback}/api/runtime-stats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PyDroid-Token": token },
    body: "{}",
  });
  assert.equal(api.status, 200);

  const apiWrongMethod = await request(`${loopback}/api/runtime-stats`, {
    method: "GET",
    headers: { "X-PyDroid-Token": token },
  });
  assert.equal(apiWrongMethod.status, 405, "Authenticated Desktop /api/* endpoints must remain POST-only");

  const agentProxy = await request(`${loopback}/api/agent-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PyDroid-Token": token },
    body: JSON.stringify({ provider: "openai", body: {} }),
  });
  assert.equal(agentProxy.status, 409, "Desktop must explicitly preserve the no-host-secret Agent proxy contract instead of falling through to 404");

  const ssdp = await ssdpSearch();
  assert.ok(ssdp.some((item) => /^HTTP\/1\.1 200 OK/m.test(item) && /LOCATION: http:\/\//i.test(item)), "live SSDP response must advertise an HTTP LOCATION");

  assert.ok(logs.some((line) => line.includes("[SSDP] Response sent")), "live discovery must process M-SEARCH and send a response");

  console.log(`Remote host E2E passed: HTTP ${info.port}, pairing, authenticated API, UPnP, SSDP M-SEARCH`);
} finally {
  try { await service.stop(); } catch {}
  Module._load = originalLoad;
  fs.rmSync(userData, { recursive: true, force: true });
  if (createdFixture) fs.rmSync(dist, { recursive: true, force: true });
}
