import type { RuntimeId } from "./runtime/types";

export const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
export const MIN_EXECUTION_TIMEOUT_MS = 1_000;
export const MAX_EXECUTION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type ExecutionPhase = "idle" | "queued" | "running" | "cancelling" | "cancelled" | "success" | "failed" | "timeout";

export type ExecutionStatus = {
  executionId: string | null;
  phase: ExecutionPhase;
  runtimeId?: RuntimeId;
  timeoutMs?: number;
  startedAt?: number;
  finishedAt?: number;
  message?: string;
};

export type ExecutionControl = {
  executionId: string;
  timeoutMs: number;
  signal: AbortSignal;
};

export class ExecutionBusyError extends Error {
  constructor(public readonly executionId: string) {
    super(`已有工作流正在执行（${executionId}）`);
    this.name = "ExecutionBusyError";
  }
}

export class ExecutionCancelledError extends Error {
  constructor(public readonly executionId: string) {
    super("执行已取消");
    this.name = "ExecutionCancelledError";
  }
}

export class ExecutionTimeoutError extends Error {
  constructor(public readonly executionId: string, public readonly timeoutMs: number) {
    super(`执行超时（${Math.max(1, Math.round(timeoutMs / 1000))} 秒）`);
    this.name = "ExecutionTimeoutError";
  }
}

type Listener = (status: ExecutionStatus) => void;
type ActiveExecution = {
  control: ExecutionControl;
  abortController: AbortController;
  runtimeId: RuntimeId;
  startedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
  timeoutTriggered: boolean;
  abortReject: (reason: unknown) => void;
};

function normalizeTimeout(timeoutMs?: number): number {
  const value = Number(timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS);
  if (!Number.isFinite(value)) return DEFAULT_EXECUTION_TIMEOUT_MS;
  return Math.min(MAX_EXECUTION_TIMEOUT_MS, Math.max(MIN_EXECUTION_TIMEOUT_MS, Math.round(value)));
}

function createExecutionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function looksLikeTimeout(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text.includes("[EXECUTION_TIMEOUT]") || /execution[_ ]?timeout/i.test(text);
}

function looksLikeCancellation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text.includes("[EXECUTION_CANCELLED]") || /execution[_ ]?cancelled/i.test(text);
}

export class ExecutionController {
  private active: ActiveExecution | null = null;
  private status: ExecutionStatus = { executionId: null, phase: "idle" };
  private readonly listeners = new Set<Listener>();

  getStatus(): ExecutionStatus { return { ...this.status }; }
  isActive(): boolean { return Boolean(this.active); }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private publish(next: ExecutionStatus): void {
    this.status = next;
    for (const listener of this.listeners) listener(this.getStatus());
  }

  async execute<T>(
    runtimeId: RuntimeId,
    runner: (control: ExecutionControl) => Promise<T>,
    options: { timeoutMs?: number; executionId?: string } = {},
  ): Promise<T> {
    if (this.active) throw new ExecutionBusyError(this.active.control.executionId);

    const executionId = options.executionId?.trim() || createExecutionId();
    const timeoutMs = normalizeTimeout(options.timeoutMs);
    const abortController = new AbortController();
    const startedAt = Date.now();
    let abortReject: ((reason: unknown) => void) | null = null;
    const abortPromise = new Promise<never>((_resolve, reject) => { abortReject = reject; });

    this.publish({ executionId, phase: "queued", runtimeId, timeoutMs });

    const active: ActiveExecution = {
      control: { executionId, timeoutMs, signal: abortController.signal },
      abortController,
      runtimeId,
      startedAt,
      timeoutTriggered: false,
      abortReject: (reason) => abortReject?.(reason),
      timeoutHandle: setTimeout(() => {
        if (this.active !== active) return;
        active.timeoutTriggered = true;
        const error = new ExecutionTimeoutError(executionId, timeoutMs);
        abortController.abort(error);
        active.abortReject(error);
      }, timeoutMs),
    };
    this.active = active;
    this.publish({ executionId, phase: "running", runtimeId, timeoutMs, startedAt });

    try {
      const result = await Promise.race([runner(active.control), abortPromise]);
      this.publish({ executionId, phase: "success", runtimeId, timeoutMs, startedAt, finishedAt: Date.now() });
      return result;
    } catch (error) {
      if (active.timeoutTriggered || error instanceof ExecutionTimeoutError || looksLikeTimeout(error)) {
        const timeoutError = error instanceof ExecutionTimeoutError ? error : new ExecutionTimeoutError(executionId, timeoutMs);
        this.publish({ executionId, phase: "timeout", runtimeId, timeoutMs, startedAt, finishedAt: Date.now(), message: timeoutError.message });
        throw timeoutError;
      }
      if (abortController.signal.aborted || error instanceof ExecutionCancelledError || looksLikeCancellation(error)) {
        const cancelled = error instanceof ExecutionCancelledError ? error : new ExecutionCancelledError(executionId);
        this.publish({ executionId, phase: "cancelled", runtimeId, timeoutMs, startedAt, finishedAt: Date.now(), message: cancelled.message });
        throw cancelled;
      }
      const message = error instanceof Error ? error.message : String(error ?? "执行失败");
      this.publish({ executionId, phase: "failed", runtimeId, timeoutMs, startedAt, finishedAt: Date.now(), message });
      throw error;
    } finally {
      clearTimeout(active.timeoutHandle);
      if (this.active === active) this.active = null;
    }
  }

  cancel(): boolean {
    const active = this.active;
    if (!active) return false;
    if (!active.abortController.signal.aborted) {
      this.publish({
        executionId: active.control.executionId,
        phase: "cancelling",
        runtimeId: active.runtimeId,
        timeoutMs: active.control.timeoutMs,
        startedAt: active.startedAt,
      });
      const error = new ExecutionCancelledError(active.control.executionId);
      active.abortController.abort(error);
      active.abortReject(error);
      // The host adapters also receive this signal and terminate the underlying Python work.
    }
    return true;
  }

  cleanup(): void {
    this.cancel();
    if (!this.active) this.publish({ executionId: null, phase: "idle" });
  }
}

export const executionController = new ExecutionController();
