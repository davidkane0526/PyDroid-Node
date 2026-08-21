const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { projectPaths, projectRoot } = require("../services/profile-service.cjs");

function createDesktopWindow({ log }) {
  const smokeTest = process.env.PYDROID_DESKTOP_SMOKE === "1";
  const sharedAppIcon = path.join(projectRoot(), "android", "app", "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher_round.png");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0b1020",
    frame: false,
    ...(fs.existsSync(sharedAppIcon) ? { icon: sharedAppIcon } : {}),
    show: false,
    webPreferences: {
      preload: path.join(projectRoot(), "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => log(`did-fail-load ${code} ${description} ${url}`));
  window.on("maximize", () => window.webContents.send("pydroid:window-maximized-changed", true));
  window.on("unmaximize", () => window.webContents.send("pydroid:window-maximized-changed", false));
  window.webContents.on("render-process-gone", (_event, details) => log(`render-process-gone ${details.reason} ${details.exitCode}`));
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) log(`renderer-console level=${level} ${message} ${sourceId}:${line}`);
  });
  if (!smokeTest) {
    window.once("ready-to-show", () => window.show());
    setTimeout(() => { if (!window.isDestroyed() && !window.isVisible()) window.show(); }, 5000);
  }
  const developmentUrl = process.env.PYDROID_DESKTOP_URL;
  if (developmentUrl) window.loadURL(developmentUrl);
  else window.loadFile(projectPaths(app).renderer);

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
        const rawEnvironment = await window.webContents.executeJavaScript("window.pyDroidDesktop.getEnvironment()");
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
        if (!Array.isArray(analysis.cells) || analysis.cells.length !== 1) throw new Error(`Unexpected notebook analysis result: ${rawAnalysis}`);

        const raw = await window.webContents.executeJavaScript(`window.pyDroidDesktop.runWorkflow(${JSON.stringify(payload)})`);
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
        ) throw new Error(`Unexpected smoke-test result: ${raw}`);

        const remoteBridgeShape = await window.webContents.executeJavaScript(`({
          getRemoteHostStatus: typeof window.pyDroidDesktop?.getRemoteHostStatus === "function"
        })`);
        if (!remoteBridgeShape.getRemoteHostStatus) {
          throw new Error(`Packaged Remote Web bridge is missing getRemoteHostStatus(): ${JSON.stringify(remoteBridgeShape)}`);
        }
        const remoteStatus = await window.webContents.executeJavaScript("window.pyDroidDesktop.getRemoteHostStatus()");
        if (!remoteStatus || remoteStatus.state !== "stopped") {
          throw new Error(`Unexpected packaged Remote Web bridge state: ${JSON.stringify(remoteStatus)}`);
        }
        console.log("Desktop packaged Remote Web bridge/resource contract passed without opening a LAN listener");
        console.log("Desktop Electron/IPC/Python multi-file smoke test passed");
        if (process.env.PYDROID_DESKTOP_SMOKE_LOG) fs.writeFileSync(process.env.PYDROID_DESKTOP_SMOKE_LOG, "passed\n", "utf8");
        app.exit(0);
      } catch (error) {
        console.error(error);
        if (process.env.PYDROID_DESKTOP_SMOKE_LOG) fs.writeFileSync(process.env.PYDROID_DESKTOP_SMOKE_LOG, `${error.stack || error}\n`, "utf8");
        app.exit(1);
      }
    });
  }
  return window;
}

module.exports = { createDesktopWindow };
