const { app, BrowserWindow } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { LanDiscoveryService } = require("../lan/LanDiscoveryService.cjs");
const LAN_WEB_PORT = 8765;

function resolveRendererRoot() {
  const rendererRoot = app.isPackaged
    ? path.join(app.getAppPath(), "desktop", "package-remote")
    : path.resolve(__dirname, "..", "..", "dist");
  const index = path.join(rendererRoot, "index.html");
  if (!fs.existsSync(index) || !fs.statSync(index).isFile()) {
    throw new Error(`Remote Web renderer not found: ${rendererRoot}`);
  }
  return path.resolve(rendererRoot);
}

function safeStaticPath(rendererRoot, pathname) {
  let requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\/+/, ""));
  if (!requested || requested.includes("\0")) requested = "index.html";
  const root = path.resolve(rendererRoot);
  const filePath = path.resolve(root, requested);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}

function createRemoteServerService({ pythonService, log }) {
  let remoteServer = null;
  let remoteStartPromise = null;
  let remotePin = null;
  let lanDiscovery = null;
  const remoteTokens = new Set();
  const remoteExecutionIds = new Set();
  const maxOutputBytes = pythonService.MAX_OUTPUT_BYTES;
  const defaultExecutionTimeoutMs = pythonService.DEFAULT_EXECUTION_TIMEOUT_MS;

  function readRequestBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxOutputBytes) { reject(new Error("请求超过 64 MiB")); request.destroy(); }
        else chunks.push(chunk);
      });
      request.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
        catch (error) { reject(error); }
      });
      request.on("error", reject);
    });
  }

  function sendJson(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
    response.end(body);
  }

  function start(requirePin) {
    if (remoteServer) return Promise.resolve(remoteServer.__info);
    if (remoteStartPromise) return remoteStartPromise;
    remoteStartPromise = startOnce(requirePin).finally(() => { remoteStartPromise = null; });
    return remoteStartPromise;
  }

  function startOnce(requirePin) {
    remotePin = requirePin ? String(crypto.randomInt(0, 10000)).padStart(4, "0") : null;
    remoteTokens.clear();
    const rendererRoot = resolveRendererRoot();
    log(`[Remote Web] Renderer root: ${rendererRoot}`);
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://localhost");
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
        if (url.pathname === "/api/health") return sendJson(response, 200, { requiresPin: Boolean(remotePin) });
        if (url.pathname === "/api/pair" && request.method === "POST") {
          const body = await readRequestBody(request);
          if (remotePin && String(body.pin ?? "") !== remotePin) return sendJson(response, 403, { error: "四位校验码不正确" });
          const token = crypto.randomBytes(24).toString("hex");
          remoteTokens.add(token);
          return sendJson(response, 200, { token });
        }
        if (url.pathname.startsWith("/api/")) {
          if (!remoteTokens.has(String(request.headers["x-pydroid-token"] ?? ""))) return sendJson(response, 401, { error: "尚未配对" });
          const body = request.method === "POST" ? await readRequestBody(request) : {};
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
            return sendJson(response, 200, { settings, agentProxyAvailable: false });
          }
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

    return new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error?.code === "EADDRINUSE") reject(new Error(`局域网 Web 端口 ${LAN_WEB_PORT} 已被其他程序占用`));
        else reject(error);
      };
      server.once("error", onError).listen(LAN_WEB_PORT, "0.0.0.0", () => {
        server.removeListener("error", onError);
        const port = LAN_WEB_PORT;
        try {
          lanDiscovery = new LanDiscoveryService({ userDataRoot: app.getPath("userData"), log, version: app.getVersion() });
          const discovery = lanDiscovery.start({ port });
          log(`[LAN] HTTP ${lanDiscovery.presentationUrl()}`);
          log(`[LAN] Local ${discovery.localUrl ?? "unavailable"}`);
        } catch (error) {
          lanDiscovery = null;
          log(`[LAN] Discovery startup failed; HTTP remains available: ${error.message || error}`);
        }
        const address = lanDiscovery?.primaryAddress() ?? "127.0.0.1";
        const interfaceUrls = (lanDiscovery?.getStatus?.().interfaces ?? []).map((item) => `http://${item.address}:${port}/`);
        const url = `http://${address}:${port}/`;
        const urls = [...new Set([url, ...interfaceUrls, lanDiscovery?.localUrl?.()].filter(Boolean))];
        const discovery = lanDiscovery?.getStatus?.();
        const info = { url, urls, pin: remotePin, requiresPin: Boolean(remotePin), port, ...(discovery ? { discovery } : {}) };
        server.__info = info;
        remoteServer = server;
        server.on("error", (error) => log(`[Remote Web] ${error?.message || error}`));
        resolve(info);
      });
    });
  }

  function stop() {
    for (const executionId of remoteExecutionIds) pythonService.cancel(executionId);
    remoteExecutionIds.clear();
    lanDiscovery?.stop();
    lanDiscovery = null;
    remoteTokens.clear();
    remotePin = null;
    if (!remoteServer) return Promise.resolve();
    const server = remoteServer;
    remoteServer = null;
    return new Promise((resolve) => server.close(resolve));
  }

  return { start, stop };
}

module.exports = { createRemoteServerService };
