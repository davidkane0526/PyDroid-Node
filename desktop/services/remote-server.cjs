const { app, BrowserWindow } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { LanDiscoveryService } = require("../lan/LanDiscoveryService.cjs");
const { LAN_WEB_PORT, ensureWindowsLanFirewall, inspectWindowsLanFirewall } = require("../lan/firewall.cjs");
const { REMOTE_SECURITY_POLICY, RemoteAccessGuard, RemoteTokenStore } = require("./remote-security.cjs");

const EXPENSIVE_API_PATHS = new Set(["/api/execute", "/api/analyze-notebook", "/api/analyze-signature", "/api/agent-proxy"]);
const MAX_PAIR_BODY_BYTES = 64 * 1024;

function resolveRendererRoot() {
  const candidates = app.isPackaged
    ? [
        path.join(app.getAppPath(), "desktop", "package-remote"),
        path.join(process.resourcesPath, "app.asar", "desktop", "package-remote"),
      ]
    : [
        path.resolve(__dirname, "..", "..", "dist"),
        path.resolve(__dirname, "..", "..", "dist-desktop"),
      ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const index = path.join(candidate, "index.html");
    try { if (fs.existsSync(index) && fs.statSync(index).isFile()) return path.resolve(candidate); } catch { /* try next candidate */ }
  }
  throw new Error(`Remote Web renderer not found. Checked: ${candidates.join(" | ")}`);
}

function safeStaticPath(rendererRoot, pathname) {
  let requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\/+/, ""));
  if (!requested || requested.includes("\0")) requested = "index.html";
  const root = path.resolve(rendererRoot);
  const filePath = path.resolve(root, requested);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}


function requestText(port, pathname, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const request = http.get({ host, port, path: pathname, timeout: 2500 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("timeout", () => request.destroy(new Error(`Remote Web readiness timeout: ${pathname}`)));
    request.once("error", reject);
  });
}

