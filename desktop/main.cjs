const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } = require("electron");
const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const net = require("node:net");
const dns = require("node:dns").promises;
const { Client: SmbClient } = require("node-smb2");
const { spawn } = require("node:child_process");
const path = require("node:path");

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
let remoteServer = null;
let remotePin = null;
const remoteTokens = new Set();
const SMB_FILE_PATTERN = /\.(csv|tsv|txt|dat|json|png|jpe?g)$/i;

function probeSmbHost(address, timeout = 380) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port: 445 });
    const finish = (open) => { socket.destroy(); resolve(open ? address : null); };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function discoverSmbServers() {
  const candidates = new Set();
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries ?? []) {
    if (entry.family !== "IPv4" || entry.internal) continue;
    const octets = entry.address.split(".").map(Number);
    if (octets.length !== 4) continue;
    for (let suffix = 1; suffix < 255; suffix++) candidates.add(`${octets[0]}.${octets[1]}.${octets[2]}.${suffix}`);
  }
  const addresses = [...candidates];
  const found = [];
  for (let offset = 0; offset < addresses.length; offset += 48) {
    const batch = await Promise.all(addresses.slice(offset, offset + 48).map((address) => probeSmbHost(address)));
    found.push(...batch.filter(Boolean));
  }
  return Promise.all(found.map(async (address) => {
    let name = address;
    try { name = (await dns.reverse(address))[0] || address; } catch {}
    const shares = await netViewShares(address).catch(() => []);
    return { address, name, shares };
  }));
}

function smbErrorMessage(error, fallback = "SMB 操作失败") {
  if (typeof error === "string" && error && error !== "[object Object]") return error;
  if (error instanceof Error && error.message && error.message !== "[object Object]") return error.message;
  if (error && typeof error === "object") {
    for (const key of ["message", "description", "code", "status", "ntStatus"]) {
      const value = error[key];
      if (typeof value === "string" && value.trim() && value !== "[object Object]") return value;
      if (typeof value === "number") return `${key}: 0x${value.toString(16)}`;
    }
    try { const serialized = JSON.stringify(error); if (serialized !== "{}") return serialized; } catch {}
  }
  return fallback;
}

async function safeSmbOperation(action, fallback) {
  try { return await action(); }
  catch (error) { throw new Error(smbErrorMessage(error, fallback)); }
}

async function withSmbTree(connection, action) {
  if (!/^[A-Za-z0-9._:-]+$/.test(connection.server || "") || !connection.share || /[\\/]/.test(connection.share)) throw new Error("SMB 服务器或共享名无效");
  const client = new SmbClient(connection.server, { connectTimeout: 8000, requestTimeout: 15000 });
  try {
    const session = await client.authenticate({ domain: connection.domain || "", username: connection.username || "", password: connection.password || "" });
    const tree = await session.connectTree(connection.share);
    return await action(tree);
  } finally { await client.close().catch(() => undefined); }
}

async function listDesktopSmb(connection, relativePath = "") {
  const clean = String(relativePath).replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (clean.split("/").includes("..")) throw new Error("SMB 路径无效");
  return withSmbTree(connection, async (tree) => (await tree.readDirectory(clean ? `/${clean}` : "/"))
    .filter((entry) => entry.type === "Directory" || SMB_FILE_PATTERN.test(entry.filename))
    .map((entry) => ({ name: entry.filename, path: clean ? `${clean}/${entry.filename}` : entry.filename, directory: entry.type === "Directory", size: Number(entry.fileSize || 0n), modifiedAt: entry.lastWriteTime?.toISOString?.() ?? null })));
}

async function readDesktopSmb(connection, paths) {
  return withSmbTree(connection, async (tree) => Promise.all(paths.slice(0, 100).map(async (relativePath) => {
    const clean = String(relativePath).replaceAll("\\", "/").replace(/^\/+/, "");
    if (clean.split("/").includes("..") || !SMB_FILE_PATTERN.test(clean)) throw new Error(`不支持的 SMB 文件：${clean}`);
    const bytes = await tree.readFile(`/${clean}`);
    if (bytes.length > 64 * 1024 * 1024) throw new Error(`${clean} 超过 64 MiB`);
    return { name: clean, base64: bytes.toString("base64") };
  })));
}

