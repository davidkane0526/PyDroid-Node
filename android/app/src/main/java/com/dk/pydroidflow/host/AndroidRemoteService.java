package com.dk.pydroidflow;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.ExecutorService;

/** LAN Remote Web server lifecycle for Android. */
final class AndroidRemoteService implements AutoCloseable {
    private final Context context;
    private final ExecutorService worker;
    private final ExecutorService remoteRequests;
    private final PythonExecutionController executionController;
    private RemoteWorkflowServer server;

    AndroidRemoteService(Context context, ExecutorService worker, ExecutorService remoteRequests, PythonExecutionController executionController) {
        this.context = context;
        this.worker = worker;
        this.remoteRequests = remoteRequests;
        this.executionController = executionController;
    }

    void start(PluginCall call) {
        final boolean requirePin = call.getBoolean("requirePin", true);
        remoteRequests.execute(() -> {
            try {
                RemoteWorkflowServer active;
                synchronized (AndroidRemoteService.this) {
                    if (server == null) server = RemoteWorkflowServer.start(context, worker, remoteRequests, executionController, requirePin);
                    active = server;
                }
                org.json.JSONObject info = active.connectionInfo();
                JSObject response = new JSObject(); response.put("url", info.getString("url")); response.put("urls", info.getJSONArray("urls")); response.put("requiresPin", info.getBoolean("requiresPin")); response.put("pin", info.isNull("pin") ? null : info.getString("pin")); response.put("port", info.getInt("port")); call.resolve(response);
            } catch (Exception exception) { String message = exception.getMessage(); call.reject(message == null ? "Unable to start the LAN service" : message, exception); }
        });
    }

    synchronized void stop(PluginCall call) {
        stopInternal();
        JSObject response = new JSObject(); response.put("stopped", true); call.resolve(response);
    }

    private synchronized void stopInternal() { if (server != null) server.stop(); server = null; }
    @Override public void close() { stopInternal(); }
}
