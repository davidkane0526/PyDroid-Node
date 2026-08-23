package com.dk.pydroidflow;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Minimal Streamable HTTP host for the renderer-owned MCP Core adapter. */
final class McpServer implements AutoCloseable {
    interface Dispatcher {
        String dispatch(String body, String method, String name, String protocolVersion) throws Exception;
    }

    static final int PORT = 8766;
    static final String PATH = "/mcp";
    static final String PROTOCOL_VERSION = "2025-11-25";
    private static final int MAX_HEADER_BYTES = 64 * 1024;
    private static final int MAX_BODY_BYTES = 16 * 1024 * 1024;
    private static final Pattern METHOD_PATTERN = Pattern.compile("\"method\"\\s*:\\s*\"([^\"]+)\"");

    private final Dispatcher dispatcher;
    private final ExecutorService requests = Executors.newCachedThreadPool();
    private final String token;
    private final ServerSocket serverSocket;
    private final Thread acceptThread;
    private volatile boolean running = true;

    private McpServer(Dispatcher dispatcher) throws IOException {
        this.dispatcher = dispatcher;
        byte[] secret = new byte[24];
        new SecureRandom().nextBytes(secret);
        token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress("0.0.0.0", PORT));
        acceptThread = new Thread(this::acceptLoop, "pydroid-mcp-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    static McpServer start(Dispatcher dispatcher) throws IOException {
        return new McpServer(dispatcher);
    }

    String token() { return token; }
    int port() { return PORT; }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = serverSocket.accept();
                requests.execute(() -> handle(socket));
            } catch (IOException exception) {
                if (running) exception.printStackTrace();
            }
        }
    }

    private void handle(Socket socket) {
        try (Socket connection = socket;
             BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
            connection.setSoTimeout(30_000);
            try {
                Request request = readRequest(input);
                if (!"POST".equals(request.method)) { send(output, 405, rpcError(-32600, "MCP endpoint requires POST")); return; }
                if (!PATH.equals(request.path)) { send(output, 404, rpcError(-32601, "MCP endpoint not found")); return; }
                if (!("Bearer " + token).equals(request.headers.getOrDefault("authorization", ""))) { send(output, 401, rpcError(-32001, "Unauthorized")); return; }
                String protocolVersion = request.headers.getOrDefault("mcp-protocol-version", "");
                if (!protocolVersion.isEmpty() && !PROTOCOL_VERSION.equals(protocolVersion)) {
                    send(output, 400, rpcError(-32019, "Unsupported MCP-Protocol-Version: " + protocolVersion)); return;
                }
                String method = extractMethod(request.body);
                if (method.startsWith("notifications/")) { sendAccepted(output); return; }
                send(output, 200, dispatcher.dispatch(request.body, method, null, protocolVersion));
            } catch (Exception exception) {
                send(output, 500, rpcError(-32603, exception.getMessage() == null ? exception.toString() : exception.getMessage()));
            }
        } catch (Exception ignored) { }
    }

    private static Request readRequest(BufferedInputStream input) throws IOException {
        String requestLine = readLine(input);
        String[] requestParts = requestLine.split(" ", 3);
        if (requestParts.length < 2) throw new IOException("Invalid HTTP request line");
        Map<String, String> headers = new HashMap<>();
        int headerBytes = requestLine.length();
        while (true) {
            String line = readLine(input);
            headerBytes += line.length();
            if (headerBytes > MAX_HEADER_BYTES) throw new IOException("MCP headers exceed 64 KiB");
            if (line.isEmpty()) break;
            int separator = line.indexOf(':');
            if (separator <= 0) throw new IOException("Invalid HTTP header");
            headers.put(line.substring(0, separator).trim().toLowerCase(Locale.ROOT), line.substring(separator + 1).trim());
        }
        int contentLength;
        try { contentLength = Integer.parseInt(headers.getOrDefault("content-length", "0")); }
        catch (NumberFormatException exception) { throw new IOException("Invalid Content-Length"); }
        if (contentLength < 0 || contentLength > MAX_BODY_BYTES) throw new IOException("MCP request exceeds 16 MiB");
        byte[] body = input.readNBytes(contentLength);
        if (body.length != contentLength) throw new IOException("Incomplete MCP request body");
        String path = requestParts[1].split("\\?", 2)[0];
        return new Request(requestParts[0], path, headers, new String(body, StandardCharsets.UTF_8));
    }

    private static String readLine(BufferedInputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int previous = -1;
        while (true) {
            int current = input.read();
            if (current < 0) throw new IOException("Unexpected end of HTTP request");
            if (previous == '\r' && current == '\n') {
                byte[] bytes = buffer.toByteArray();
                int length = Math.max(0, bytes.length - 1);
                return new String(bytes, 0, length, StandardCharsets.ISO_8859_1);
            }
            buffer.write(current);
            previous = current;
            if (buffer.size() > MAX_HEADER_BYTES) throw new IOException("MCP headers exceed 64 KiB");
        }
    }


    private static String extractMethod(String body) {
        Matcher matcher = METHOD_PATTERN.matcher(body);
        return matcher.find() ? matcher.group(1) : "";
    }

    private static void sendAccepted(BufferedOutputStream output) throws IOException {
        String headers = "HTTP/1.1 202 Accepted\r\n"
            + "Content-Length: 0\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        output.flush();
    }

    private static void send(BufferedOutputStream output, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 202 ? "Accepted" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : "Internal Server Error";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: " + bytes.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        output.write(bytes);
        output.flush();
    }

    private static String rpcError(int code, String message) {
        return "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":" + code + ",\"message\":\"" + escapeJson(message) + "\"}}";
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n");
    }

    @Override
    public void close() {
        running = false;
        try { serverSocket.close(); } catch (IOException ignored) { }
        requests.shutdownNow();
    }

    private static final class Request {
        final String method;
        final String path;
        final Map<String, String> headers;
        final String body;
        Request(String method, String path, Map<String, String> headers, String body) {
            this.method = method;
            this.path = path;
            this.headers = headers;
            this.body = body;
        }
    }
}