function netViewShares(server) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); net view \\\\${server}`], { windowsHide: true });
    const chunks = [];
    let settled = false;
    const finish = (shares = []) => { if (settled) return; settled = true; clearTimeout(timer); resolve(shares); };
    const timer = setTimeout(() => { child.kill(); finish([]); }, 4000);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", () => finish([]));
    child.once("close", () => {
      const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
      const shares = lines.map((line) => line.match(/^(.+?)\s{2,}(?:Disk|磁盘|盘|Print|打印)/i)?.[1]?.trim()).filter(Boolean);
      finish([...new Set(shares)]);
    });
  });
}

async function scanDesktopSmbShares(connection) {
  const fromWindows = await netViewShares(connection.server);
  const candidates = [...new Set([connection.share, ...fromWindows, "public", "share", "shared", "data", "files", "documents", "media", "backup", "homes"].filter(Boolean))];
  const available = [];
  for (const share of candidates) {
    try { await withSmbTree({ ...connection, share }, async (tree) => { await tree.readDirectory("/"); }); available.push(share); } catch {}
  }
  if (!available.length && connection.share) throw new Error("凭据有效性或共享名无法确认；请检查账号、密码和共享名");
  return available;
}

function smbSecretPath() { return path.join(app.getPath("userData"), "settings", "smb-secret.bin"); }
function saveDesktopSmbSecret(value) {
  const target = smbSecretPath(); fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!value) { if (fs.existsSync(target)) fs.rmSync(target); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 安全存储当前不可用");
  fs.writeFileSync(target, safeStorage.encryptString(String(value)));
}
function loadDesktopSmbSecret() {
  const target = smbSecretPath();
  if (!fs.existsSync(target) || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.decryptString(fs.readFileSync(target));
}

function lanAddress() {
  for (const interfaces of Object.values(os.networkInterfaces())) for (const entry of interfaces ?? []) {
    if (entry.family === "IPv4" && !entry.internal) return entry.address;
  }
  return "127.0.0.1";
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on("data", (chunk) => { size += chunk.length; if (size > MAX_OUTPUT_BYTES) { reject(new Error("请求超过 64 MiB")); request.destroy(); } else chunks.push(chunk); });
    request.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (error) { reject(error); } });
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(body);
}

function startDesktopRemoteServer(requirePin) {
  if (remoteServer) return Promise.resolve(remoteServer.__info);
  remotePin = requirePin ? String(crypto.randomInt(0, 10000)).padStart(4, "0") : null;
  remoteTokens.clear();
  const rendererRoot = app.isPackaged ? path.dirname(projectPaths().renderer) : path.resolve(__dirname, "..", "dist-desktop");
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/api/health") return sendJson(response, 200, { requiresPin: Boolean(remotePin) });
      if (url.pathname === "/api/pair" && request.method === "POST") {
        const body = await readRequestBody(request);
        if (remotePin && String(body.pin ?? "") !== remotePin) return sendJson(response, 403, { error: "四位校验码不正确" });
        const token = crypto.randomBytes(24).toString("hex"); remoteTokens.add(token); return sendJson(response, 200, { token });
      }
      if (url.pathname.startsWith("/api/")) {
        if (!remoteTokens.has(String(request.headers["x-pydroid-token"] ?? ""))) return sendJson(response, 401, { error: "尚未配对" });
        const body = request.method === "POST" ? await readRequestBody(request) : {};
        if (url.pathname === "/api/execute") {
          const raw = await runPythonRequest({ workflow: String(body.workflow ?? ""), csvText: String(body.csvText ?? ""), inputFiles: JSON.stringify(body.inputFiles ?? []) });
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); return response.end(raw);
        }
        if (url.pathname === "/api/environment") return response.end(await runPythonRequest({ action: "environment" }));
        if (url.pathname === "/api/analyze-notebook") return response.end(await runPythonRequest({ action: "analyze_notebook", notebook: String(body.notebook ?? "") }));
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
      const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.resolve(rendererRoot, requested);
      if (!filePath.startsWith(path.resolve(rendererRoot)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { response.writeHead(404); return response.end("Not found"); }
      const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(filePath)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }); fs.createReadStream(filePath).pipe(response);
    } catch (error) { sendJson(response, 500, { error: error.message || String(error) }); }
  });
  return new Promise((resolve, reject) => server.once("error", reject).listen(0, "0.0.0.0", () => {
    const port = server.address().port; const info = { url: `http://${lanAddress()}:${port}/?remote=1`, pin: remotePin, requiresPin: Boolean(remotePin), port };
    server.__info = info; remoteServer = server; resolve(info);
  }));
}

