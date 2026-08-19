package com.dk.pydroidflow;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Android workflow scheduler. Chaquopy uses one embedded interpreter, so Python work is serialized
 * through a single worker while multiple workspaces/remote clients may enqueue independent jobs.
 * Queued jobs can be cancelled immediately; running jobs keep their slot until the Python callable
 * really exits, preserving the Phase 2 no-false-idle guarantee.
 */
final class PythonExecutionController implements AutoCloseable {
    static final long DEFAULT_TIMEOUT_MS = 10L * 60L * 1000L;
    private static final long MIN_TIMEOUT_MS = 1_000L;
    private static final long MAX_TIMEOUT_MS = 24L * 60L * 60L * 1000L;

    enum EndReason { NONE, CANCELLED, TIMEOUT }
    enum Phase { QUEUED, RUNNING, CANCELLING }

    static final class ExecutionSnapshot {
        final String executionId;
        final String workspaceId;
        final String clientId;
        final String source;
        final Phase phase;
        final Long startedAt;

        ExecutionSnapshot(ControlledExecution execution) {
            executionId = execution.executionId;
            workspaceId = execution.workspaceId;
            clientId = execution.clientId;
            source = execution.source;
            phase = execution.phase;
            startedAt = execution.startedAt;
        }
    }

    static final class ControlledExecution {
        final String executionId;
        final String workspaceId;
        final String clientId;
        final String source;
        final long timeoutMs;
        final FutureTask<String> future;
        final AtomicReference<EndReason> endReason;
        volatile Phase phase = Phase.QUEUED;
        volatile Long startedAt;
        volatile ScheduledFuture<?> timeoutFuture;

        ControlledExecution(String executionId, String workspaceId, String clientId, String source, long timeoutMs, FutureTask<String> future, AtomicReference<EndReason> endReason) {
            this.executionId = executionId;
            this.workspaceId = workspaceId;
            this.clientId = clientId;
            this.source = source;
            this.timeoutMs = timeoutMs;
            this.future = future;
            this.endReason = endReason;
        }
    }

    static final class LifecycleException extends Exception {
        final String code;
        final String executionId;

        LifecycleException(String code, String executionId, String message) {
            super("[" + code + "] " + executionId + ": " + message);
            this.code = code;
            this.executionId = executionId;
        }
    }

