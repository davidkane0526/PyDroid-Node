package com.dk.pydroidflow;

import java.util.concurrent.Callable;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Owns workflow-execution lifecycle on Android. Utility Python calls deliberately stay outside this
 * controller so one long workflow cannot silently share lifecycle state with SMB/profile work.
 */
final class PythonExecutionController implements AutoCloseable {
    static final long DEFAULT_TIMEOUT_MS = 10L * 60L * 1000L;
    private static final long MIN_TIMEOUT_MS = 1_000L;
    private static final long MAX_TIMEOUT_MS = 24L * 60L * 60L * 1000L;

    enum EndReason { NONE, CANCELLED, TIMEOUT }

    static final class ControlledExecution {
        final String executionId;
        final long timeoutMs;
        final Future<String> future;
        final AtomicReference<EndReason> endReason;
        volatile ScheduledFuture<?> timeoutFuture;

        ControlledExecution(String executionId, long timeoutMs, Future<String> future, AtomicReference<EndReason> endReason) {
            this.executionId = executionId;
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

    synchronized ControlledExecution submit(String requestedExecutionId, long requestedTimeoutMs, Callable<String> callable) throws Exception {
        String executionId = requestedExecutionId == null ? "" : requestedExecutionId.trim();
        if (executionId.isEmpty()) throw new IllegalArgumentException("executionId is required");
        if (!active.isEmpty()) {
            String current = active.keySet().iterator().next();
            throw new LifecycleException("EXECUTION_BUSY", executionId, "已有工作流正在执行（" + current + "）");
        }
        long timeoutMs = normalizeTimeout(requestedTimeoutMs);
        AtomicReference<EndReason> reason = new AtomicReference<>(EndReason.NONE);
        Future<String> future = executionWorker.submit(callable);
        ControlledExecution execution = new ControlledExecution(executionId, timeoutMs, future, reason);
        if (active.putIfAbsent(executionId, execution) != null) {
            future.cancel(true);
            throw new IllegalStateException("Execution " + executionId + " is already active");
        }
        execution.timeoutFuture = timeoutWorker.schedule(() -> {
            if (reason.compareAndSet(EndReason.NONE, EndReason.TIMEOUT)) future.cancel(true);
        }, timeoutMs, TimeUnit.MILLISECONDS);
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
        } finally {
            cleanup(execution);
        }
    }

    boolean cancel(String executionId) {
        ControlledExecution execution = active.get(executionId == null ? "" : executionId.trim());
        if (execution == null) return false;
        if (execution.endReason.compareAndSet(EndReason.NONE, EndReason.CANCELLED)) execution.future.cancel(true);
        return true;
    }

    int activeCount() { return active.size(); }

    private void cleanup(ControlledExecution execution) {
        active.remove(execution.executionId, execution);
        ScheduledFuture<?> timeout = execution.timeoutFuture;
        if (timeout != null) timeout.cancel(false);
    }

    private static long normalizeTimeout(long value) {
        if (value <= 0) return DEFAULT_TIMEOUT_MS;
        return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value));
    }

    @Override
    public void close() {
        for (ControlledExecution execution : active.values()) cancel(execution.executionId);
        timeoutWorker.shutdownNow();
        executionWorker.shutdownNow();
        active.clear();
    }
}