function stopDesktopRemoteServer() {
  if (!remoteServer) return Promise.resolve();
  const server = remoteServer; remoteServer = null; remoteTokens.clear(); remotePin = null;
  return new Promise((resolve) => server.close(resolve));
}

// React Flow does not require GPU rendering. Disabling Chromium GPU composition
// avoids a known class of solid-colour/blank Electron windows on some Windows
// drivers, remote desktops and virtual machines.
app.disableHardwareAcceleration();

function appendDesktopLog(message) {
  try {
    const directory = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "desktop.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch { /* Diagnostics must never prevent the window from opening. */ }
}

function projectPaths() {
  if (app.isPackaged) {
    return {
      renderer: path.join(app.getAppPath(), "desktop", "package-renderer", "index.html"),
      python: path.join(process.resourcesPath, "python"),
    };
  }
  const root = path.resolve(__dirname, "..");
  return {
    renderer: path.join(root, "dist-desktop", "index.html"),
    python: path.join(root, "python"),
  };
}

function ensureUserProfile() {
  const root = app.getPath("userData");
  for (const name of ["settings", "user-code", "workflows", "logs"]) fs.mkdirSync(path.join(root, name), { recursive: true });
}

function pythonCommand(scriptPath, pythonRoot) {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return { executable: configured, args: [scriptPath] };
  if (process.platform === "win32") {
    const projectPython = app.isPackaged
      ? path.join(process.resourcesPath, "python-runtime", "python.exe")
      : path.join(path.dirname(pythonRoot), ".tools", "python312-runtime", "python.exe");
    if (require("node:fs").existsSync(projectPython)) {
      return { executable: projectPython, args: [scriptPath] };
    }
    return { executable: "py", args: ["-3.12", scriptPath] };
  }
  return { executable: "python3.12", args: [scriptPath] };
}

function runPythonRequest(payload) {
  const isUtilityRequest = payload?.action === "environment" || payload?.action === "analyze_notebook";
  if (!isUtilityRequest && (!payload || typeof payload.workflow !== "string" || typeof payload.csvText !== "string" || typeof payload.inputFiles !== "string")) {
    return Promise.reject(new Error("workflow, csvText, and inputFiles are required"));
  }

  const { python } = projectPaths();
  const script = path.join(python, "pydroid_flow", "desktop_bridge.py");
  const command = pythonCommand(script, python);
  const pythonPath = [python, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      cwd: python,
      env: { ...process.env, PYTHONPATH: pythonPath, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;

    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        reject(new Error("Python execution output exceeded 64 MiB"));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => reject(new Error(`Unable to start Python 3.12: ${error.message}`)));
    child.on("close", (code) => {
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(errorText || `Python execution exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
    // Use an ASCII-only frame on stdin. Workflow parameters may contain quotes,
    // newlines, non-BMP text and user-provided JSON; transporting their UTF-8
    // representation as Base64 prevents shell/runtime encoding from ever
    // turning a valid renderer payload into malformed JSON before Python sees it.
    const requestFrame = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    child.stdin.end(`PYDROID_FLOW_BASE64_V1\n${requestFrame}`, "ascii");
  });
}

function createWindow() {
  const smokeTest = process.env.PYDROID_DESKTOP_SMOKE === "1";
  const sharedAppIcon = path.resolve(__dirname, "..", "android", "app", "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher_round.png");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0b1020",
    ...(fs.existsSync(sharedAppIcon) ? { icon: sharedAppIcon } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => appendDesktopLog(`did-fail-load ${code} ${description} ${url}`));
  window.webContents.on("render-process-gone", (_event, details) => appendDesktopLog(`render-process-gone ${details.reason} ${details.exitCode}`));
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) appendDesktopLog(`renderer-console level=${level} ${message} ${sourceId}:${line}`);
  });
  if (!smokeTest) {
    window.once("ready-to-show", () => window.show());
    setTimeout(() => { if (!window.isDestroyed() && !window.isVisible()) window.show(); }, 5000);
  }
  const developmentUrl = process.env.PYDROID_DESKTOP_URL;
  if (developmentUrl) window.loadURL(developmentUrl);
  else window.loadFile(projectPaths().renderer);

  if (smokeTest) {
    window.webContents.once("did-finish-load", async () => {
      const payload = {
        workflow: JSON.stringify({
          schemaVersion: 1,
          name: "desktop multi-file smoke test",
          nodes: [
            {
              id: "read-batch",
              data: {
                nodeType: "io.read_csv_batch",
                parameters: {
                  header: "infer",
                  skipRows: 0,
                  sourceColumn: "source_file",
                  metadataColumn: "",
                  filenamePattern: "",
                  onError: "error",
                },
              },
            },
            { id: "export-a", data: { nodeType: "io.export_csv", parameters: { fileName: "desktop-a.csv" } } },
            { id: "export-b", data: { nodeType: "io.export_csv", parameters: { fileName: "desktop-b.csv" } } },
          ],
          edges: [
            { id: "e1", source: "read-batch", target: "export-a" },
            { id: "e2", source: "read-batch", target: "export-b" },
          ],
        }),
        csvText: "",
        inputFiles: JSON.stringify([
          { name: "first.csv", text: "a,b\n1,2\n" },
          { name: "second.csv", text: "a,b\n3,4\n" },
        ]),
      };
      try {
        const rendererState = await window.webContents.executeJavaScript(`({
          shell: Boolean(document.querySelector('.app-shell')),
          topbar: Boolean(document.querySelector('.topbar')),
          canvas: Boolean(document.querySelector('.canvas-panel')),
          text: document.body.innerText.slice(0, 200)
        })`);
        if (!rendererState.shell || !rendererState.topbar || !rendererState.canvas) {
          throw new Error(`Desktop renderer did not mount its UI: ${JSON.stringify(rendererState)}`);
        }
        const rawEnvironment = await window.webContents.executeJavaScript(
          "window.pyDroidDesktop.getEnvironment()",
        );
        const environment = JSON.parse(rawEnvironment);
        if (!environment.pythonVersion || !environment.packages.some((item) => item.name.toLowerCase() === "pandas")) {
          throw new Error(`Unexpected desktop environment result: ${rawEnvironment}`);
        }
        const runtimeStats = await window.webContents.executeJavaScript("window.pyDroidDesktop.getRuntimeStats()");
        if (!runtimeStats || !Number.isFinite(runtimeStats.memoryBytes) || runtimeStats.memoryBytes <= 0) {
          throw new Error(`Unexpected desktop runtime stats: ${JSON.stringify(runtimeStats)}`);
        }
        const notebook = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["print('ok')\n"] }] });
        const rawAnalysis = await window.webContents.executeJavaScript(`window.pyDroidDesktop.analyzeNotebook(${JSON.stringify(notebook)})`);
        const analysis = JSON.parse(rawAnalysis);
        if (!Array.isArray(analysis.cells) || analysis.cells.length !== 1) {
          throw new Error(`Unexpected notebook analysis result: ${rawAnalysis}`);
        }

        const raw = await window.webContents.executeJavaScript(
          `window.pyDroidDesktop.runWorkflow(${JSON.stringify(payload)})`,
        );
        const result = JSON.parse(raw);
        const exportNames = new Set((result.exports ?? []).map((item) => item.fileName));
        if (
          result.status !== "success"
          || result.preview.totalRows !== 2
          || result.preview.totalColumns !== 3
          || !result.nodeResults?.["read-batch"]
          || exportNames.size !== 2
          || !exportNames.has("desktop-a.csv")
          || !exportNames.has("desktop-b.csv")
        ) {
          throw new Error(`Unexpected smoke-test result: ${raw}`);
        }
        console.log("Desktop Electron/IPC/Python multi-file smoke test passed");
        if (process.env.PYDROID_DESKTOP_SMOKE_LOG) {
          require("node:fs").writeFileSync(process.env.PYDROID_DESKTOP_SMOKE_LOG, "passed\n", "utf8");
        }
        app.exit(0);
      } catch (error) {
        console.error(error);
        if (process.env.PYDROID_DESKTOP_SMOKE_LOG) {
          require("node:fs").writeFileSync(process.env.PYDROID_DESKTOP_SMOKE_LOG, `${error.stack || error}\n`, "utf8");
        }
        app.exit(1);
      }
    });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensureUserProfile();
  ipcMain.handle("pydroid:run-workflow", (_event, payload) => runPythonRequest(payload));
  ipcMain.handle("pydroid:get-environment", () => runPythonRequest({ action: "environment" }));
  ipcMain.handle("pydroid:analyze-notebook", (_event, notebook) => runPythonRequest({ action: "analyze_notebook", notebook }));
  ipcMain.handle("pydroid:get-runtime-stats", async () => {
    const metrics = app.getAppMetrics();
    const memoryBytes = metrics.reduce((total, metric) => total + Math.max(0, metric.memory.workingSetSize) * 1024, 0);
    return { memoryBytes };
  });
  ipcMain.handle("pydroid:start-remote-server", (_event, requirePin) => startDesktopRemoteServer(Boolean(requirePin)));
  ipcMain.handle("pydroid:stop-remote-server", () => stopDesktopRemoteServer());
  ipcMain.handle("pydroid:discover-smb-servers", () => safeSmbOperation(() => discoverSmbServers(), "无法扫描局域网 SMB 设备"));
  ipcMain.handle("pydroid:scan-smb-shares", (_event, connection) => safeSmbOperation(() => scanDesktopSmbShares(connection), "无法扫描 SMB 共享"));
  ipcMain.handle("pydroid:list-smb", (_event, connection, relativePath) => safeSmbOperation(() => listDesktopSmb(connection, relativePath), "无法访问 SMB 文件夹"));
  ipcMain.handle("pydroid:read-smb", (_event, connection, paths) => safeSmbOperation(() => readDesktopSmb(connection, paths), "无法读取 SMB 文件"));
  ipcMain.handle("pydroid:save-smb-secret", (_event, value) => { saveDesktopSmbSecret(value); return { saved: true }; });
  ipcMain.handle("pydroid:load-smb-secret", () => ({ value: loadDesktopSmbSecret() }));
  ipcMain.handle("pydroid:pick-csv", async (_event, mode) => {
    const directory = String(mode).startsWith("directory");
    const properties = directory ? ["openDirectory"] : ["openFile", "multiSelections"];
    const result = await dialog.showOpenDialog({ title: directory ? "选择包含数据文件的文件夹" : "选择数据文件", properties, filters: [{ name: "数据文件", extensions: ["csv", "tsv", "txt", "dat", "json", "png", "jpg", "jpeg"] }, { name: "所有文件", extensions: ["*"] }] });
    if (result.canceled) return [];
    const paths = directory
      ? fs.readdirSync(result.filePaths[0], { withFileTypes: true }).filter((item) => item.isFile() && /\.(csv|tsv|txt|dat|json|png|jpe?g)$/i.test(item.name)).map((item) => path.join(result.filePaths[0], item.name))
      : result.filePaths;
    return paths.map((filePath) => ({ name: path.basename(filePath), base64: fs.readFileSync(filePath).toString("base64") }));
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void stopDesktopRemoteServer();
  if (process.platform !== "darwin") app.quit();
});
