import type { RuntimeId } from "./runtime/types";

export const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
export const MIN_EXECUTION_TIMEOUT_MS = 1_000;
export const MAX_EXECUTION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const CANCELLATION_CLEANUP_TIMEOUT_MS = 5_000;

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
  workspaceId?: string;
  clientId?: string;
  signal: AbortSignal;
  registerCancellationHandler(handler: () => Promise<unknown> | unknown): () => void;
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
type CancelHandler = () => Promise<unknown> | unknown;
type ActiveExecution = {
  control: ExecutionControl;
  abortController: AbortController;
  runtimeId: RuntimeId;
  startedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  timeoutTriggered: boolean;
  abortReject: (reason: unknown) => void;
  cancelHandlers: Set<CancelHandler>;
  cancellationPromise: Promise<void> | null;
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  private beginCancellation(active: ActiveExecution, reason: Error): Promise<void> {
    if (active.cancellationPromise) return active.cancellationPromise;
    if (!active.abortController.signal.aborted) active.abortController.abort(reason);
    const handlers = [...active.cancelHandlers];
    active.cancellationPromise = (async () => {
      if (!handlers.length) return;
      const cleanup = Promise.allSettled(handlers.map((handler) => Promise.resolve().then(handler))).then(() => undefined);
      await Promise.race([cleanup, wait(CANCELLATION_CLEANUP_TIMEOUT_MS)]);
    })();
    return active.cancellationPromise;
  }

  async execute<T>(
    runtimeId: RuntimeId,
    runner: (control: ExecutionControl) => Promise<T>,
    options: { timeoutMs?: number; executionId?: string; enforceTimeout?: boolean } = {},
  ): Promise<T> {
    if (this.active) throw new ExecutionBusyError(this.active.control.executionId);

    const executionId = options.executionId?.trim() || createExecutionId();
    const timeoutMs = normalizeTimeout(options.timeoutMs);
    const abortController = new AbortController();
    const startedAt = Date.now();
    let abortReject: ((reason: unknown) => void) | null = null;
    const abortPromise = new Promise<never>((_resolve, reject) => { abortReject = reject; });
    const cancelHandlers = new Set<CancelHandler>();
    const control: ExecutionControl = {
      executionId,
      timeoutMs,
      signal: abortController.signal,
      registerCancellationHandler(handler) {
        cancelHandlers.add(handler);
        return () => cancelHandlers.delete(handler);
      },
    };

    this.publish({ executionId, phase: "queued", runtimeId, timeoutMs });

    const active: ActiveExecution = {
      control,
      abortController,
      runtimeId,
      startedAt,
      timeoutTriggered: false,
      abortReject: (reason) => abortReject?.(reason),
      cancelHandlers,
      cancellationPromise: null,
      timeoutHandle: null,
    };
    this.active = active;
    if (options.enforceTimeout !== false) {
      active.timeoutHandle = setTimeout(() => {
        if (this.active !== active) return;
        active.timeoutTriggered = true;
        const error = new ExecutionTimeoutError(executionId, timeoutMs);
        void this.beginCancellation(active, error);
        active.abortReject(error);
      }, timeoutMs);
    }
    this.publish({ executionId, phase: "running", runtimeId, timeoutMs, startedAt });

    try {
      const result = await Promise.race([runner(active.control), abortPromise]);
      this.publish({ executionId, phase: "success", runtimeId, timeoutMs, startedAt, finishedAt: Date.now() });
      return result;
    } catch (error) {
      if (active.timeoutTriggered || error instanceof ExecutionTimeoutError || looksLikeTimeout(error)) {
        const timeoutError = error instanceof ExecutionTimeoutError ? error : new ExecutionTimeoutError(executionId, timeoutMs);
        await this.beginCancellation(active, timeoutError);
        this.publish({ executionId, phase: "timeout", runtimeId, timeoutMs, startedAt, finishedAt: Date.now(), message: timeoutError.message });
        throw timeoutError;
      }
      if (abortController.signal.aborted || error instanceof ExecutionCancelledError || looksLikeCancellation(error)) {
        const cancelled = error instanceof ExecutionCancelledError ? error : new ExecutionCancelledError(executionId);
        await this.beginCancellation(active, cancelled);
        this.publish({ executionId, phase: "cancelled", runtimeId, timeoutMs, startedAt, finishedAt: Date.now(), message: cancelled.message });
        throw cancelled;
      }
      const message = error instanceof Error ? error.message : String(error ?? "执行失败");
      this.publish({ executionId, phase: "failed", runtimeId, timeoutMs, startedAt, finishedAt: Date.now(), message });
      throw error;
    } finally {
      if (active.timeoutHandle) clearTimeout(active.timeoutHandle);
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
      void this.beginCancellation(active, error);
      active.abortReject(error);
    }
    return true;
  }

  cleanup(): void {
    this.cancel();
    if (!this.active) this.publish({ executionId: null, phase: "idle" });
  }
}

export class ExecutionManager {
  private readonly controllers = new Map<string, ExecutionController>();

  controller(workspaceId = "default"): ExecutionController {
    const key = workspaceId.trim() || "default";
    let controller = this.controllers.get(key);
    if (!controller) {
      controller = new ExecutionController();
      this.controllers.set(key, controller);
    }
    return controller;
  }

  getStatus(workspaceId = "default"): ExecutionStatus { return this.controller(workspaceId).getStatus(); }
  isActive(workspaceId = "default"): boolean { return this.controller(workspaceId).isActive(); }
  subscribe(workspaceId: string, listener: Listener): () => void { return this.controller(workspaceId).subscribe(listener); }
  cancel(workspaceId = "default"): boolean { return this.controller(workspaceId).cancel(); }
  cleanup(workspaceId = "default"): void { this.controller(workspaceId).cleanup(); }
  activeWorkspaceIds(): string[] {
    return [...this.controllers.entries()].filter(([, controller]) => controller.isActive()).map(([workspaceId]) => workspaceId);
  }

  execute<T>(
    workspaceId: string,
    runtimeId: RuntimeId,
    runner: (control: ExecutionControl) => Promise<T>,
    options: { timeoutMs?: number; executionId?: string; enforceTimeout?: boolean } = {},
  ): Promise<T> {
    return this.controller(workspaceId).execute(runtimeId, runner, options);
  }
}

export const executionManager = new ExecutionManager();
// Backward-compatible default controller for focused unit tests and older internal callers.
export const executionController = executionManager.controller("default");
