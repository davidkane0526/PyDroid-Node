package com.dk.pydroidflow;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;

/** Storage Access Framework data-file selection and reading. */
final class AndroidFileService {
    private static final int MAX_PICKED_FILES = 100;
    private static final long MAX_FILE_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES = 128L * 1024L * 1024L;
    private final Context context;
    private final ExecutorService worker;

    AndroidFileService(Context context, ExecutorService worker) { this.context = context; this.worker = worker; }

    private static boolean isSupportedDataFile(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt") || lower.endsWith(".dat") || lower.endsWith(".json") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
    }

    Intent createPickerIntent(String mode) {
        boolean directory = mode.startsWith("directory");
        boolean externalChooser = mode.endsWith("external");
        Intent intent;
        if (directory) {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            if (externalChooser) intent = Intent.createChooser(intent, "选择支持 SMB 的文件夹应用");
        } else {
            intent = new Intent(externalChooser ? Intent.ACTION_GET_CONTENT : Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/csv", "text/plain", "application/json", "image/png", "image/jpeg", "application/octet-stream"});
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | (externalChooser ? 0 : Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION));
            if (externalChooser) intent = Intent.createChooser(intent, "使用第三方文件管理器选择数据文件");
        }
        return intent;
    }

    void handlePickerResult(PluginCall call, ActivityResult result) {
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
                    try { if (persistable && (grantFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) context.getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                    catch (SecurityException ignored) { }
                    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                    try (android.database.Cursor cursor = context.getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
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
                    if ((grantFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) for (Uri uri : uris) try { context.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) { }
                }
                JSArray files = new JSArray(); long totalBytes = 0;
                for (Uri uri : uris) {
                    String name = uri.getLastPathSegment();
                    try (android.database.Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0); }
                    try (InputStream input = context.getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        if (input == null) throw new IllegalArgumentException("Unable to open " + name);
                        byte[] buffer = new byte[8192]; int count; long fileBytes = 0;
                        while ((count = input.read(buffer)) != -1) {
                            fileBytes += count; totalBytes += count;
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
}
