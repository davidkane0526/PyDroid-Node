import assert from "node:assert/strict";
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
const asset = path.join(assetDir, "lifecycle.js");
const createdFixture = !fs.existsSync(index);
const userData = path.join(root, ".remote-host-lifecycle-user-data");

if (createdFixture) {
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(index, '<!doctype html><html><body><div id="root"></div><script type="module" src="./assets/lifecycle.js"></script></body></html>', "utf8");
  fs.writeFileSync(asset, 'globalThis.__PYDROID_REMOTE_LIFECYCLE__ = "ready-and-nontrivial";\n', "utf8");
}
fs.mkdirSync(userData, { recursive: true });

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        isPackaged: false,
        getPath: () => userData,
        getVersion: () => "lifecycle",
        getAppMetrics: () => [],
      },
      BrowserWindow: { getAllWindows: () => [] },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { createRemoteServerService } = require(path.join(root, "desktop/services/remote-server.cjs"));
const pythonService = {
  MAX_OUTPUT_BYTES: 8 * 1024 * 1024,
  DEFAULT_EXECUTION_TIMEOUT_MS: 10_000,
  runRequest: async () => "{}",
  cancelAndWait: async () => ({ cancelled: true }),
  cancel: () => true,
  status: () => ({ active: false }),
};
const service = createRemoteServerService({ pythonService, log: () => {} });

function requestHealth() {
  return new Promise((resolve, reject) => {
    const request = http.get("http://127.0.0.1:8765/health", { timeout: 1000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("timeout", () => request.destroy(new Error("health timeout")));
    request.once("error", reject);
  });
}

async function assertPortClosed(message) {
  await assert.rejects(requestHealth(), (error) => ["ECONNREFUSED", "ECONNRESET"].includes(error?.code) || /socket hang up|connect/i.test(error?.message ?? ""), message);
}

try {
  // Regression: in 1.4.73 stop() could return while start() later committed the server,
  // resurrecting TCP 8765 behind a UI state which already considered the host stopped.
  const pendingStart = service.start(true);
  const pendingStop = service.stop();
  await assert.rejects(pendingStart, /cancelled/i, "stop during startup must cancel the stale start transaction");
  await pendingStop;
  assert.equal(service.lifecycleState(), "stopped", "stop during startup must leave the host lifecycle stopped");
  assert.deepEqual(service.status(), { state: "stopped", info: null }, "read-only host status must report stopped without restarting the service");
  await assertPortClosed("stop during startup must not leave TCP 8765 listening");

  const first = service.start(true);
  const second = service.start(false);
  assert.equal(first, second, "concurrent starts must still share one in-flight transaction");
  const info = await first;
  assert.equal(info.port, 8765);
  assert.equal(service.lifecycleState(), "running", "successful start must commit one running host");
  const runningStatus = service.status();
  assert.equal(runningStatus.state, "running", "read-only host status must observe the committed host");
  assert.equal(runningStatus.info?.port, 8765, "read-only host status must expose the accepted fixed port");
  assert.equal(runningStatus.info?.pin, info.pin, "read-only host status must not rotate the active PIN");
  assert.equal((await requestHealth()).body.trim(), "OK");
  const refreshedInfo = await service.start(true);
  assert.notEqual(refreshedInfo, info, "an already-running host must return a refreshed readiness snapshot instead of a stale startup object");
  assert.equal(refreshedInfo.pin, info.pin, "refreshing host observability must not rotate the active PIN");
  assert.equal(refreshedInfo.readiness.loopback, true, "refreshed host observability must re-check loopback HTTP readiness");

  const stopping = service.stop();
  const restart = service.start(true);
  await stopping;
  const restarted = await restart;
  assert.equal(restarted.port, 8765, "start requested while stop is finishing must restart after the stop barrier");
  assert.equal((await requestHealth()).status, 200, "restart after stop must own TCP 8765 again");

  await service.stop();
  await service.stop();
  assert.equal(service.lifecycleState(), "stopped", "repeated stop must be idempotent");
  assert.deepEqual(service.status(), { state: "stopped", info: null }, "final host status must reconcile to stopped");
  await assertPortClosed("final stop must release TCP 8765");

  console.log("Remote host lifecycle smoke passed: start/stop race, restart barrier, read-only status and idempotent stop are protected.");
} finally {
  try { await service.stop(); } catch {}
  Module._load = originalLoad;
  fs.rmSync(userData, { recursive: true, force: true });
  if (createdFixture) fs.rmSync(dist, { recursive: true, force: true });
}
