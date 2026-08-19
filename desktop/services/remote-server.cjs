const { app, BrowserWindow } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { LanDiscoveryService } = require("../lan/LanDiscoveryService.cjs");
const { projectPaths } = require("./profile-service.cjs");

function resolveRendererRoot() {
  const candidates = app.isPackaged
    ? [
        path.dirname(projectPaths(app).renderer),
        path.join(app.getAppPath(), "desktop", "package-renderer"),
        path.join(process.resourcesPath, "app.asar", "desktop", "package-renderer"),
      ]
    : [
        path.resolve(__dirname, "..", "..", "dist-desktop"),
        path.resolve(__dirname, "..", "..", "dist"),
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
  if (!requested || requested.includes("\\0")) requested = "index.html";
  const root = path.resolve(rendererRoot);
  const filePath = path.resolve(root, requested);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}

function createRemoteServerService({ pythonService, log }) {
  let remoteServer = null;
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
            return sendJson(response, 200, { settings, agentApiKey: "" });
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

    return new Promise((resolve, reject) => server.once("error", reject).listen(0, "0.0.0.0", () => {
      const port = server.address().port;
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
      const info = { url: `http://${address}:${port}/?remote=1&v=${encodeURIComponent(app.getVersion())}`, pin: remotePin, requiresPin: Boolean(remotePin), port };
      server.__info = info;
      remoteServer = server;
      resolve(info);
    }));
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
    remotePin = null;
    return new Promise((resolve) => server.close(() => {
      if (hadDiscovery) setTimeout(resolve, 80); else resolve();
    }));
  }

  return { start, stop };
}

module.exports = { createRemoteServerService };
