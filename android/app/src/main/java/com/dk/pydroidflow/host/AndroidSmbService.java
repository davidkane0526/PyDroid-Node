package com.dk.pydroidflow;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import jcifs.CIFSContext;
import jcifs.CloseableIterator;
import jcifs.NameServiceClient;
import jcifs.NetbiosAddress;
import jcifs.SmbResource;
import jcifs.config.PropertyConfiguration;
import jcifs.context.BaseContext;
import jcifs.context.SingletonContext;
import jcifs.netbios.NameServiceClientImpl;
import jcifs.smb.NtlmPasswordAuthenticator;
import jcifs.smb.SmbException;

/** Native SMB discovery and file access for the Android host. */
final class AndroidSmbService {
    private static final int MAX_PICKED_FILES = 100;
    private static final long MAX_FILE_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES = 128L * 1024L * 1024L;
    private final ExecutorService worker;

    AndroidSmbService(ExecutorService worker) { this.worker = worker; }

    private static boolean isSupportedDataFile(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt") || lower.endsWith(".dat") || lower.endsWith(".json") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
    }

    private CIFSContext context(PluginCall call) throws Exception {
        Properties properties = new Properties();
        properties.setProperty("jcifs.smb.client.minVersion", "SMB1");
        properties.setProperty("jcifs.smb.client.maxVersion", "SMB311");
        properties.setProperty("jcifs.smb.client.responseTimeout", "15000");
        properties.setProperty("jcifs.smb.client.soTimeout", "20000");
        CIFSContext base = new BaseContext(new PropertyConfiguration(properties));
        return base.withCredentials(new NtlmPasswordAuthenticator(call.getString("domain", ""), call.getString("username", ""), call.getString("password", "")));
    }

    private String withStatus(String text, Exception exception) {
        if (exception instanceof SmbException) {
            int status = ((SmbException) exception).getNtStatus();
            if (status != 0) return text + "（NT_STATUS 0x" + Integer.toHexString(status).toUpperCase(Locale.ROOT) + "）";
        }
        return text;
    }

    private String errorText(Exception exception, boolean enumeratingShares) {
        String message = exception == null ? null : exception.getMessage();
        if (message == null) return enumeratingShares ? "无法枚举服务器共享列表" : "无法访问 SMB";
        String lower = message.toLowerCase(Locale.ROOT);
        if (lower.contains("network name cannot be found") || lower.contains("share name cannot be found") || lower.contains("bad network name")) {
            if (enumeratingShares) return withStatus("无法枚举共享列表（服务器可能禁止共享枚举），可手动输入共享名重试", exception);
            return withStatus("网络名或共享名不存在，请检查服务器地址与共享名", exception);
        }
        if (lower.contains("the specified network name is no longer available")) return withStatus("网络连接已断开，请重试", exception);
        if (lower.contains("access is denied") || lower.contains("access denied")) return withStatus("拒绝访问，请检查账号权限", exception);
        if (lower.contains("logon failure") || lower.contains("bad password") || lower.contains("password is incorrect")) return withStatus("用户名或密码错误", exception);
        if (lower.contains("connection refused") || lower.contains("no route to host") || lower.contains("unreachable") || lower.contains("timed out") || lower.contains("timeout")) return withStatus("无法连接服务器，请检查地址与网络", exception);
        if (lower.contains("server not found") || lower.contains("unknown host")) return withStatus("找不到服务器，请检查地址", exception);
        return message;
    }

    private String url(PluginCall call, String relativePath) {
        String server = call.getString("server", "").trim();
        String share = call.getString("share", "").trim();
        if (!server.matches("[A-Za-z0-9._:-]+") || share.isEmpty() || share.contains("/") || share.contains("\\")) throw new IllegalArgumentException("SMB 服务器或共享名称无效");
        String clean = relativePath == null ? "" : relativePath.replace('\\', '/');
        if (clean.startsWith("/") || clean.contains("../") || clean.equals("..")) throw new IllegalArgumentException("SMB 路径无效");
        StringBuilder path = new StringBuilder();
        for (String part : clean.split("/")) if (!part.isEmpty()) path.append(part).append('/');
        return "smb://" + server + "/" + share + "/" + path;
    }

    void list(PluginCall call) {
        worker.execute(() -> {
            try (SmbResource directory = context(call).get(url(call, call.getString("path", "")))) {
                if (!directory.isDirectory()) throw new IllegalArgumentException("SMB 路径不是文件夹");
                JSArray entries = new JSArray();
                try (CloseableIterator<SmbResource> children = directory.children()) {
                    while (children.hasNext()) {
                        try (SmbResource item = children.next()) {
                            String name = item.getName().replaceAll("/$", "");
                            boolean isDirectory = item.isDirectory();
                            if (isDirectory || isSupportedDataFile(name)) {
                                JSObject entry = new JSObject();
                                String parent = call.getString("path", "");
                                entry.put("name", name); entry.put("path", parent + (parent.isEmpty() ? "" : "/") + name);
                                entry.put("directory", isDirectory); entry.put("size", isDirectory ? 0 : item.length()); entry.put("modifiedAt", item.lastModified()); entries.put(entry);
                            }
                        }
                    }
                }
                JSObject response = new JSObject(); response.put("entries", entries); call.resolve(response);
            } catch (Exception exception) { call.reject(errorText(exception, false), exception); }
        });
    }

