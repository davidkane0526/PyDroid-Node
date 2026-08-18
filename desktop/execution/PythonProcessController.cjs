const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const TERMINATION_CONFIRM_TIMEOUT_MS = 5_000;

function normalizeTimeout(value) {
  const number = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(number)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(number)));
}

function executionError(code, executionId, message) {
  const error = new Error(`[${code}] ${executionId}: ${message}`);
  error.code = code;
  error.executionId = executionId;
  return error;
}

class PythonProcessController {
  constructor({ maxOutputBytes = 64 * 1024 * 1024, log = () => {}, spawnProcess = spawn, platform = process.platform } = {}) {
    this.maxOutputBytes = maxOutputBytes;
    this.log = log;
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.active = new Map();
  }

  execute({ executionId, timeoutMs, executable, args = [], cwd, env, payload }) {
    const id = String(executionId || "").trim();
    if (!id) return Promise.reject(new Error("executionId is required"));
    if (this.active.has(id)) return Promise.reject(new Error(`Execution ${id} is already active`));
    const effectiveTimeout = normalizeTimeout(timeoutMs);

    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(executable, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout = [];
      const stderr = [];
      let outputBytes = 0;
      let settled = false;
      let terminationError = null;
      let terminationConfirmTimer = null;

      const cleanup = () => {
        const entry = this.active.get(id);
        if (entry?.timer) clearTimeout(entry.timer);
        if (terminationConfirmTimer) clearTimeout(terminationConfirmTimer);
        if (this.active.get(id)?.child === child) this.active.delete(id);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const requestTermination = (error) => {
        if (settled || terminationError) return;
        terminationError = error;
        this.terminate(child);
        // Do not publish logical completion until the OS confirms the Python process has
        // actually closed. This prevents idle -> EXECUTION_BUSY races and prevents a killed
        // workflow from continuing to emit late output after the UI already says idle.
        terminationConfirmTimer = setTimeout(() => {
          this.log(`[Execution] termination confirmation timed out id=${id} pid=${child.pid ?? "unknown"}`);
          this.terminate(child);
          finishReject(error);
        }, TERMINATION_CONFIRM_TIMEOUT_MS);
        terminationConfirmTimer.unref?.();
      };
      const collect = (target) => (chunk) => {
        if (settled || terminationError) return;
        outputBytes += chunk.length;
        if (outputBytes > this.maxOutputBytes) {
          requestTermination(executionError("EXECUTION_OUTPUT_LIMIT", id, "Python execution output exceeded 64 MiB"));
          return;
        }
        target.push(chunk);
      };

      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.once("error", (error) => finishReject(new Error(`Unable to start Python 3.13: ${error.message}`)));
      child.once("close", (code) => {
        if (terminationError) {
          finishReject(terminationError);
          return;
        }
        if (settled) { cleanup(); return; }
        const errorText = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0) {
          finishReject(new Error(errorText || `Python execution exited with code ${code}`));
          return;
        }
        finishResolve(Buffer.concat(stdout).toString("utf8").trim());
      });

      const timer = setTimeout(() => {
        this.log(`[Execution] timeout id=${id} pid=${child.pid ?? "unknown"} timeoutMs=${effectiveTimeout}`);
        requestTermination(executionError("EXECUTION_TIMEOUT", id, `执行超时（${Math.round(effectiveTimeout / 1000)} 秒）`));
      }, effectiveTimeout);
      timer.unref?.();

      this.active.set(id, {
        child,
        timer,
        cancel: () => {
          this.log(`[Execution] cancel id=${id} pid=${child.pid ?? "unknown"}`);
          requestTermination(executionError("EXECUTION_CANCELLED", id, "执行已取消"));
        },
      });

      try {
        const requestFrame = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
        child.stdin.end(`PYDROID_FLOW_BASE64_V1\n${requestFrame}`, "ascii");
      } catch (error) {
        requestTermination(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  cancel(executionId) {
    const entry = this.active.get(String(executionId || "").trim());
    if (!entry) return false;
    entry.cancel();
    return true;
  }

  cancelAll() {
    for (const entry of [...this.active.values()]) entry.cancel();
  }

  activeCount() { return this.active.size; }

  terminate(child) {
    if (!child) return;
    if (!child.killed) {
      try { child.kill("SIGKILL"); } catch {}
    }
    if (this.platform === "win32" && child.pid) {
      try {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 5_000,
        });
      } catch {}
    }
  }
}

module.exports = {
  PythonProcessController,
  DEFAULT_TIMEOUT_MS,
  normalizeTimeout,
};
