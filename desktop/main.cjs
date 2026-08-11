const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function projectPaths() {
  if (app.isPackaged) {
    return {
      renderer: path.join(app.getAppPath(), "dist-desktop", "index.html"),
      python: path.join(process.resourcesPath, "python"),
    };
  }
  const root = path.resolve(__dirname, "..");
  return {
    renderer: path.join(root, "dist-desktop", "index.html"),
    python: path.join(root, "python"),
  };
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

function runWorkflow(payload) {
  if (!payload || typeof payload.workflow !== "string" || typeof payload.csvText !== "string") {
    return Promise.reject(new Error("workflow and csvText are required"));
  }

  const { python } = projectPaths();
  const script = path.join(python, "pydroid_flow", "desktop_bridge.py");
  const command = pythonCommand(script, python);
  const pythonPath = [python, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      cwd: python,
      env: { ...process.env, PYTHONPATH: pythonPath },
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
    child.stdin.end(JSON.stringify(payload), "utf8");
  });
}

function createWindow() {
  const smokeTest = process.env.PYDROID_DESKTOP_SMOKE === "1";
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f7f8fa",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!smokeTest) window.once("ready-to-show", () => window.show());
  const developmentUrl = process.env.PYDROID_DESKTOP_URL;
  if (developmentUrl) window.loadURL(developmentUrl);
  else window.loadFile(projectPaths().renderer);

  if (smokeTest) {
    window.webContents.once("did-finish-load", async () => {
      const payload = {
        workflow: JSON.stringify({
          schemaVersion: 1,
          name: "desktop smoke test",
          nodes: [{ id: "read", data: { nodeType: "io.read_csv", parameters: { skipRows: 0 } } }],
          edges: [],
        }),
        csvText: "a,b\n1,2\n",
      };
      try {
        const raw = await window.webContents.executeJavaScript(
          `window.pyDroidDesktop.runWorkflow(${JSON.stringify(payload)})`,
        );
        const result = JSON.parse(raw);
        if (result.status !== "success" || result.preview.totalRows !== 2) {
          throw new Error(`Unexpected smoke-test result: ${raw}`);
        }
        console.log("Desktop Electron/IPC/Python smoke test passed");
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
  ipcMain.handle("pydroid:run-workflow", (_event, payload) => runWorkflow(payload));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
