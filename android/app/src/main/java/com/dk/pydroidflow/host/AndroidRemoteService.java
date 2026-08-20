package com.dk.pydroidflow;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;

/** LAN Remote Web server lifecycle for Android. */
final class AndroidRemoteService implements AutoCloseable {
    private final Context context;
    private final ExecutorService worker;
    private final ExecutorService remoteRequests;
    private final PythonExecutionController executionController;
    private RemoteWorkflowServer server;
    private CompletableFuture<RemoteWorkflowServer> startFuture;
    private CompletableFuture<Void> stopFuture;
    private long lifecycleGeneration;

    AndroidRemoteService(Context context, ExecutorService worker, ExecutorService remoteRequests, PythonExecutionController executionController) {
        this.context = context;
        this.worker = worker;
        this.remoteRequests = remoteRequests;
        this.executionController = executionController;
    }

    void start(PluginCall call) {
        final boolean requirePin = call.getBoolean("requirePin", true);
        final CompletableFuture<RemoteWorkflowServer> future;
        final CompletableFuture<Void> stopBarrier;
        synchronized (this) {
            stopBarrier = stopFuture;
            if (stopBarrier != null) {
                future = null;
            } else if (server != null) {
                resolveStart(call, server);
                return;
            } else if (startFuture != null) {
                future = startFuture;
            } else {
                final long generation = lifecycleGeneration;
                final CompletableFuture<RemoteWorkflowServer> createdFuture = new CompletableFuture<>();
                startFuture = createdFuture;
                future = createdFuture;
                remoteRequests.execute(() -> startOnce(requirePin, generation, createdFuture));
            }
        }
        if (stopBarrier != null) {
            stopBarrier.whenComplete((ignored, error) -> {
                if (error == null) {
                    start(call);
                    return;
                }
                Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
                Exception exception = cause instanceof Exception ? (Exception) cause : new Exception(cause);
                call.reject(exception.getMessage() == null ? "Unable to restart the LAN service" : exception.getMessage(), exception);
            });
            return;
        }
        future.whenComplete((active, error) -> {
            if (error == null && active != null) {
                resolveStart(call, active);
                return;
            }
            Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
            String message = cause == null ? null : cause.getMessage();
            Exception exception = cause instanceof Exception ? (Exception) cause : cause == null ? new Exception("Unable to start the LAN service") : new Exception(cause);
            call.reject(message == null ? "Unable to start the LAN service" : message, exception);
        });
    }

    private void startOnce(boolean requirePin, long generation, CompletableFuture<RemoteWorkflowServer> future) {
        RemoteWorkflowServer created = null;
        try {
            synchronized (this) {
                if (generation != lifecycleGeneration) throw new java.util.concurrent.CancellationException();
                if (server != null) {
                    clearStartFuture(future);
                    future.complete(server);
                    return;
                }
            }
            created = RemoteWorkflowServer.start(context, worker, remoteRequests, executionController, requirePin);
            final RemoteWorkflowServer active;
            synchronized (this) {
                if (generation != lifecycleGeneration) throw new java.util.concurrent.CancellationException();
                if (server == null) {
                    server = created;
                    created = null;
                }
                active = server;
                clearStartFuture(future);
            }
            future.complete(active);
        } catch (Throwable error) {
            if (created != null) created.stop();
            clearStartFuture(future);
            future.completeExceptionally(error);
        }
    }

    private synchronized void clearStartFuture(CompletableFuture<RemoteWorkflowServer> future) {
        if (startFuture == future) startFuture = null;
    }

    private void resolveStart(PluginCall call, RemoteWorkflowServer active) {
        try {
            org.json.JSONObject info = active.connectionInfo();
            JSObject response = new JSObject();
            response.put("url", info.getString("url"));
            response.put("urls", info.getJSONArray("urls"));
            response.put("requiresPin", info.getBoolean("requiresPin"));
            response.put("pin", info.isNull("pin") ? null : info.getString("pin"));
            response.put("port", info.getInt("port"));
            response.put("discovery", info.getJSONObject("discovery"));
            call.resolve(response);
        } catch (Exception exception) {
            String message = exception.getMessage();
            call.reject(message == null ? "Unable to start the LAN service" : message, exception);
        }
    }

    void status(PluginCall call) {
        try {
            final JSObject response = new JSObject();
            synchronized (this) {
                final String state = stopFuture != null ? "stopping" : startFuture != null ? "starting" : server != null ? "running" : "stopped";
                response.put("state", state);
                response.put("info", "running".equals(state) && server != null ? server.connectionInfo() : org.json.JSONObject.NULL);
            }
            call.resolve(response);
        } catch (Exception exception) {
            String message = exception.getMessage();
            call.reject(message == null ? "Unable to start the LAN service" : message, exception);
        }
    }

    void stop(PluginCall call) {
        final CompletableFuture<Void> completion;
        final CompletableFuture<RemoteWorkflowServer> pending;
        final RemoteWorkflowServer active;
        final boolean initiate;
        synchronized (this) {
            if (stopFuture != null) {
                completion = stopFuture;
                pending = null;
                active = null;
                initiate = false;
            } else {
                lifecycleGeneration += 1;
                active = server;
                server = null;
                pending = startFuture;
                completion = new CompletableFuture<>();
                stopFuture = completion;
                initiate = true;
            }
        }
        if (initiate) {
            if (active != null) active.stop();
            if (pending == null) finishStop(completion);
            else pending.whenComplete((ignored, error) -> finishStop(completion));
        }
        completion.whenComplete((ignored, error) -> {
            if (error == null) {
                resolveStopped(call);
                return;
            }
            Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
            Exception exception = cause instanceof Exception ? (Exception) cause : new Exception(cause);
            call.reject(exception.getMessage() == null ? "Unable to stop the LAN service" : exception.getMessage(), exception);
        });
    }

    private void finishStop(CompletableFuture<Void> completion) {
        synchronized (this) {
            if (stopFuture == completion) stopFuture = null;
        }
        completion.complete(null);
    }

    private void resolveStopped(PluginCall call) {
        JSObject response = new JSObject();
        response.put("stopped", true);
        call.resolve(response);
    }

    private void stopInternal() {
        final RemoteWorkflowServer active;
        synchronized (this) {
            lifecycleGeneration += 1;
            active = server;
            server = null;
        }
        if (active != null) active.stop();
    }

    @Override public void close() { stopInternal(); }
}
