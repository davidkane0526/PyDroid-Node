package com.dk.pydroidflow;

import java.util.concurrent.ConcurrentHashMap;

/** Public bridge queried by Chaquopy Python tracing to cooperatively stop pure-Python work. */
public final class PythonExecutionCancellation {
    private static final ConcurrentHashMap<String, Boolean> CANCELLED = new ConcurrentHashMap<>();

    private PythonExecutionCancellation() {}

    public static void cancel(String executionId) {
        if (executionId != null && !executionId.isEmpty()) CANCELLED.put(executionId, Boolean.TRUE);
    }

    public static boolean isCancelled(String executionId) {
        return executionId != null && Boolean.TRUE.equals(CANCELLED.get(executionId));
    }

    public static void clear(String executionId) {
        if (executionId != null) CANCELLED.remove(executionId);
    }
}
