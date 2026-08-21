package com.dk.pydroidflow;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Base64;
import android.util.Log;
import com.chaquo.python.PyObject;
import com.chaquo.python.Python;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;

/**
 * Small, dependency-free LAN server. It serves the packaged React UI and exposes only the
 * execution APIs required by that UI. A short optional PIN creates a browser session token.
 */
final class RemoteWorkflowServer {
    private static final int PORT = 8765;
    private static final int MAX_BODY_BYTES = 96 * 1024 * 1024;
    private static final int MAX_HEADER_BYTES = 16 * 1024;

    private final Context context;
    private final ExecutorService pythonWorker;
    private final ExecutorService requestWorker;
    private final PythonExecutionController executionController;
    private final String token;
    private final String pin;
    private final boolean requiresPin;
    private final LanDiscoveryService discovery;
    private volatile boolean running;
    private final Set<String> remoteExecutionIds = ConcurrentHashMap.newKeySet();
    private ServerSocket socket;
    private Thread acceptThread;

    private RemoteWorkflowServer(Context context, ExecutorService pythonWorker, ExecutorService requestWorker, PythonExecutionController executionController, boolean requiresPin) {
        this.context = context.getApplicationContext();
        this.pythonWorker = pythonWorker;
        this.requestWorker = requestWorker;
        this.executionController = executionController;
        byte[] tokenBytes = new byte[18];
        new SecureRandom().nextBytes(tokenBytes);
        token = Base64.encodeToString(tokenBytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        this.requiresPin = requiresPin;
        pin = String.format(java.util.Locale.US, "%04d", new SecureRandom().nextInt(10_000));
        discovery = new LanDiscoveryService(this.context, PORT);
    }

    static RemoteWorkflowServer start(Context context, ExecutorService pythonWorker, ExecutorService requestWorker, PythonExecutionController executionController, boolean requiresPin) throws IOException {
        RemoteWorkflowServer server = new RemoteWorkflowServer(context, pythonWorker, requestWorker, executionController, requiresPin);
        try (InputStream ignored = server.context.getAssets().open("public/index.html")) { }
        server.socket = new ServerSocket(PORT);
        server.socket.setReuseAddress(true);
        server.running = true;
        server.acceptThread = new Thread(server::acceptLoop, "pydroid-flow-lan-server");
        server.acceptThread.setDaemon(true);
        server.acceptThread.start();
        try { server.discovery.start(); } catch (Exception ignored) { /* Discovery must never take down HTTP. */ }
        return server;
    }

    JSONObject connectionInfo() throws Exception {
        JSONObject result = new JSONObject();
        result.put("port", PORT);
        result.put("requiresPin", requiresPin);
        result.put("pin", requiresPin ? pin : JSONObject.NULL);
        result.put("url", "http://" + discovery.primaryAddress() + ":" + PORT + "/");
        result.put("urls", new JSONArray(discovery.urls()));
        result.put("discovery", discovery.status());
        return result;
    }

    void stop() {
        running = false;
        discovery.stop();
        for (String executionId : remoteExecutionIds) executionController.cancel(executionId);
        remoteExecutionIds.clear();
        try { if (socket != null) socket.close(); } catch (IOException ignored) { }
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = socket.accept();
                client.setSoTimeout(30_000);
                requestWorker.execute(() -> handle(client));
            } catch (IOException exception) {
                if (running) exception.printStackTrace();
            }
        }
    }

    private void handle(Socket client) {
        try (Socket ignored = client; InputStream raw = new BufferedInputStream(client.getInputStream()); OutputStream output = client.getOutputStream()) {
            Request request = readRequest(raw);
            if (request == null) return;
            if ("OPTIONS".equals(request.method)) {
                send(output, 204, "text/plain", new byte[0]);
                return;
            }
            if ("GET".equals(request.method) && "/upnp/device.xml".equals(request.path)) {
                String xml = discovery.deviceXml(client.getLocalAddress() == null ? null : client.getLocalAddress().getHostAddress());
                send(output, 200, "text/xml; charset=utf-8", xml.getBytes(StandardCharsets.UTF_8));
                return;
            }
            if ("GET".equals(request.method) && "/health".equals(request.path)) {
                send(output, 200, "text/plain; charset=utf-8", "OK".getBytes(StandardCharsets.UTF_8));
                return;
            }
            if ("GET".equals(request.method) && "/api/health".equals(request.path)) {
                sendJson(output, 200, new JSONObject().put("status", "ready").put("requiresPin", requiresPin));
                return;
            }
            if (request.path.startsWith("/api/")) {
                if ("/api/pair".equals(request.path)) {
                    handlePair(request, output);
                    return;
                }
                if (!token.equals(request.headers.get("x-pydroid-token"))) {
                    sendJson(output, 401, new JSONObject().put("error", "尚未配对"));
                    return;
                }
                handleApi(request, output);
                return;
            }
            if (!"GET".equals(request.method)) {
                send(output, 405, "text/plain", "Method not allowed".getBytes(StandardCharsets.UTF_8));
                return;
            }
            serveAsset(request.path, output);
        } catch (SocketTimeoutException exception) {
            Log.w("PyDroid-Remote", "Remote request timed out", exception);
        } catch (Exception exception) {
            String message = exception.getMessage();
            if (message == null || message.isBlank()) message = exception.getClass().getSimpleName();
            Log.e("PyDroid-Remote", "Remote request failed: " + message, exception);
            try { sendJson(client.getOutputStream(), 500, new JSONObject().put("error", message)); } catch (Exception ignored) { }
        }
    }

    private void handlePair(Request request, OutputStream output) throws Exception {
        if (!"POST".equals(request.method)) {
            send(output, 405, "text/plain", "Method not allowed".getBytes(StandardCharsets.UTF_8));
            return;
        }
        JSONObject payload = new JSONObject(new String(request.body, StandardCharsets.UTF_8));
        if (requiresPin && !pin.equals(payload.optString("pin", ""))) {
            sendJson(output, 403, new JSONObject().put("error", "四位校验码不正确"));
            return;
        }
        sendJson(output, 200, new JSONObject().put("token", token));
    }

    private void handleApi(Request request, OutputStream output) throws Exception {
        if (!"POST".equals(request.method)) {
            send(output, 405, "text/plain", "Method not allowed".getBytes(StandardCharsets.UTF_8));
            return;
        }
        JSONObject payload = new JSONObject(new String(request.body, StandardCharsets.UTF_8));
        if ("/api/execute".equals(request.path)) {
            String workflow = payload.optString("workflow", null);
            String csvText = payload.optString("csvText", "");
            JSONArray inputFiles = payload.optJSONArray("inputFiles");
            String executionId = payload.optString("executionId", "").trim();
            long timeoutMs = payload.optLong("timeoutMs", PythonExecutionController.DEFAULT_TIMEOUT_MS);
            String workspaceId = payload.optString("workspaceId", "default");
            String workspaceLabel = payload.optString("workspaceLabel", "工作流");
            String clientId = payload.optString("clientId", "remote-browser");
            if (workflow == null || executionId.isEmpty()) throw new IllegalArgumentException("workflow and executionId are required");
            remoteExecutionIds.add(executionId);
            try {
                PythonExecutionController.ControlledExecution execution = executionController.submit(executionId, timeoutMs, "remote", workspaceId, workspaceLabel, clientId, () -> {
                    Python python = Python.getInstance();
                    PyObject module = python.getModule("pydroid_flow.engine");
                    return module.callAttr("execute_workflow", workflow, csvText, inputFiles == null ? "[]" : inputFiles.toString(), executionId).toString();
                });
                sendJsonText(output, 200, executionController.await(execution));
            } finally { remoteExecutionIds.remove(executionId); }
        } else if ("/api/cancel".equals(request.path)) {
            sendJson(output, 200, new JSONObject().put("cancelled", executionController.cancel(payload.optString("executionId", ""))));
        } else if ("/api/execution-status".equals(request.path)) {
            java.util.List<PythonExecutionController.ExecutionSnapshot> snapshots = executionController.snapshots();
            PythonExecutionController.ExecutionSnapshot first = snapshots.isEmpty() ? null : snapshots.get(0);
            JSONObject status = new JSONObject();
            status.put("active", first != null);
            status.put("executionId", first == null ? JSONObject.NULL : first.executionId);
            status.put("source", first == null ? JSONObject.NULL : first.source);
            JSONArray executions = new JSONArray();
            for (PythonExecutionController.ExecutionSnapshot snapshot : snapshots) {
                JSONObject item = new JSONObject();
                item.put("executionId", snapshot.executionId);
                item.put("workspaceId", snapshot.workspaceId);
                item.put("workspaceLabel", snapshot.workspaceLabel);
                item.put("clientId", snapshot.clientId);
                item.put("source", snapshot.source);
                item.put("phase", snapshot.phase.name().toLowerCase(java.util.Locale.ROOT));
                item.put("startedAt", snapshot.startedAt == null ? JSONObject.NULL : snapshot.startedAt);
                executions.put(item);
            }
            status.put("executions", executions);
            status.put("runningCount", executionController.runningCount());
            status.put("queuedCount", executionController.queuedCount());
            status.put("capacity", executionController.capacity());
            sendJson(output, 200, status);
        } else if ("/api/runtime-stats".equals(request.path)) {
            sendJson(output, 200, new JSONObject().put("memoryBytes", (long) android.os.Debug.getPss() * 1024L));
        } else if ("/api/environment".equals(request.path)) {
            sendJsonText(output, 200, callPython("pydroid_flow.engine", "environment_info_json"));
        } else if ("/api/analyze-notebook".equals(request.path)) {
            String notebook = payload.optString("notebook", null);
            if (notebook == null) throw new IllegalArgumentException("notebook is required");
            sendJsonText(output, 200, callPython("pydroid_flow.notebook", "analyze_notebook_json", notebook));
        } else if ("/api/analyze-signature".equals(request.path)) {
            String code = payload.optString("code", null);
            if (code == null) throw new IllegalArgumentException("code is required");
            sendJsonText(output, 200, callPython("pydroid_flow.engine", "analyze_signature_json", code));
        } else if ("/api/app-configuration".equals(request.path)) {
            JSONObject configuration = new JSONObject();
            configuration.put("settings", readSettings());
            configuration.put("agentProxyAvailable", !AgentSecretStore.load(context).trim().isEmpty());
            sendJson(output, 200, configuration);
        } else if ("/api/agent-proxy".equals(request.path)) {
            proxyAgentRequest(payload, output);
        } else {
            sendJson(output, 404, new JSONObject().put("error", "Unknown API endpoint"));
        }
    }

    private void proxyAgentRequest(JSONObject payload, OutputStream output) throws Exception {
        String secret = AgentSecretStore.load(context).trim();
        if (secret.isEmpty()) {
            sendJson(output, 409, new JSONObject().put("error", "Android 宿主未配置 Agent API 密钥"));
            return;
        }
        JSONObject settings = readSettings().optJSONObject("agent");
        if (settings == null) {
            sendJson(output, 409, new JSONObject().put("error", "Android 宿主未配置 Agent 模型"));
            return;
        }
        String endpoint = settings.optString("endpoint", "").trim();
        String provider = settings.optString("provider", "").trim();
        String requestedProvider = payload.optString("provider", provider).trim();
        if (endpoint.isEmpty() || provider.isEmpty()) {
            sendJson(output, 409, new JSONObject().put("error", "Android 宿主的 Agent 接口配置不完整"));
            return;
        }
        if (!provider.equals(requestedProvider)) {
            sendJson(output, 409, new JSONObject().put("error", "网页端 Agent 协议与宿主配置不一致，请重新同步宿主配置"));
            return;
        }
        Object bodyValue = payload.opt("body");
        if (!(bodyValue instanceof JSONObject)) {
            sendJson(output, 400, new JSONObject().put("error", "Agent proxy body must be a JSON object"));
            return;
        }
        URL url = new URL(endpoint);
        String scheme = url.getProtocol();
        if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) {
            sendJson(output, 400, new JSONObject().put("error", "Agent endpoint must use HTTP or HTTPS"));
            return;
        }
        if (!("openai-responses".equals(provider) || "openai-compatible".equals(provider) || "anthropic-messages".equals(provider))) {
            sendJson(output, 409, new JSONObject().put("error", "Android 宿主的 Agent 协议不受支持"));
            return;
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(90_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Accept-Encoding", "identity");
        if ("anthropic-messages".equals(provider)) {
            connection.setRequestProperty("x-api-key", secret);
            connection.setRequestProperty("anthropic-version", "2023-06-01");
        } else {
            connection.setRequestProperty("Authorization", "Bearer " + secret);
        }
        byte[] requestBytes = bodyValue.toString().getBytes(StandardCharsets.UTF_8);
        if (requestBytes.length > MAX_BODY_BYTES) {
            sendJson(output, 413, new JSONObject().put("error", "Agent request is too large"));
            return;
        }
        try (OutputStream upstream = connection.getOutputStream()) { upstream.write(requestBytes); }
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        byte[] responseBytes = stream == null ? "{}".getBytes(StandardCharsets.UTF_8) : readAll(stream, MAX_BODY_BYTES);
        String text = new String(responseBytes, StandardCharsets.UTF_8);
        try {
            sendJson(output, status, new JSONObject(text));
        } catch (Exception ignored) {
            sendJson(output, status, new JSONObject().put("error", text.isEmpty() ? "Agent provider returned an empty response" : text));
        } finally {
            connection.disconnect();
        }
    }


    private JSONObject readSettings() {
        File file = new File(new File(new File(context.getFilesDir(), "pydroid-flow"), "settings"), "app-settings.json");
        if (!file.isFile() || file.length() > 256 * 1024) return new JSONObject();
        try (InputStream input = new FileInputStream(file)) {
            return new JSONObject(new String(readAll(input, 256 * 1024), StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private String callPython(String moduleName, String functionName, Object... arguments) throws Exception {
        Future<String> task = pythonWorker.submit(() -> {
            Python python = Python.getInstance();
            PyObject module = python.getModule(moduleName);
            return module.callAttr(functionName, arguments).toString();
        });
        try {
            return task.get(60, java.util.concurrent.TimeUnit.SECONDS);
        } catch (java.util.concurrent.TimeoutException timeout) {
            task.cancel(true);
            throw new Exception("Python utility request timed out", timeout);
        }
    }

    private void serveAsset(String rawPath, OutputStream output) throws IOException {
        String path = rawPath.equals("/") ? "index.html" : rawPath.substring(1);
        if (path.contains("..") || path.contains("\\") || path.isEmpty()) {
            send(output, 400, "text/plain", "Invalid path".getBytes(StandardCharsets.UTF_8));
            return;
        }
        AssetManager assets = context.getAssets();
        try (InputStream input = assets.open("public/" + path)) {
            send(output, 200, contentType(path), readAll(input, MAX_BODY_BYTES));
        } catch (IOException exception) {
            // Client-side routes should still resolve to the Remote Web SPA shell.
            if (!path.contains(".")) {
                try (InputStream input = assets.open("public/index.html")) {
                    send(output, 200, "text/html; charset=utf-8", readAll(input, MAX_BODY_BYTES));
                    return;
                }
            }
            send(output, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
        }
    }

    private Request readRequest(InputStream input) throws IOException {
        ByteArrayOutputStream headerBytes = new ByteArrayOutputStream();
        int previous = -1, current;
        while ((current = input.read()) != -1) {
            headerBytes.write(current);
            if (headerBytes.size() > MAX_HEADER_BYTES) throw new IOException("Request headers are too large");
            if (previous == '\r' && current == '\n' && headerBytes.size() >= 4) {
                byte[] value = headerBytes.toByteArray();
                int length = value.length;
                if (value[length - 4] == '\r' && value[length - 3] == '\n') break;
            }
            previous = current;
        }
        if (headerBytes.size() == 0) return null;
        String[] lines = new String(headerBytes.toByteArray(), StandardCharsets.ISO_8859_1).split("\\r?\\n");
        String[] requestLine = lines[0].split(" ");
        if (requestLine.length < 2) throw new IOException("Malformed request");
        String target = requestLine[1];
        int query = target.indexOf('?');
        String path = query >= 0 ? target.substring(0, query) : target;
        Map<String, String> headers = new HashMap<>();
        for (int index = 1; index < lines.length; index++) {
            int colon = lines[index].indexOf(':');
            if (colon > 0) headers.put(lines[index].substring(0, colon).trim().toLowerCase(), lines[index].substring(colon + 1).trim());
        }
        int contentLength = headers.containsKey("content-length") ? Integer.parseInt(headers.get("content-length")) : 0;
        if (contentLength < 0 || contentLength > MAX_BODY_BYTES) throw new IOException("Request body is too large");
        byte[] body = readExactly(input, contentLength);
        return new Request(requestLine[0], path, headers, body);
    }

    private static byte[] readExactly(InputStream input, int length) throws IOException {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(bytes, offset, length - offset);
            if (count < 0) throw new IOException("Unexpected end of request body");
            offset += count;
        }
        return bytes;
    }

    private static byte[] readAll(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new IOException("Asset is too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static void sendJson(OutputStream output, int status, JSONObject value) throws IOException { send(output, status, "application/json; charset=utf-8", value.toString().getBytes(StandardCharsets.UTF_8)); }
    private static void sendJsonWithHeaders(OutputStream output, int status, JSONObject value, String extraHeaders) throws IOException { send(output, status, "application/json; charset=utf-8", value.toString().getBytes(StandardCharsets.UTF_8), extraHeaders); }
    private static void sendJsonText(OutputStream output, int status, String value) throws IOException { send(output, status, "application/json; charset=utf-8", value.getBytes(StandardCharsets.UTF_8)); }
    private static void send(OutputStream output, int status, String type, byte[] body) throws IOException { send(output, status, type, body, ""); }
    private static void send(OutputStream output, int status, String type, byte[] body, String extraHeaders) throws IOException {
        String text = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : status == 409 ? "Conflict" : status == 413 ? "Payload Too Large" : status == 429 ? "Too Many Requests" : "Internal Server Error";
        String headers = "HTTP/1.1 " + status + " " + text + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length + "\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nCross-Origin-Resource-Policy: same-origin\r\nAccess-Control-Allow-Headers: Content-Type, X-PyDroid-Token\r\n" + (extraHeaders == null ? "" : extraHeaders) + "\r\n";
        output.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        output.write(body);
        output.flush();
    }

    private static String contentType(String path) {
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".ico")) return "image/x-icon";
        return "text/html; charset=utf-8";
    }

    private static final class Request {
        final String method, path;
        final Map<String, String> headers;
        final byte[] body;
        Request(String method, String path, Map<String, String> headers, byte[] body) { this.method = method; this.path = path; this.headers = headers; this.body = body; }
    }
}