async function verifyLoopbackReady(port) {
  const health = await requestText(port, "/health");
  if (health.status !== 200 || health.body.trim() !== "OK") throw new Error("Remote Web /health readiness check failed");
  const shell = await requestText(port, "/");
  if (shell.status !== 200 || !/<script\b/i.test(shell.body) || !/<div[^>]+id=["']root["']/i.test(shell.body)) {
    throw new Error("Remote Web browser shell readiness check failed");
  }
  const assetMatch = shell.body.match(/<script[^>]+src=["']([^"']+)["']/i);
  if (assetMatch) {
    const assetPath = new URL(assetMatch[1], `http://127.0.0.1:${port}/`).pathname;
    const asset = await requestText(port, assetPath);
    if (asset.status !== 200 || asset.body.length < 32) throw new Error(`Remote Web main asset readiness check failed: ${assetPath}`);
  }
}

function normalizeClientAddress(request) {
  return String(request.socket?.remoteAddress ?? "unknown").replace(/^::ffff:/, "").replace(/^\[|\]$/g, "") || "unknown";
}

function createRemoteServerService({ pythonService, log }) {
  let remoteServer = null;
  let remotePin = null;
  let lanDiscovery = null;
  const accessGuard = new RemoteAccessGuard();
  const remoteTokens = new RemoteTokenStore();
  const remoteExecutionIds = new Set();
  const maxOutputBytes = pythonService.MAX_OUTPUT_BYTES;
  const defaultExecutionTimeoutMs = pythonService.DEFAULT_EXECUTION_TIMEOUT_MS;

  function readRequestBody(request, limitBytes = maxOutputBytes) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > limitBytes) { reject(new Error("请求体过大")); request.destroy(); }
        else chunks.push(chunk);
      });
      request.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
        catch (error) { reject(error); }
      });
      request.on("error", reject);
    });
  }

  function sendJson(response, status, value, extraHeaders = {}) {
    const body = JSON.stringify(value);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", ...extraHeaders });
    response.end(body);
  }

  function sendRateLimit(response, error, retryAfterSeconds) {
    return sendJson(response, 429, { error, retryAfterSeconds }, { "Retry-After": String(retryAfterSeconds) });
  }

  async function start(requirePin) {
    if (remoteServer) return Promise.resolve(remoteServer.__info);
    remotePin = requirePin ? String(crypto.randomInt(0, 10000)).padStart(4, "0") : null;
    remoteTokens.clear();
    accessGuard.reset();
    const rendererRoot = resolveRendererRoot();
    log(`[Remote Web] Renderer root: ${rendererRoot}`);
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://localhost");
        const clientKey = normalizeClientAddress(request);
        if (url.pathname === "/upnp/device.xml" && request.method === "GET") {
          const address = request.socket.localAddress && request.socket.localAddress !== "0.0.0.0" ? request.socket.localAddress.replace(/^::ffff:/, "") : undefined;
          const xml = lanDiscovery?.deviceXml(address) ?? "";
          response.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", "Content-Length": Buffer.byteLength(xml), "Cache-Control": "no-cache" });
          return response.end(xml);
        }
        if (url.pathname === "/health" && request.method === "GET") {
          response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          return response.end("OK");
        }
        if (url.pathname === "/api/health") {
          if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
          return sendJson(response, 200, { requiresPin: Boolean(remotePin) });
        }
        if (url.pathname === "/api/pair") {
          if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
          const pairCheck = accessGuard.checkPair(clientKey);
          if (!pairCheck.allowed) return sendRateLimit(response, `配对尝试过多，请 ${pairCheck.retryAfterSeconds} 秒后重试`, pairCheck.retryAfterSeconds);
          const body = await readRequestBody(request, MAX_PAIR_BODY_BYTES);
          if (remotePin && String(body.pin ?? "") !== remotePin) {
            const failure = accessGuard.recordPairFailure(clientKey);
            if (failure.locked) return sendRateLimit(response, `配对尝试过多，请 ${failure.retryAfterSeconds} 秒后重试`, failure.retryAfterSeconds);
            return sendJson(response, 403, { error: "四位校验码不正确" });
          }
          accessGuard.recordPairSuccess(clientKey);
          const token = remoteTokens.issue(clientKey);
          return sendJson(response, 200, { token });
        }
        if (url.pathname.startsWith("/api/")) {
          const token = String(request.headers["x-pydroid-token"] ?? "");
          if (!remoteTokens.validate(token, clientKey)) return sendJson(response, 401, { error: "配对会话无效或已过期，请重新配对" });
          const rate = accessGuard.consumeApi(clientKey, EXPENSIVE_API_PATHS.has(url.pathname));
          if (!rate.allowed) return sendRateLimit(response, `请求过于频繁，请 ${rate.retryAfterSeconds} 秒后重试`, rate.retryAfterSeconds);
          if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
          const body = await readRequestBody(request);
          if (url.pathname === "/api/execute") {
            const executionId = String(body.executionId ?? `remote-${crypto.randomUUID()}`);
            remoteExecutionIds.add(executionId);
            try {
              const raw = await pythonService.runRequest({
                workflow: String(body.workflow ?? ""),
                csvText: String(body.csvText ?? ""),
                inputFiles: JSON.stringify(body.inputFiles ?? []),
                executionId,
                timeoutMs: Number(body.timeoutMs ?? defaultExecutionTimeoutMs),
                workspaceId: String(body.workspaceId ?? "default"),
                workspaceLabel: String(body.workspaceLabel ?? "工作流"),
                clientId: String(body.clientId ?? "remote-browser"),
              }, {
                source: "remote",
                workspaceId: String(body.workspaceId ?? "default"),
                workspaceLabel: String(body.workspaceLabel ?? "工作流"),
                clientId: String(body.clientId ?? "remote-browser"),
              });
              response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
              return response.end(raw);
            } finally { remoteExecutionIds.delete(executionId); }
          }
          if (url.pathname === "/api/cancel") return sendJson(response, 200, await pythonService.cancelAndWait(String(body.executionId ?? "")));
          if (url.pathname === "/api/execution-status") return sendJson(response, 200, pythonService.status());
          if (url.pathname === "/api/environment") return response.end(await pythonService.runRequest({ action: "environment" }));
          if (url.pathname === "/api/analyze-notebook") return response.end(await pythonService.runRequest({ action: "analyze_notebook", notebook: String(body.notebook ?? "") }));
          if (url.pathname === "/api/analyze-signature") return response.end(await pythonService.runRequest({ action: "analyze_signature", code: String(body.code ?? "") }));
          if (url.pathname === "/api/runtime-stats") {
            const memoryBytes = app.getAppMetrics().reduce((total, metric) => total + Math.max(0, metric.memory.workingSetSize) * 1024, 0);
            return sendJson(response, 200, { memoryBytes });
          }
          if (url.pathname === "/api/app-configuration") {
            let settings = {};
            try {
              const hostWindow = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
              const raw = hostWindow ? await hostWindow.webContents.executeJavaScript(`localStorage.getItem("pydroid-flow.settings.v1")`) : null;
              if (raw) settings = JSON.parse(raw);
            } catch {}
            // Desktop Agent keys are intentionally renderer-session scoped; never expose them to Remote Web.
            return sendJson(response, 200, { settings, agentProxyAvailable: false });
          }
          if (url.pathname === "/api/agent-proxy") return sendJson(response, 409, { error: "桌面宿主当前没有可供网页使用的安全 Agent 密钥代理；请在此浏览器会话中单独填写 API 密钥" });
          return sendJson(response, 404, { error: "接口不存在" });
        }
        let filePath = safeStaticPath(rendererRoot, url.pathname);
        if (!filePath) { response.writeHead(400); return response.end("Invalid path"); }
        let exists = false;
        try { exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile(); } catch { exists = false; }
        // Remote Web is a SPA. A browser refresh on a client-side route should still load index.html.
        if (!exists && request.method === "GET" && String(request.headers.accept ?? "").includes("text/html")) {
          filePath = path.join(rendererRoot, "index.html");
          exists = fs.existsSync(filePath);
        }
        if (!exists) { response.writeHead(404); return response.end("Not found"); }
        const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".woff2": "font/woff2" }[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
        response.writeHead(200, { "Content-Type": mime, "Cache-Control": path.basename(filePath) === "index.html" ? "no-store" : "public, max-age=31536000, immutable" });
        fs.createReadStream(filePath).pipe(response);
      } catch (error) { sendJson(response, 500, { error: error?.message || String(error) }); }
    });

    const firewall = await ensureWindowsLanFirewall({ log });
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error?.code === "EADDRINUSE") return reject(new Error(`局域网 Web 端口 ${LAN_WEB_PORT} 已被其他程序占用，请关闭占用程序后重试`));
        reject(error);
      };
      server.once("error", onError).listen(LAN_WEB_PORT, "0.0.0.0", async () => {
        server.removeListener("error", onError);
        const port = LAN_WEB_PORT;
        try {
          await verifyLoopbackReady(port);
          log(`[Remote Web] Loopback readiness passed on 127.0.0.1:${port}`);
        } catch (error) {
          try { server.close(); } catch {}
          return reject(error);
        }
        try {
          lanDiscovery = new LanDiscoveryService({ userDataRoot: app.getPath("userData"), log, version: app.getVersion() });
          const discovery = lanDiscovery.start({ port });
          await lanDiscovery.waitUntilReady(2500);
          log(`[LAN] HTTP ${lanDiscovery.presentationUrl()}`);
          log(`[LAN] Local ${discovery.localUrl ?? "unavailable"}`);
        } catch (error) {
          lanDiscovery = null;
          log(`[LAN] Discovery startup failed; HTTP remains available: ${error.message || error}`);
        }
        const discoveryState = lanDiscovery?.getStatus?.() ?? { interfaces: [], ssdp: "unavailable", mdns: "unavailable" };
        const address = lanDiscovery?.primaryAddress() ?? "127.0.0.1";
        const interfaceUrls = (discoveryState.interfaces ?? []).map((item) => `http://${item.address}:${port}/`);
        const url = `http://${address}:${port}/`;
        const urls = [...new Set([url, ...interfaceUrls, lanDiscovery?.localUrl?.()].filter(Boolean))];
        const lanHealth = [];
        for (const item of discoveryState.interfaces ?? []) {
          try {
            const health = await requestText(port, "/health", item.address);
            lanHealth.push({ address: item.address, ok: health.status === 200 && health.body.trim() === "OK" });
          } catch (error) {
            lanHealth.push({ address: item.address, ok: false, error: error?.message || String(error) });
          }
        }
        const firewallState = process.platform === "win32" ? await inspectWindowsLanFirewall() : firewall;
        const discovery = {
          interfaces: (discoveryState.interfaces ?? []).map((item) => ({ name: item.name, address: item.address, defaultRoute: Boolean(item.defaultRoute) })),
          ssdp: discoveryState.ssdp ?? "unavailable",
          mdns: discoveryState.mdns ?? "unavailable",
        };
        const readiness = {
          loopback: true,
          lanHttp: lanHealth,
          allLanHttpReady: lanHealth.length > 0 && lanHealth.every((item) => item.ok),
          discoveryReady: discovery.ssdp === "running" && discovery.mdns === "running",
          firewall: firewallState,
        };
        const info = { url, urls, pin: remotePin, requiresPin: Boolean(remotePin), port, discovery, readiness };
        server.__info = info;
        remoteServer = server;
        resolve(info);
      });
    });
  }

  function stop() {
    for (const executionId of remoteExecutionIds) pythonService.cancel(executionId);
    remoteExecutionIds.clear();
    const hadDiscovery = Boolean(lanDiscovery);
    lanDiscovery?.stop();
    lanDiscovery = null;
    if (!remoteServer) return hadDiscovery ? new Promise((resolve) => setTimeout(resolve, 80)) : Promise.resolve();
    const server = remoteServer;
    remoteServer = null;
    remoteTokens.clear();
    accessGuard.reset();
    remotePin = null;
    return new Promise((resolve) => server.close(() => {
      if (hadDiscovery) setTimeout(resolve, 80); else resolve();
    }));
  }

  return { start, stop };
}

module.exports = { createRemoteServerService, normalizeClientAddress, REMOTE_SECURITY_POLICY };
