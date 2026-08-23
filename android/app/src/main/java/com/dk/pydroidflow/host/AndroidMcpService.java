package com.dk.pydroidflow;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

/** Android MCP socket lifecycle. Core semantics remain in the renderer. */
final class AndroidMcpService implements AutoCloseable {
    interface RequestListener {
        void onRequest(String requestId, String body, String method, String name, String protocolVersion);
    }

    private final ExecutorService requests;
    private final Map<String, CompletableFuture<String>> pending = new ConcurrentHashMap<>();
    private volatile RequestListener listener;
    private McpServer server;

    AndroidMcpService(ExecutorService requests) {
        this.requests = requests;
    }

    void setListener(RequestListener listener) { this.listener = listener; }

    void start(PluginCall call) {
        requests.execute(() -> {
            try {
                McpServer active;
                synchronized (AndroidMcpService.this) {
                    if (server == null) server = McpServer.start(this::dispatch);
                    active = server;
                }
                List<LanNetworkInterfaceManager.Entry> interfaces = LanNetworkInterfaceManager.list();
                String address = interfaces.isEmpty() ? "127.0.0.1" : interfaces.get(0).address.getHostAddress();
                JSObject response = new JSObject();
                response.put("url", "http://" + address + ":" + active.port() + McpServer.PATH);
                response.put("token", active.token());
                response.put("port", active.port());
                call.resolve(response);
            } catch (Exception exception) {
                String message = exception.getMessage();
                call.reject(message == null ? "Unable to start MCP Server" : message, exception);
            }
        });
    }

    void stop(PluginCall call) {
        stopInternal();
        JSObject response = new JSObject(); response.put("stopped", true); call.resolve(response);
    }

    void complete(PluginCall call) {
        String requestId = call.getString("requestId", "");
        String response = call.getString("response", "");
        CompletableFuture<String> future = pending.remove(requestId);
        if (future == null) { call.reject("Unknown MCP request: " + requestId); return; }
        future.complete(response);
        JSObject result = new JSObject(); result.put("completed", true); call.resolve(result);
    }

    private String dispatch(String body, String method, String name, String protocolVersion) throws Exception {
        RequestListener activeListener = listener;
        if (activeListener == null) throw new IllegalStateException("MCP renderer bridge is not attached");
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<String> future = new CompletableFuture<>();
        pending.put(requestId, future);
        activeListener.onRequest(requestId, body, method, name, protocolVersion);
        try { return future.get(30, TimeUnit.SECONDS); }
        finally { pending.remove(requestId); }
    }

    private synchronized void stopInternal() {
        if (server != null) server.close();
        server = null;
        for (CompletableFuture<String> future : pending.values()) future.completeExceptionally(new IllegalStateException("MCP Server stopped"));
        pending.clear();
    }

    @Override public void close() { stopInternal(); }
}
