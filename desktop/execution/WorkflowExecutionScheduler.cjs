const DEFAULT_CAPACITY = 4;

function lifecycleError(code, executionId, message) {
  const error = new Error(`[${code}] ${executionId}: ${message}`);
  error.code = code;
  error.executionId = executionId;
  return error;
}

class WorkflowExecutionScheduler {
  constructor({ capacity = DEFAULT_CAPACITY, cancelRunning = () => false } = {}) {
    this.capacity = Math.max(1, Math.floor(Number(capacity) || DEFAULT_CAPACITY));
    this.cancelRunning = cancelRunning;
    this.entries = new Map();
    this.queue = [];
  }

  submit(meta, start) {
    const executionId = String(meta?.executionId || "").trim();
    if (!executionId) return Promise.reject(new Error("executionId is required"));
    if (this.entries.has(executionId)) return Promise.reject(new Error(`Execution ${executionId} is already scheduled`));

    return new Promise((resolve, reject) => {
      const entry = {
        executionId,
        workspaceId: String(meta?.workspaceId || "default"),
        clientId: String(meta?.clientId || "unknown"),
        source: meta?.source === "remote" ? "remote" : "local",
        phase: "queued",
        startedAt: null,
        start,
        resolve,
        reject,
      };
      this.entries.set(executionId, entry);
      this.queue.push(executionId);
      this.drain();
    });
  }

  drain() {
    while (this.runningCount() < this.capacity && this.queue.length) {
      const executionId = this.queue.shift();
      const entry = this.entries.get(executionId);
      if (!entry || entry.phase !== "queued") continue;
      entry.phase = "running";
      entry.startedAt = Date.now();
      const finish = () => {
        this.entries.delete(entry.executionId);
        this.drain();
      };
      Promise.resolve()
        .then(() => entry.start())
        .then((value) => { finish(); entry.resolve(value); }, (error) => { finish(); entry.reject(error); });
    }
  }

  cancel(executionId) {
    const id = String(executionId || "").trim();
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.phase === "queued") {
      this.entries.delete(id);
      this.queue = this.queue.filter((queuedId) => queuedId !== id);
      entry.reject(lifecycleError("EXECUTION_CANCELLED", id, "执行已取消"));
      this.drain();
      return true;
    }
    if (entry.phase === "running" || entry.phase === "cancelling") {
      entry.phase = "cancelling";
      return Boolean(this.cancelRunning(id));
    }
    return false;
  }

  cancelWhere(predicate) {
    let count = 0;
    for (const entry of [...this.entries.values()]) {
      if (predicate(entry) && this.cancel(entry.executionId)) count += 1;
    }
    return count;
  }

  has(executionId) { return this.entries.has(String(executionId || "").trim()); }
  runningCount() { return [...this.entries.values()].filter((entry) => entry.phase !== "queued").length; }
  queuedCount() { return [...this.entries.values()].filter((entry) => entry.phase === "queued").length; }

  status() {
    const executions = [...this.entries.values()]
      .map(({ executionId, workspaceId, clientId, source, phase, startedAt }) => ({ executionId, workspaceId, clientId, source, phase, startedAt }))
      .sort((left, right) => {
        if (left.phase === "queued" && right.phase !== "queued") return 1;
        if (left.phase !== "queued" && right.phase === "queued") return -1;
        return (left.startedAt ?? Number.MAX_SAFE_INTEGER) - (right.startedAt ?? Number.MAX_SAFE_INTEGER);
      });
    const first = executions[0] ?? null;
    return {
      active: executions.length > 0,
      executionId: first?.executionId ?? null,
      source: first?.source ?? null,
      executions,
      runningCount: executions.filter((entry) => entry.phase !== "queued").length,
      queuedCount: executions.filter((entry) => entry.phase === "queued").length,
      capacity: this.capacity,
    };
  }
}

module.exports = { WorkflowExecutionScheduler, DEFAULT_CAPACITY };
