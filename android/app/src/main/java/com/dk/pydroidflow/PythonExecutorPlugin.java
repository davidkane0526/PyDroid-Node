package com.dk.pydroidflow;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.os.Debug;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.Locale;
import java.util.Properties;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.concurrent.CountDownLatch;
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

@CapacitorPlugin(name = "PythonExecutor")
public class PythonExecutorPlugin extends Plugin {
    private static boolean isSupportedDataFile(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt") || lower.endsWith(".dat") || lower.endsWith(".json") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
    }
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService remoteRequests = Executors.newCachedThreadPool();
    private RemoteWorkflowServer remoteServer;
    private static final int MAX_PICKED_FILES = 100;
    private static final long MAX_FILE_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES = 128L * 1024L * 1024L;
    private static final String WORKFLOW_TREE_KEY = "pydroid-flow-workflow-tree";

    private CIFSContext smbContext(PluginCall call) throws Exception {
        Properties properties = new Properties();
        properties.setProperty("jcifs.smb.client.minVersion", "SMB202");
        properties.setProperty("jcifs.smb.client.maxVersion", "SMB311");
        properties.setProperty("jcifs.smb.client.responseTimeout", "15000");
        properties.setProperty("jcifs.smb.client.soTimeout", "20000");
        CIFSContext base = new BaseContext(new PropertyConfiguration(properties));
        return base.withCredentials(new NtlmPasswordAuthenticator(call.getString("domain", ""), call.getString("username", ""), call.getString("password", "")));
    }

    // jcifs-ng 异常消息是英文系统文本，按关键词映射为中文，便于定位（如"网络名找不到"= 共享名/服务器名错误）。
    // enumeratingShares 用于区分"枚举共享列表"（部分服务器禁止根枚举，共享本身可用）与"访问具体共享"。
    private String smbErrorText(Exception exception, boolean enumeratingShares) {
        String message = exception == null ? null : exception.getMessage();
        if (message == null) return enumeratingShares ? "无法枚举服务器共享列表" : "无法访问 SMB";
        String lower = message.toLowerCase(Locale.ROOT);
        if (lower.contains("network name cannot be found") || lower.contains("share name cannot be found") || lower.contains("bad network name")) {
            if (enumeratingShares) return "无法枚举共享列表（服务器可能禁止共享枚举），可手动输入共享名重试";
            return "网络名或共享名不存在，请检查服务器地址与共享名";
        }
        if (lower.contains("the specified network name is no longer available")) return "网络连接已断开，请重试";
        if (lower.contains("access is denied") || lower.contains("access denied")) return "拒绝访问，请检查账号权限";
        if (lower.contains("logon failure") || lower.contains("bad password") || lower.contains("password is incorrect")) return "用户名或密码错误";
        if (lower.contains("connection refused") || lower.contains("no route to host") || lower.contains("unreachable") || lower.contains("timed out") || lower.contains("timeout")) return "无法连接服务器，请检查地址与网络";
        if (lower.contains("server not found") || lower.contains("unknown host")) return "找不到服务器，请检查地址";
        return message;
    }

    private String smbUrl(PluginCall call, String relativePath) {
        String server = call.getString("server", "").trim();
        String share = call.getString("share", "").trim();
        if (!server.matches("[A-Za-z0-9._:-]+") || share.isEmpty() || share.contains("/") || share.contains("\\")) throw new IllegalArgumentException("SMB 服务器或共享名称无效");
        String clean = relativePath == null ? "" : relativePath.replace('\\', '/');
        if (clean.startsWith("/") || clean.contains("../") || clean.equals("..")) throw new IllegalArgumentException("SMB 路径无效");
        StringBuilder encoded = new StringBuilder();
        for (String part : clean.split("/")) if (!part.isEmpty()) encoded.append(Uri.encode(part)).append('/');
        return "smb://" + server + "/" + Uri.encode(share) + "/" + encoded;
    }