    void scanShares(PluginCall call) {
        worker.execute(() -> {
            String server = call.getString("server", "").trim();
            if (!server.matches("[A-Za-z0-9._:-]+")) { call.reject("SMB 服务器地址无效"); return; }
            try (SmbResource root = context(call).get("smb://" + server + "/")) {
                JSArray shares = new JSArray();
                try (CloseableIterator<SmbResource> children = root.children()) {
                    while (children.hasNext()) try (SmbResource item = children.next()) { if (item.isDirectory()) shares.put(item.getName().replaceAll("/$", "")); }
                }
                JSObject response = new JSObject(); response.put("shares", shares); call.resolve(response);
            } catch (Exception exception) { call.reject(errorText(exception, true), exception); }
        });
    }

    void discoverServers(PluginCall call) {
        worker.execute(() -> {
            try {
                Set<String> candidates = new HashSet<>();
                for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!network.isUp() || network.isLoopback()) continue;
                    for (InetAddress address : Collections.list(network.getInetAddresses())) {
                        if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || !address.isSiteLocalAddress()) continue;
                        byte[] bytes = address.getAddress();
                        for (int suffix = 1; suffix < 255; suffix++) candidates.add(String.format(Locale.ROOT, "%d.%d.%d.%d", bytes[0] & 255, bytes[1] & 255, bytes[2] & 255, suffix));
                    }
                }
                ExecutorService scanner = Executors.newFixedThreadPool(48);
                CountDownLatch latch = new CountDownLatch(candidates.size());
                ArrayList<JSObject> found = new ArrayList<>();
                CIFSContext guestContext = context(call);
                NameServiceClient netbios = new NameServiceClientImpl(SingletonContext.getInstance());
                for (String address : candidates) scanner.execute(() -> {
                    try (Socket socket = new Socket()) {
                        socket.connect(new InetSocketAddress(address, 445), 420);
                        JSObject server = new JSObject(); server.put("address", address);
                        String name = address;
                        try {
                            NetbiosAddress[] nbtNames = netbios.getNbtAllByAddress(address);
                            if (nbtNames.length > 0) { String candidate = nbtNames[0].getHostName(); if (candidate != null && !candidate.trim().isEmpty()) name = candidate.trim(); }
                        } catch (Exception ignored) { }
                        if (name.equals(address)) try { name = InetAddress.getByName(address).getCanonicalHostName(); } catch (Exception ignored) { }
                        server.put("name", name);
                        JSArray shares = new JSArray();
                        try (SmbResource root = guestContext.get("smb://" + address + "/"); CloseableIterator<SmbResource> children = root.children()) {
                            while (children.hasNext()) try (SmbResource item = children.next()) { if (item.isDirectory()) shares.put(item.getName().replaceAll("/$", "")); }
                        } catch (Exception ignored) { }
                        server.put("shares", shares);
                        synchronized (found) { found.add(server); }
                    } catch (Exception ignored) { } finally { latch.countDown(); }
                });
                latch.await(15, TimeUnit.SECONDS); scanner.shutdownNow();
                found.sort((left, right) -> left.optString("address").compareTo(right.optString("address")));
                JSArray servers = new JSArray(); for (JSObject server : found) servers.put(server);
                JSObject response = new JSObject(); response.put("servers", servers); call.resolve(response);
            } catch (Exception exception) { call.reject(errorText(exception, false), exception); }
        });
    }

    void readFiles(PluginCall call) {
        worker.execute(() -> {
            try {
                JSArray requested = call.getArray("paths", new JSArray());
                if (requested.length() == 0 || requested.length() > MAX_PICKED_FILES) throw new IllegalArgumentException("请选择 1 到 " + MAX_PICKED_FILES + " 个数据文件");
                JSArray files = new JSArray(); long totalBytes = 0;
                CIFSContext smb = context(call);
                for (int index = 0; index < requested.length(); index++) {
                    String relative = requested.getString(index);
                    if (!isSupportedDataFile(relative)) continue;
                    try (SmbResource resource = smb.get(url(call, relative)); InputStream input = resource.openInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[8192]; int count; long fileBytes = 0;
                        while ((count = input.read(buffer)) != -1) {
                            fileBytes += count; totalBytes += count;
                            if (fileBytes > MAX_FILE_BYTES) throw new IllegalArgumentException(relative + " 超过 64 MiB");
                            if (totalBytes > MAX_TOTAL_BYTES) throw new IllegalArgumentException("SMB 文件总大小超过 128 MiB");
                            output.write(buffer, 0, count);
                        }
                        JSObject file = new JSObject(); file.put("name", relative); file.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)); files.put(file);
                    }
                }
                JSObject response = new JSObject(); response.put("files", files); call.resolve(response);
            } catch (Exception exception) { call.reject(errorText(exception, false), exception); }
        });
    }
}
