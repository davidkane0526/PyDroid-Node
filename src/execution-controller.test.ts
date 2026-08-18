import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExecutionBusyError,
  ExecutionCancelledError,
  ExecutionController,
  ExecutionTimeoutError,
} from "./execution-controller";

afterEach(() => vi.useRealTimers());

describe("ExecutionController", () => {
  it("publishes success and releases the active execution", async () => {
    const controller = new ExecutionController();
    const phases: string[] = [];
    controller.subscribe((status) => phases.push(status.phase));
    const result = await controller.execute("python", async ({ executionId }) => executionId, { executionId: "exec-success" });
    expect(result).toBe("exec-success");
    expect(controller.isActive()).toBe(false);
    expect(controller.getStatus().phase).toBe("success");
    expect(phases).toEqual(expect.arrayContaining(["queued", "running", "success"]));
  });

  it("rejects a second execution while one is active and cancels the first", async () => {
    const controller = new ExecutionController();
    const first = controller.execute("python", async () => new Promise<string>(() => {}), { executionId: "exec-first" });
    await expect(controller.execute("javascript", async () => "second", { executionId: "exec-second" })).rejects.toBeInstanceOf(ExecutionBusyError);
    expect(controller.cancel()).toBe(true);
    await expect(first).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(controller.getStatus().phase).toBe("cancelled");
    expect(controller.isActive()).toBe(false);
  });

  it("transitions to timeout and aborts the host signal", async () => {
    vi.useFakeTimers();
    const controller = new ExecutionController();
    let aborted = false;
    const run = controller.execute("python", async ({ signal }) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return new Promise<string>(() => {});
    }, { executionId: "exec-timeout", timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(run).rejects.toBeInstanceOf(ExecutionTimeoutError);
    expect(aborted).toBe(true);
    expect(controller.getStatus().phase).toBe("timeout");
  });
  it("does not publish cancelled until host cancellation cleanup finishes", async () => {
    const controller = new ExecutionController();
    let releaseHost!: () => void;
    const hostReleased = new Promise<void>((resolve) => { releaseHost = resolve; });
    const run = controller.execute("python", async ({ registerCancellationHandler }) => {
      registerCancellationHandler(() => hostReleased);
      return new Promise<string>(() => {});
    }, { executionId: "exec-host-release" });

    expect(controller.cancel()).toBe(true);
    await Promise.resolve();
    expect(controller.getStatus().phase).toBe("cancelling");
    expect(controller.isActive()).toBe(true);

    releaseHost();
    await expect(run).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(controller.getStatus().phase).toBe("cancelled");
    expect(controller.isActive()).toBe(false);
  });

});