    @PluginMethod
    public void listSmb(PluginCall call) {
        worker.execute(() -> {
            try (SmbResource directory = smbContext(call).get(smbUrl(call, call.getString("path", "")))) {
                if (!directory.isDirectory()) throw new IllegalArgumentException("SMB 路径不是文件夹");
                JSArray entries = new JSArray();
                try (CloseableIterator<SmbResource> children = directory.children()) {
                    while (children.hasNext()) {
                        try (SmbResource item = children.next()) {
                            String name = item.getName().replaceAll("/$", "");
                            boolean isDirectory = item.isDirectory();
                            if (isDirectory || isSupportedDataFile(name)) {
                                JSObject entry = new JSObject();
                                entry.put("name", name); entry.put("path", call.getString("path", "") + (call.getString("path", "").isEmpty() ? "" : "/") + name);
                                entry.put("directory", isDirectory); entry.put("size", isDirectory ? 0 : item.length()); entry.put("modifiedAt", item.lastModified()); entries.put(entry);
                            }
                        }
                    }
                }
                JSObject response = new JSObject(); response.put("entries", entries); call.resolve(response);
            } catch (Exception exception) { call.reject(smbErrorText(exception, false), exception); }
        });
    }

    @PluginMethod
    public void scanSmbShares(PluginCall call) {
        worker.execute(() -> {
            String server = call.getString("server", "").trim();
            if (!server.matches("[A-Za-z0-9._:-]+")) { call.reject("SMB 服务器地址无效"); return; }
            try (SmbResource root = smbContext(call).get("smb://" + server + "/")) {
                JSArray shares = new JSArray();
                try (CloseableIterator<SmbResource> children = root.children()) {
                    while (children.hasNext()) {
                        try (SmbResource item = children.next()) {
                            if (item.isDirectory()) shares.put(item.getName().replaceAll("/$", ""));
                        }
                    }
                }
                JSObject response = new JSObject(); response.put("shares", shares); call.resolve(response);
            } catch (Exception exception) { call.reject(smbErrorText(exception, true), exception); }
        });
    }

