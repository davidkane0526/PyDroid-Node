const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PythonProcessController } = require("../execution/PythonProcessController.cjs");
const { WorkflowExecutionScheduler } = require("../execution/WorkflowExecutionScheduler.cjs");
const { projectPaths } = require("./profile-service.cjs");

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;

function pythonCommand(app, scriptPath, pythonRoot) {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return { executable: configured, args: [scriptPath] };
  if (process.platform === "win32") {
    const projectPython = app.isPackaged
      ? path.join(process.resourcesPath, "python-runtime", "python.exe")
      : path.join(path.dirname(pythonRoot), ".tools", "python313-runtime", "python.exe");
    if (fs.existsSync(projectPython)) return { executable: projectPython, args: [scriptPath] };
    return { executable: "py", args: ["-3.13", scriptPath] };
  }
  return { executable: "python3.13", args: [scriptPath] };
}

function createPythonWorkflowService({ app, log }) {
  const processController = new PythonProcessController({ maxOutputBytes: MAX_OUTPUT_BYTES, log });
  const desktopPythonConcurrency = Math.max(1, Math.min(4, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length));
  const scheduler = new WorkflowExecutionScheduler({
    capacity: desktopPythonConcurrency,
    cancelRunning: (executionId) => processController.cancel(executionId),
  });

  function runRequest(payload, metadata = {}) {
    const isUtilityRequest = payload?.action === "environment" || payload?.action === "analyze_notebook" || payload?.action === "analyze_signature";
    if (!isUtilityRequest && (!payload || typeof payload.workflow !== "string" || typeof payload.csvText !== "string" || typeof payload.inputFiles !== "string")) {
      return Promise.reject(new Error("workflow, csvText, and inputFiles are required"));
    }

    const { python } = projectPaths(app);
    const script = path.join(python, "pydroid_flow", "desktop_bridge.py");
    const command = pythonCommand(app, script, python);
    const pythonPath = [python, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const executionId = String(payload?.executionId || `${isUtilityRequest ? "utility" : "exec"}-${crypto.randomUUID()}`);
    const timeoutMs = Number(payload?.timeoutMs ?? (isUtilityRequest ? 60_000 : DEFAULT_EXECUTION_TIMEOUT_MS));
    const start = () => processController.execute({
      executionId,
      timeoutMs,
      executable: command.executable,
      args: [...command.args],
      cwd: python,
      env: { ...process.env, PYTHONPATH: pythonPath, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      payload,
    });

    if (isUtilityRequest) return start();
    return scheduler.submit({
      executionId,
      workspaceId: metadata.workspaceId ?? payload?.workspaceId ?? "default",
      workspaceLabel: metadata.workspaceLabel ?? payload?.workspaceLabel ?? "工作流",
      clientId: metadata.clientId ?? payload?.clientId ?? "local-ui",
      source: metadata.source ?? "local",
    }, start);
  }

  function status() { return scheduler.status(); }
  function cancel(executionId) { return scheduler.cancel(executionId); }

  async function cancelAndWait(executionId, waitMs = 5000) {
    const id = String(executionId || "").trim();
    const cancelled = cancel(id);
    if (!cancelled) return { cancelled: false, released: !scheduler.has(id) };
    const deadline = Date.now() + Math.max(0, waitMs);
    while (scheduler.has(id) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return { cancelled: true, released: !scheduler.has(id) };
  }

  function shutdown() {
    scheduler.cancelWhere(() => true);
    processController.cancelAll();
  }

  return { runRequest, status, cancel, cancelAndWait, shutdown, DEFAULT_EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES };
}

module.exports = { createPythonWorkflowService, DEFAULT_EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES };
