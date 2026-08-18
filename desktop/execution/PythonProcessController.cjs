const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

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

      const cleanup = () => {
        const entry = this.active.get(id);
        if (entry?.timer) clearTimeout(entry.timer);
        if (this.active.get(id)?.child === child) this.active.delete(id);
      };
      const finishReject = (error, terminate = false) => {
        if (settled) return;
        settled = true;
        if (terminate) this.terminate(child);
        cleanup();
        reject(error);
      };
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const collect = (target) => (chunk) => {
        if (settled) return;
        outputBytes += chunk.length;
        if (outputBytes > this.maxOutputBytes) {
          finishReject(executionError("EXECUTION_OUTPUT_LIMIT", id, "Python execution output exceeded 64 MiB"), true);
          return;
        }
        target.push(chunk);
      };

      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.once("error", (error) => finishReject(new Error(`Unable to start Python 3.13: ${error.message}`)));
      child.once("close", (code) => {
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
        finishReject(executionError("EXECUTION_TIMEOUT", id, `执行超时（${Math.round(effectiveTimeout / 1000)} 秒）`), true);
      }, effectiveTimeout);
      timer.unref?.();

      this.active.set(id, {
        child,
        timer,
        cancel: () => {
          this.log(`[Execution] cancel id=${id} pid=${child.pid ?? "unknown"}`);
          finishReject(executionError("EXECUTION_CANCELLED", id, "执行已取消"), true);
        },
      });

      try {
        const requestFrame = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
        child.stdin.end(`PYDROID_FLOW_BASE64_V1\n${requestFrame}`, "ascii");
      } catch (error) {
        finishReject(error instanceof Error ? error : new Error(String(error)), true);
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
    if (!child || child.killed) return;
    try { child.kill("SIGKILL"); } catch {}
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