    private final ExecutorService executionWorker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "pydroid-python-execution");
        thread.setDaemon(true);
        return thread;
    });
    private final ScheduledExecutorService timeoutWorker = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "pydroid-python-timeout");
        thread.setDaemon(true);
        return thread;
    });
    private final ConcurrentHashMap<String, ControlledExecution> active = new ConcurrentHashMap<>();

    ControlledExecution submit(String requestedExecutionId, long requestedTimeoutMs, Callable<String> callable) throws Exception {
        return submit(requestedExecutionId, requestedTimeoutMs, "local", "default", "local-ui", callable);
    }

    synchronized ControlledExecution submit(String requestedExecutionId, long requestedTimeoutMs, String source, String workspaceId, String clientId, Callable<String> callable) throws Exception {
        String executionId = requestedExecutionId == null ? "" : requestedExecutionId.trim();
        if (executionId.isEmpty()) throw new IllegalArgumentException("executionId is required");
        if (active.containsKey(executionId)) throw new IllegalStateException("Execution " + executionId + " is already active");

        long timeoutMs = normalizeTimeout(requestedTimeoutMs);
        AtomicReference<EndReason> reason = new AtomicReference<>(EndReason.NONE);
        AtomicReference<ControlledExecution> holder = new AtomicReference<>();
        FutureTask<String> task = new FutureTask<>(() -> {
            ControlledExecution execution = holder.get();
            if (execution == null) throw new IllegalStateException("Execution metadata unavailable");
            execution.phase = Phase.RUNNING;
            execution.startedAt = System.currentTimeMillis();
            execution.timeoutFuture = timeoutWorker.schedule(() -> timeout(execution), timeoutMs, TimeUnit.MILLISECONDS);
            try {
                return callable.call();
            } finally {
                cleanupWhenWorkerExited(execution);
            }
        });
        ControlledExecution execution = new ControlledExecution(
            executionId,
            normalizeText(workspaceId, "default"),
            normalizeText(clientId, "unknown"),
            "remote".equals(source) ? "remote" : "local",
            timeoutMs,
            task,
            reason
        );
        holder.set(execution);
        if (active.putIfAbsent(executionId, execution) != null) throw new IllegalStateException("Execution " + executionId + " is already active");
        executionWorker.execute(task);
        return execution;
    }

    String await(ControlledExecution execution) throws Exception {
        try {
            return execution.future.get();
        } catch (CancellationException cancelled) {
            EndReason reason = execution.endReason.get();
            if (reason == EndReason.TIMEOUT) {
                throw new LifecycleException("EXECUTION_TIMEOUT", execution.executionId,
                    "执行超时（" + Math.max(1L, Math.round(execution.timeoutMs / 1000.0)) + " 秒）");
            }
            throw new LifecycleException("EXECUTION_CANCELLED", execution.executionId, "执行已取消");
        } catch (ExecutionException wrapped) {
            Throwable cause = wrapped.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw wrapped;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw interrupted;
        }
    }

    boolean cancel(String executionId) {
        ControlledExecution execution = active.get(executionId == null ? "" : executionId.trim());
        if (execution == null) return false;
        if (!execution.endReason.compareAndSet(EndReason.NONE, EndReason.CANCELLED)) return true;

        if (execution.phase == Phase.QUEUED) {
            execution.future.cancel(false);
            cleanupQueued(execution);
            return true;
        }
        execution.phase = Phase.CANCELLING;
        PythonExecutionCancellation.cancel(execution.executionId);
        execution.future.cancel(true);
        return true;
    }

    int activeCount() { return active.size(); }
    int runningCount() { return (int) active.values().stream().filter(item -> item.phase != Phase.QUEUED).count(); }
    int queuedCount() { return (int) active.values().stream().filter(item -> item.phase == Phase.QUEUED).count(); }
    int capacity() { return 1; }

    String currentExecutionId() {
        List<ExecutionSnapshot> snapshots = snapshots();
        return snapshots.isEmpty() ? null : snapshots.get(0).executionId;
    }

    List<ExecutionSnapshot> snapshots() {
        ArrayList<ExecutionSnapshot> result = new ArrayList<>();
        for (ControlledExecution execution : active.values()) result.add(new ExecutionSnapshot(execution));
        result.sort(Comparator
            .comparing((ExecutionSnapshot item) -> item.phase == Phase.QUEUED ? 1 : 0)
            .thenComparing(item -> item.startedAt == null ? Long.MAX_VALUE : item.startedAt)
            .thenComparing(item -> item.executionId));
        return result;
    }

    private void timeout(ControlledExecution execution) {
        if (!active.containsKey(execution.executionId)) return;
        if (execution.endReason.compareAndSet(EndReason.NONE, EndReason.TIMEOUT)) {
            execution.phase = Phase.CANCELLING;
            PythonExecutionCancellation.cancel(execution.executionId);
            execution.future.cancel(true);
        }
    }

    private void cleanupQueued(ControlledExecution execution) {
        active.remove(execution.executionId, execution);
        PythonExecutionCancellation.clear(execution.executionId);
        ScheduledFuture<?> timeout = execution.timeoutFuture;
        if (timeout != null) timeout.cancel(false);
    }

    private void cleanupWhenWorkerExited(ControlledExecution execution) {
        active.remove(execution.executionId, execution);
        PythonExecutionCancellation.clear(execution.executionId);
        ScheduledFuture<?> timeout = execution.timeoutFuture;
        if (timeout != null) timeout.cancel(false);
    }

    private static String normalizeText(String value, String fallback) {
        String text = value == null ? "" : value.trim();
        return text.isEmpty() ? fallback : text;
    }

    private static long normalizeTimeout(long value) {
        if (value <= 0) return DEFAULT_TIMEOUT_MS;
        return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value));
    }

    @Override
    public void close() {
        for (ControlledExecution execution : new ArrayList<>(active.values())) cancel(execution.executionId);
        timeoutWorker.shutdownNow();
        executionWorker.shutdownNow();
        active.clear();
    }
}
