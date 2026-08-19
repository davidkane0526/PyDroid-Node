package com.dk.pydroidflow;

import android.os.Debug;
import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

/** Chaquopy runtime, execution lifecycle and analysis bridge. */
final class AndroidPythonService {
    private final ExecutorService worker;
    private final ExecutorService remoteRequests;
    private final PythonExecutionController executionController;

    AndroidPythonService(ExecutorService worker, ExecutorService remoteRequests, PythonExecutionController executionController) {
        this.worker = worker;
        this.remoteRequests = remoteRequests;
        this.executionController = executionController;
    }

    void warmUp(PluginCall call) {
        worker.execute(() -> {
            try { Python.getInstance().getModule("pydroid_flow.engine"); JSObject response = new JSObject(); response.put("ready", true); call.resolve(response); }
            catch (Exception exception) { String message = exception.getMessage(); call.reject(message == null ? "Python initialization failed" : message, exception); }
        });
    }

    void runtimeStats(PluginCall call) {
        JSObject response = new JSObject();
        response.put("memoryBytes", (long) Debug.getPss() * 1024L);
        call.resolve(response);
    }

    void runWorkflow(PluginCall call) {
        String workflow = call.getString("workflow");
        String csvText = call.getString("csvText");
        String inputFiles = call.getString("inputFiles", "[]");
        String executionId = call.getString("executionId", "").trim();
        Long timeoutValue = call.getLong("timeoutMs");
        long timeoutMs = timeoutValue == null ? PythonExecutionController.DEFAULT_TIMEOUT_MS : timeoutValue;
        String workspaceId = call.getString("workspaceId", "default");
        String workspaceLabel = call.getString("workspaceLabel", "工作流");
        String clientId = call.getString("clientId", "local-ui");
        if (workflow == null || csvText == null || executionId.isEmpty()) { call.reject("workflow, csvText, and executionId are required"); return; }
        try {
            PythonExecutionController.ControlledExecution execution = executionController.submit(executionId, timeoutMs, "local", workspaceId, workspaceLabel, clientId, () -> {
                PyObject module = Python.getInstance().getModule("pydroid_flow.engine");
                return module.callAttr("execute_workflow", workflow, csvText, inputFiles, executionId).toString();
            });
            remoteRequests.execute(() -> {
                try { JSObject response = new JSObject(); response.put("result", executionController.await(execution)); call.resolve(response); }
                catch (Exception exception) { String message = exception.getMessage(); call.reject(message == null ? "Python workflow failed" : message, exception); }
            });
        } catch (Exception exception) { String message = exception.getMessage(); call.reject(message == null ? "Unable to start Python workflow" : message, exception); }
    }

    void cancelWorkflow(PluginCall call) {
        String executionId = call.getString("executionId", "").trim();
        JSObject response = new JSObject(); response.put("cancelled", !executionId.isEmpty() && executionController.cancel(executionId)); call.resolve(response);
    }

    void executionStatus(PluginCall call) {
        java.util.List<PythonExecutionController.ExecutionSnapshot> snapshots = executionController.snapshots();
        PythonExecutionController.ExecutionSnapshot first = snapshots.isEmpty() ? null : snapshots.get(0);
        JSObject response = new JSObject();
        response.put("active", first != null);
        response.put("executionId", first == null ? JSONObject.NULL : first.executionId);
        response.put("source", first == null ? JSONObject.NULL : first.source);
        JSArray executions = new JSArray();
        for (PythonExecutionController.ExecutionSnapshot snapshot : snapshots) {
            JSObject item = new JSObject();
            item.put("executionId", snapshot.executionId); item.put("workspaceId", snapshot.workspaceId); item.put("workspaceLabel", snapshot.workspaceLabel); item.put("clientId", snapshot.clientId); item.put("source", snapshot.source);
            item.put("phase", snapshot.phase.name().toLowerCase(Locale.ROOT)); item.put("startedAt", snapshot.startedAt == null ? JSONObject.NULL : snapshot.startedAt); executions.put(item);
        }
        response.put("executions", executions); response.put("runningCount", executionController.runningCount()); response.put("queuedCount", executionController.queuedCount()); response.put("capacity", executionController.capacity()); call.resolve(response);
    }

    void environment(PluginCall call) { callPython(worker, call, "pydroid_flow.engine", "environment_info_json", null, "Unable to read Python environment"); }
    void analyzeNotebook(PluginCall call) {
        String notebook = call.getString("notebook");
        if (notebook == null) { call.reject("notebook is required"); return; }
        callPython(worker, call, "pydroid_flow.notebook", "analyze_notebook_json", notebook, "Notebook analysis failed");
    }
    void analyzeSignature(PluginCall call) {
        String code = call.getString("code");
        if (code == null) { call.reject("code is required"); return; }
        callPython(worker, call, "pydroid_flow.engine", "analyze_signature_json", code, "Signature analysis failed");
    }

    private static void callPython(ExecutorService executor, PluginCall call, String moduleName, String functionName, String argument, String fallback) {
        executor.execute(() -> {
            try {
                PyObject module = Python.getInstance().getModule(moduleName);
                PyObject result = argument == null ? module.callAttr(functionName) : module.callAttr(functionName, argument);
                JSObject response = new JSObject(); response.put("result", result.toString()); call.resolve(response);
            } catch (Exception exception) { String message = exception.getMessage(); call.reject(message == null ? fallback : message, exception); }
        });
    }
}
