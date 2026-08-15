package com.dk.pydroidflow;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;
import android.util.Base64;

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
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;
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
    private final String token;
    private final String pin;
    private final boolean requiresPin;
    private volatile boolean running;
    private ServerSocket socket;
    private Thread acceptThread;

    private RemoteWorkflowServer(Context context, ExecutorService pythonWorker, ExecutorService requestWorker, boolean requiresPin) {
        this.context = context.getApplicationContext();
        this.pythonWorker = pythonWorker;
        this.requestWorker = requestWorker;
        byte[] bytes = new byte[18];
        new SecureRandom().nextBytes(bytes);
        token = Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        this.requiresPin = requiresPin;
        pin = String.format(java.util.Locale.US, "%04d", new SecureRandom().nextInt(10_000));
    }

    static RemoteWorkflowServer start(Context context, ExecutorService pythonWorker, ExecutorService requestWorker, boolean requiresPin) throws IOException {
        RemoteWorkflowServer server = new RemoteWorkflowServer(context, pythonWorker, requestWorker, requiresPin);
        server.socket = new ServerSocket(PORT);
        server.socket.setReuseAddress(true);
        server.running = true;
        server.acceptThread = new Thread(server::acceptLoop, "pydroid-flow-lan-server");
        server.acceptThread.setDaemon(true);
        server.acceptThread.start();
        return server;
    }

    JSONObject connectionInfo() throws Exception {
        JSONObject result = new JSONObject();
        result.put("port", PORT);
        result.put("requiresPin", requiresPin);
        result.put("pin", requiresPin ? pin : JSONObject.NULL);
        result.put("url", "http://" + localAddress() + ":" + PORT + "/?remote=1");
        return result;
    }

    void stop() {
        running = false;
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
                    sendJson(output, 401, new JSONObject().put("error", "Please pair this browser first"));
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
        } catch (SocketTimeoutException ignored) {
            // An incomplete browser request should never keep the app's worker thread forever.
        } catch (Exception exception) {
            try { sendJson(client.getOutputStream(), 500, new JSONObject().put("error", "Remote service error")); } catch (Exception ignored) { }
        }
    }

    private void handlePair(Request request, OutputStream output) throws Exception {
        if (!"POST".equals(request.method)) {
            send(output, 405, "text/plain", "Method not allowed".getBytes(StandardCharsets.UTF_8));
            return;
        }
        JSONObject payload = new JSONObject(new String(request.body, StandardCharsets.UTF_8));
        if (requiresPin && !pin.equals(payload.optString("pin", ""))) {
            sendJson(output, 401, new JSONObject().put("error", "四位校验码不正确"));
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
            if (workflow == null) throw new IllegalArgumentException("workflow is required");
            String result = callPython("pydroid_flow.engine", "execute_workflow", workflow, csvText, inputFiles == null ? "[]" : inputFiles.toString());
            sendJsonText(output, 200, result);
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
            // The session token is required before returning any device configuration.
            // The API key is decrypted only in memory and sent over the user-authorized LAN session.
            JSONObject configuration = new JSONObject();
            configuration.put("settings", readSettings());
            configuration.put("agentApiKey", AgentSecretStore.load(context));
            sendJson(output, 200, configuration);
        } else {
            sendJson(output, 404, new JSONObject().put("error", "Unknown API endpoint"));
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
        return task.get();
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
    private static void sendJsonText(OutputStream output, int status, String value) throws IOException { send(output, status, "application/json; charset=utf-8", value.getBytes(StandardCharsets.UTF_8)); }
    private static void send(OutputStream output, int status, String type, byte[] body) throws IOException {
        String text = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : "Internal Server Error";
        String headers = "HTTP/1.1 " + status + " " + text + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length + "\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type, X-PyDroid-Token\r\n\r\n";
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

    private String localAddress() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface network : Collections.list(interfaces)) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) if (address instanceof Inet4Address && !address.isLoopbackAddress()) return address.getHostAddress();
            }
        } catch (Exception ignored) { }
        WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        return wifi == null ? "手机局域网 IP" : Formatter.formatIpAddress(wifi.getConnectionInfo().getIpAddress());
    }

    private static final class Request {
        final String method, path;
        final Map<String, String> headers;
        final byte[] body;
        Request(String method, String path, Map<String, String> headers, byte[] body) { this.method = method; this.path = path; this.headers = headers; this.body = body; }
    }
}
