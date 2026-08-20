package com.dk.pydroidflow;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;

/** User profile storage and workflow-library SAF operations. */
final class AndroidProfileService {
    private static final String WORKFLOW_TREE_KEY = "pydroid-flow-workflow-tree";
    private final Context context;
    private final ExecutorService worker;

    AndroidProfileService(Context context, ExecutorService worker) {
        this.context = context;
        this.worker = worker;
    }

    File ensureProfileRoot() {
        File root = new File(context.getFilesDir(), "pydroid-flow");
        new File(root, "settings").mkdirs();
        new File(root, "user-code").mkdirs();
        new File(root, "workflows").mkdirs();
        new File(root, "logs").mkdirs();
        return root;
    }

    private Uri workflowTreeUri() {
        String value = context.getSharedPreferences("pydroid-flow", 0).getString(WORKFLOW_TREE_KEY, null);
        return value == null ? null : Uri.parse(value);
    }

    JSObject info() {
        JSObject response = new JSObject();
        response.put("path", ensureProfileRoot().getAbsolutePath());
        Uri tree = workflowTreeUri();
        response.put("workspaceUri", tree == null ? null : tree.toString());
        return response;
    }

    void saveUserProfileFile(PluginCall call) {
        String relativePath = call.getString("relativePath", "");
        String content = call.getString("content", "");
        if (relativePath.isEmpty() || relativePath.contains("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
            call.reject("Invalid profile file path");
            return;
        }
        worker.execute(() -> {
            try {
                File root = ensureProfileRoot();
                File file = new File(root, relativePath);
                String rootPath = root.getCanonicalPath() + File.separator;
                if (!file.getCanonicalPath().startsWith(rootPath)) throw new IllegalArgumentException("Invalid profile file path");
                File parent = file.getParentFile();
                if (parent != null) parent.mkdirs();
                try (FileOutputStream output = new FileOutputStream(file, false)) { output.write(content.getBytes(StandardCharsets.UTF_8)); }
                JSObject response = new JSObject(); response.put("saved", true); response.put("path", file.getAbsolutePath()); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to save user profile" : exception.getMessage(), exception); }
        });
    }


    Intent createExportTextFileIntent(PluginCall call) {
        String name = call.getString("name", "pydroid-export.json").trim();
        String mimeType = call.getString("mimeType", "text/plain").trim();
        if (name.isEmpty()) name = "pydroid-export.json";
        if (mimeType.isEmpty()) mimeType = "text/plain";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        return intent;
    }

    void handleExportTextFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject response = new JSObject();
            response.put("saved", false);
            response.put("destination", (String) null);
            call.resolve(response);
            return;
        }
        Uri uri = data.getData();
        String content = call.getString("content", "");
        worker.execute(() -> {
            try (java.io.OutputStream output = context.getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IllegalStateException("无法打开目标文件");
                output.write(content.getBytes(StandardCharsets.UTF_8));
                output.flush();
                String destination = uri.toString();
                try (android.database.Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        String displayName = cursor.getString(0);
                        if (displayName != null && !displayName.trim().isEmpty()) destination = displayName;
                    }
                } catch (Exception ignored) { }
                JSObject response = new JSObject();
                response.put("saved", true);
                response.put("destination", destination);
                call.resolve(response);
            } catch (Exception exception) {
                call.reject(exception.getMessage() == null ? "Unable to export file" : exception.getMessage(), exception);
            }
        });
    }

    Intent createChooseWorkflowFolderIntent() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        return intent;
    }

    Intent createOpenWorkflowFolderIntent() {
        Uri tree = workflowTreeUri();
        if (tree == null) return null;
        Intent intent = createChooseWorkflowFolderIntent();
        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, tree);
        return intent;
    }

    void handleOpenWorkflowFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject response = new JSObject();
        response.put("opened", result.getResultCode() == Activity.RESULT_OK);
        call.resolve(response);
    }

    void handleChooseWorkflowFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) { call.reject("未选择流程文件夹"); return; }
        Uri tree = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { context.getContentResolver().takePersistableUriPermission(tree, flags); } catch (SecurityException ignored) { }
        context.getSharedPreferences("pydroid-flow", 0).edit().putString(WORKFLOW_TREE_KEY, tree.toString()).apply();
        call.resolve(info());
    }

    void listWorkflowLibrary(PluginCall call) {
        Uri tree = workflowTreeUri();
        if (tree == null) { JSObject response = new JSObject(); response.put("entries", new JSArray()); call.resolve(response); return; }
        worker.execute(() -> {
            try {
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                JSArray entries = new JSArray();
                try (android.database.Cursor cursor = context.getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                    while (cursor != null && cursor.moveToNext() && entries.length() < 80) {
                        String name = cursor.getString(1); String mime = cursor.getString(2);
                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime) || name == null || !(name.endsWith(".workflow.json") || name.endsWith(".json"))) continue;
                        Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
                        try (InputStream input = context.getContentResolver().openInputStream(document); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
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

    void renameWorkflowFile(PluginCall call) {
        String rawUri = call.getString("uri", "");
        String name = call.getString("name", "").trim();
        if (rawUri.isEmpty() || name.isEmpty() || name.contains("/") || name.contains("\\")) { call.reject("流程名称无效"); return; }
        worker.execute(() -> {
            try {
                Uri renamed = DocumentsContract.renameDocument(context.getContentResolver(), Uri.parse(rawUri), name);
                if (renamed == null) throw new IllegalStateException("文件管理器不支持重命名此流程");
                JSObject response = new JSObject(); response.put("uri", renamed.toString()); response.put("name", name); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to rename workflow file" : exception.getMessage(), exception); }
        });
    }

    void deleteWorkflowFile(PluginCall call) {
        String rawUri = call.getString("uri", "");
        if (rawUri.isEmpty()) { call.reject("流程文件不存在"); return; }
        worker.execute(() -> {
            try {
                boolean deleted = DocumentsContract.deleteDocument(context.getContentResolver(), Uri.parse(rawUri));
                if (!deleted) throw new IllegalStateException("文件管理器未删除该流程");
                JSObject response = new JSObject(); response.put("deleted", true); call.resolve(response);
            } catch (Exception exception) { call.reject(exception.getMessage() == null ? "Unable to delete workflow file" : exception.getMessage(), exception); }
        });
    }
}
