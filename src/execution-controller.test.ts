import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExecutionBusyError,
  ExecutionCancelledError,
  ExecutionController,
  ExecutionManager,
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
  it("can delegate the timeout clock to a queued host scheduler", async () => {
    vi.useFakeTimers();
    const controller = new ExecutionController();
    const run = controller.execute("python", async () => new Promise<string>(() => {}), {
      executionId: "exec-host-timeout",
      timeoutMs: 1_000,
      enforceTimeout: false,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.isActive()).toBe(true);
    expect(controller.getStatus().phase).toBe("running");
    controller.cancel();
    await expect(run).rejects.toBeInstanceOf(ExecutionCancelledError);
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


describe("ExecutionManager", () => {
  it("allows independent workspaces to execute concurrently", async () => {
    const manager = new ExecutionManager();
    let releaseA!: () => void;
    const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
    const first = manager.execute("workspace-a", "python", async () => { await aGate; return "A"; }, { executionId: "exec-a" });
    const second = manager.execute("workspace-b", "python", async () => "B", { executionId: "exec-b" });
    await expect(second).resolves.toBe("B");
    expect(manager.isActive("workspace-a")).toBe(true);
    expect(manager.isActive("workspace-b")).toBe(false);
    expect(manager.activeWorkspaceIds()).toContain("workspace-a");
    releaseA();
    await expect(first).resolves.toBe("A");
  });

  it("keeps identical workspace names isolated when callers use full session keys", async () => {
    const manager = new ExecutionManager();
    const localKey = "local:desktop-client:default";
    const remoteKey = "remote:web-client:default";
    let releaseLocal!: () => void;
    let releaseRemote!: () => void;
    const localGate = new Promise<void>((resolve) => { releaseLocal = resolve; });
    const remoteGate = new Promise<void>((resolve) => { releaseRemote = resolve; });

    const local = manager.execute(localKey, "javascript", async () => { await localGate; return "local"; }, { executionId: "exec-local" });
    const remote = manager.execute(remoteKey, "javascript", async () => { await remoteGate; return "remote"; }, { executionId: "exec-remote" });

    expect(manager.isActive(localKey)).toBe(true);
    expect(manager.isActive(remoteKey)).toBe(true);
    expect(manager.activeWorkspaceIds().sort()).toEqual([localKey, remoteKey].sort());

    releaseRemote();
    await expect(remote).resolves.toBe("remote");
    expect(manager.isActive(localKey)).toBe(true);
    releaseLocal();
    await expect(local).resolves.toBe("local");
  });
});