    @PluginMethod
    public void discoverSmbServers(PluginCall call) {
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
                CIFSContext guestContext = smbContext(call);
                // NetBIOS 节点状态查询（UDP 137）：局域网反向 DNS 基本不可用，用它获取真实主机名
                NameServiceClient netbios = new NameServiceClientImpl(SingletonContext.getInstance());
                for (String address : candidates) scanner.execute(() -> {
                    try (Socket socket = new Socket()) {
                        socket.connect(new InetSocketAddress(address, 445), 420);
                        JSObject server = new JSObject(); server.put("address", address);
                        String name = address;
                        try {
                            NetbiosAddress[] nbtNames = netbios.getNbtAllByAddress(address);
                            if (nbtNames.length > 0) {
                                String candidate = nbtNames[0].getHostName();
                                if (candidate != null && !candidate.trim().isEmpty()) name = candidate.trim();
                            }
                        } catch (Exception ignored) { }
                        if (name.equals(address)) { // NetBIOS 失败时的 DNS 兜底
                            try { name = InetAddress.getByName(address).getCanonicalHostName(); } catch (Exception ignored) { }
                        }
                        server.put("name", name);
                        JSArray shares = new JSArray();
                        try (SmbResource root = guestContext.get("smb://" + address + "/"); CloseableIterator<SmbResource> children = root.children()) {
                            while (children.hasNext()) try (SmbResource item = children.next()) {
                                if (item.isDirectory()) shares.put(item.getName().replaceAll("/$", ""));
                            }
                        } catch (Exception ignored) { }
                        server.put("shares", shares);
                        synchronized (found) { found.add(server); }
                    } catch (Exception ignored) { } finally { latch.countDown(); }
                });
                latch.await(15, TimeUnit.SECONDS); scanner.shutdownNow();
                found.sort((left, right) -> left.optString("address").compareTo(right.optString("address")));
                JSArray servers = new JSArray(); for (JSObject server : found) servers.put(server);
                JSObject response = new JSObject(); response.put("servers", servers); call.resolve(response);
            } catch (Exception exception) { call.reject(smbErrorText(exception, false), exception); }
        });
    }

    @PluginMethod
    public void readSmbCsv(PluginCall call) {
        worker.execute(() -> {
            try {
                JSArray requested = call.getArray("paths", new JSArray());
                if (requested.length() == 0 || requested.length() > MAX_PICKED_FILES) throw new IllegalArgumentException("请选择 1 到 " + MAX_PICKED_FILES + " 个数据文件");
                JSArray files = new JSArray(); long totalBytes = 0;
                CIFSContext context = smbContext(call);
                for (int index = 0; index < requested.length(); index++) {
                    String relative = requested.getString(index);
                    if (!isSupportedDataFile(relative)) continue;
                    try (SmbResource resource = context.get(smbUrl(call, relative)); InputStream input = resource.openInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
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
            } catch (Exception exception) { call.reject(smbErrorText(exception, false), exception); }
        });
    }

    private File profileRoot() {
        File root = new File(getContext().getFilesDir(), "pydroid-flow");
        new File(root, "settings").mkdirs();
        new File(root, "user-code").mkdirs();
        new File(root, "workflows").mkdirs();
        new File(root, "logs").mkdirs();
        return root;
    }

    @Override
    public void load() {
        super.load();
        profileRoot();
    }

    @PluginMethod
    public void saveUserProfileFile(PluginCall call) {
        String relativePath = call.getString("relativePath", "");
        String content = call.getString("content", "");
        if (relativePath.isEmpty() || relativePath.contains("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
            call.reject("Invalid profile file path");
            return;
        }
        worker.execute(() -> {
            try {
                File file = new File(profileRoot(), relativePath);
                String rootPath = profileRoot().getCanonicalPath() + File.separator;
                if (!file.getCanonicalPath().startsWith(rootPath)) throw new IllegalArgumentException("Invalid profile file path");
                File parent = file.getParentFile();
                if (parent != null) parent.mkdirs();
                try (FileOutputStream output = new FileOutputStream(file, false)) { output.write(content.getBytes(StandardCharsets.UTF_8)); }
                JSObject response = new JSObject(); response.put("saved", true); response.put("path", file.getAbsolutePath()); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to save user profile" : exception.getMessage(), exception); }
        });
    }

    @PluginMethod
    public void saveAgentSecret(PluginCall call) {
        String value = call.getString("value", "");
        worker.execute(() -> {
            try {
                AgentSecretStore.save(getContext(), value);
                JSObject response = new JSObject();
                response.put("saved", true);
                call.resolve(response);
            } catch (Exception exception) {
                call.reject("Unable to save encrypted AI key", exception);
            }
        });
    }

    @PluginMethod
    public void loadAgentSecret(PluginCall call) {
        worker.execute(() -> {
            try {
                JSObject response = new JSObject();
                response.put("value", AgentSecretStore.load(getContext()));
                call.resolve(response);
            } catch (Exception exception) {
                call.reject("Unable to load encrypted AI key", exception);
            }
        });
    }

    @PluginMethod
    public void saveSmbSecret(PluginCall call) {
        String value = call.getString("value", "");
        worker.execute(() -> {
            try { AgentSecretStore.saveSmbPassword(getContext(), value); JSObject response = new JSObject(); response.put("saved", true); call.resolve(response); }
            catch (Exception exception) { call.reject("Unable to save encrypted SMB password", exception); }
        });
    }

    @PluginMethod
    public void loadSmbSecret(PluginCall call) {
        worker.execute(() -> {
            try { JSObject response = new JSObject(); response.put("value", AgentSecretStore.loadSmbPassword(getContext())); call.resolve(response); }
            catch (Exception exception) { call.reject("Unable to load encrypted SMB password", exception); }
        });
    }

    private Uri workflowTreeUri() {
        String value = getContext().getSharedPreferences("pydroid-flow", 0).getString(WORKFLOW_TREE_KEY, null);
        return value == null ? null : Uri.parse(value);
    }

    private JSObject profileInfo() {
        JSObject response = new JSObject();
        response.put("path", profileRoot().getAbsolutePath());
        Uri tree = workflowTreeUri();
        response.put("workspaceUri", tree == null ? null : tree.toString());
        return response;
    }

    @PluginMethod
    public void getUserProfileInfo(PluginCall call) { call.resolve(profileInfo()); }

    @PluginMethod
    public void chooseWorkflowFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "chooseWorkflowFolderResult");
    }

    @PluginMethod
    public void openWorkflowFolder(PluginCall call) {
        Uri tree = workflowTreeUri();
        if (tree == null) { call.reject("尚未选择用户流程文件夹"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        // DocumentsUI and compatible file managers use this URI as their initial location.
        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, tree);
        startActivityForResult(call, intent, "openWorkflowFolderResult");
    }

    @ActivityCallback
    private void openWorkflowFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject response = new JSObject();
        response.put("opened", result.getResultCode() == Activity.RESULT_OK);
        call.resolve(response);
    }

    @ActivityCallback
    private void chooseWorkflowFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) { call.reject("未选择流程文件夹"); return; }
        Uri tree = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { getContext().getContentResolver().takePersistableUriPermission(tree, flags); } catch (SecurityException ignored) { }
        getContext().getSharedPreferences("pydroid-flow", 0).edit().putString(WORKFLOW_TREE_KEY, tree.toString()).apply();
        call.resolve(profileInfo());
    }

    @PluginMethod
    public void listWorkflowLibrary(PluginCall call) {
        Uri tree = workflowTreeUri();
        if (tree == null) { JSObject response = new JSObject(); response.put("entries", new JSArray()); call.resolve(response); return; }
        worker.execute(() -> {
            try {
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                JSArray entries = new JSArray();
                try (android.database.Cursor cursor = getContext().getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                    while (cursor != null && cursor.moveToNext() && entries.length() < 80) {
                        String name = cursor.getString(1); String mime = cursor.getString(2);
                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime) || name == null || !(name.endsWith(".workflow.json") || name.endsWith(".json"))) continue;
                        Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
                        try (InputStream input = getContext().getContentResolver().openInputStream(document); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                            if (input == null) continue;
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = input.read(buffer)) != -1) { if (output.size() + count > 4 * 1024 * 1024) throw new IllegalArgumentException(name + " exceeds 4 MiB"); output.write(buffer, 0, count); }
                            JSObject entry = new JSObject(); entry.put("name", name); entry.put("content", output.toString(StandardCharsets.UTF_8.name())); entry.put("uri", document.toString()); entries.put(entry);
                        }
                    }
                }
                JSObject response = new JSObject(); response.put("entries", entries); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to scan workflow folder" : exception.getMessage(), exception); }
        });
    }

    @PluginMethod
    public void renameWorkflowFile(PluginCall call) {
        String rawUri = call.getString("uri", "");
        String name = call.getString("name", "").trim();
        if (rawUri.isEmpty() || name.isEmpty() || name.contains("/") || name.contains("\\")) { call.reject("流程名称无效"); return; }
        worker.execute(() -> {
            try {
                Uri renamed = DocumentsContract.renameDocument(getContext().getContentResolver(), Uri.parse(rawUri), name);
                if (renamed == null) throw new IllegalStateException("文件管理器不支持重命名此流程");
                JSObject response = new JSObject(); response.put("uri", renamed.toString()); response.put("name", name); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to rename workflow file" : exception.getMessage(), exception); }
        });
    }

    @PluginMethod
    public void deleteWorkflowFile(PluginCall call) {
        String rawUri = call.getString("uri", "");
        if (rawUri.isEmpty()) { call.reject("流程文件不存在"); return; }
        worker.execute(() -> {
            try {
                boolean deleted = DocumentsContract.deleteDocument(getContext().getContentResolver(), Uri.parse(rawUri));
                if (!deleted) throw new IllegalStateException("文件管理器未删除该流程");
                JSObject response = new JSObject(); response.put("deleted", true); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to delete workflow file" : exception.getMessage(), exception); }
        });
    }
    @PluginMethod
    public void pickCsv(PluginCall call) {
        String mode = call.getString("mode", "files");
        boolean directory = mode.startsWith("directory");
        boolean externalChooser = mode.endsWith("external");
        Intent intent;
        if (directory) {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            if (externalChooser) intent = Intent.createChooser(intent, "选择支持 SMB 的文件夹应用");
        } else {
            // OPEN_DOCUMENT follows the OEM/Android Storage Access Framework and can
            // browse every installed DocumentsProvider, including SMB providers.
            // GET_CONTENT is kept as an explicit fallback for standalone file managers.
            intent = new Intent(externalChooser ? Intent.ACTION_GET_CONTENT : Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/csv", "text/plain", "application/json", "image/png", "image/jpeg", "application/octet-stream"});
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | (externalChooser ? 0 : Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION));
            if (externalChooser) intent = Intent.createChooser(intent, "使用第三方文件管理器选择数据文件");
        }
        startActivityForResult(call, intent, "pickCsvResult");
    }

    @ActivityCallback
    private void pickCsvResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            JSObject response = new JSObject(); response.put("files", new JSArray()); call.resolve(response); return;
        }
        String mode = call.getString("mode", "files");
        boolean directory = mode.startsWith("directory");
        boolean persistable = !mode.endsWith("external");
        worker.execute(() -> {
            try {
                ArrayList<Uri> uris = new ArrayList<>();
                if (directory) {
                    Uri tree = data.getData();
                    if (tree == null) throw new IllegalArgumentException("No folder was selected");
                    if (!DocumentsContract.isTreeUri(tree)) throw new IllegalArgumentException("该文件管理器没有返回可读取的文件夹。请改用支持 Android DocumentsProvider 的 SMB 应用，或使用“第三方 / SMB 文件”逐个选择 CSV");
                    int grantFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    try {
                        if (persistable && (grantFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (SecurityException ignored) { /* Some providers only grant temporary access. */ }
                    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                    try (android.database.Cursor cursor = getContext().getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                        while (cursor != null && cursor.moveToNext()) {
                            String name = cursor.getString(1); String mime = cursor.getString(2);
                            if (!DocumentsContract.Document.MIME_TYPE_DIR.equals(mime) && isSupportedDataFile(name)) {
                                if (uris.size() >= MAX_PICKED_FILES) throw new IllegalArgumentException("文件夹中的受支持数据文件超过 " + MAX_PICKED_FILES + " 个");
                                uris.add(DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0)));
                            }
                        }
                    }
                } else if (data.getClipData() != null) {
                    if (data.getClipData().getItemCount() > MAX_PICKED_FILES) throw new IllegalArgumentException("Please select no more than " + MAX_PICKED_FILES + " CSV files");
                    for (int index = 0; index < data.getClipData().getItemCount(); index++) uris.add(data.getClipData().getItemAt(index).getUri());
                } else if (data.getData() != null) uris.add(data.getData());
                if (uris.size() > MAX_PICKED_FILES) throw new IllegalArgumentException("The selected folder contains more than " + MAX_PICKED_FILES + " CSV files");
                if (!directory && persistable) {
                    int grantFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    if ((grantFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                        for (Uri uri : uris) {
                            try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                            catch (SecurityException ignored) { /* Provider offered only temporary access. */ }
                        }
                    }
                }
                JSArray files = new JSArray();
                long totalBytes = 0;
                for (Uri uri : uris) {
                    String name = uri.getLastPathSegment();
                    try (android.database.Cursor cursor = getContext().getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0); }
                    try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        if (input == null) throw new IllegalArgumentException("Unable to open " + name);
                        byte[] buffer = new byte[8192]; int count; long fileBytes = 0;
                        while ((count = input.read(buffer)) != -1) {
                            fileBytes += count;
                            totalBytes += count;
                            if (fileBytes > MAX_FILE_BYTES) throw new IllegalArgumentException(name + " exceeds the 64 MiB per-file safety limit");
                            if (totalBytes > MAX_TOTAL_BYTES) throw new IllegalArgumentException("Selected CSV files exceed the 128 MiB combined safety limit");
                            output.write(buffer, 0, count);
                        }
                        JSObject file = new JSObject(); file.put("name", name); file.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)); files.put(file);
                    }
                }
                JSObject response = new JSObject(); response.put("files", files); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to read selected CSV files" : exception.getMessage(), exception); }
        });
    }

    @PluginMethod
    public void warmUp(PluginCall call) {
        worker.execute(() -> {
            try {
                Python python = Python.getInstance();
                python.getModule("pydroid_flow.engine");
                JSObject response = new JSObject();
                response.put("ready", true);
                call.resolve(response);
            } catch (Exception exception) {
                String message = exception.getMessage();
                call.reject(message == null ? "Python initialization failed" : message, exception);
            }
        });
    }

    @PluginMethod
    public void getRuntimeStats(PluginCall call) {
        JSObject response = new JSObject();
        // PSS includes the Java, native and mapped memory attributed to this process.
        response.put("memoryBytes", (long) Debug.getPss() * 1024L);
        call.resolve(response);
    }

    @PluginMethod
    public synchronized void startRemoteServer(PluginCall call) {
        try {
            if (remoteServer == null) remoteServer = RemoteWorkflowServer.start(getContext(), worker, remoteRequests, call.getBoolean("requirePin", true));
            org.json.JSONObject info = remoteServer.connectionInfo();
            JSObject response = new JSObject();
            response.put("url", info.getString("url"));
            response.put("requiresPin", info.getBoolean("requiresPin"));
            response.put("pin", info.isNull("pin") ? null : info.getString("pin"));
            response.put("port", info.getInt("port"));
            call.resolve(response);
        } catch (Exception exception) {
            String message = exception.getMessage();
            call.reject(message == null ? "Unable to start the LAN service" : message, exception);
        }
    }

    @PluginMethod
    public synchronized void stopRemoteServer(PluginCall call) {
        if (remoteServer != null) remoteServer.stop();
        remoteServer = null;
        JSObject response = new JSObject();
        response.put("stopped", true);
        call.resolve(response);
    }

    @PluginMethod
    public void runWorkflow(PluginCall call) {
        String workflow = call.getString("workflow");
        String csvText = call.getString("csvText");
        String inputFiles = call.getString("inputFiles", "[]");

        if (workflow == null || csvText == null) {
            call.reject("workflow and csvText are required");
            return;
        }

        worker.execute(() -> {
            try {
                Python python = Python.getInstance();
                PyObject module = python.getModule("pydroid_flow.engine");
                PyObject result = module.callAttr("execute_workflow", workflow, csvText, inputFiles);
                JSObject response = new JSObject();
                response.put("result", result.toString());
                call.resolve(response);
            } catch (Exception exception) {
                String message = exception.getMessage();
                call.reject(message == null ? "Python workflow failed" : message, exception);
            }
        });
    }

    @PluginMethod
    public void getEnvironment(PluginCall call) {
        worker.execute(() -> {
            try {
                Python python = Python.getInstance();
                PyObject module = python.getModule("pydroid_flow.engine");
                PyObject result = module.callAttr("environment_info_json");
                JSObject response = new JSObject();
                response.put("result", result.toString());
                call.resolve(response);
            } catch (Exception exception) {
                String message = exception.getMessage();
                call.reject(message == null ? "Unable to read Python environment" : message, exception);
            }
        });
    }

    @PluginMethod
    public void analyzeNotebook(PluginCall call) {
        String notebook = call.getString("notebook");
        if (notebook == null) {
            call.reject("notebook is required");
            return;
        }
        worker.execute(() -> {
            try {
                PyObject module = Python.getInstance().getModule("pydroid_flow.notebook");
                PyObject result = module.callAttr("analyze_notebook_json", notebook);
                JSObject response = new JSObject();
                response.put("result", result.toString());
                call.resolve(response);
            } catch (Exception exception) {
                String message = exception.getMessage();
                call.reject(message == null ? "Notebook analysis failed" : message, exception);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (remoteServer != null) remoteServer.stop();
        remoteRequests.shutdownNow();
        worker.shutdownNow();
        super.handleOnDestroy();
    }
}
