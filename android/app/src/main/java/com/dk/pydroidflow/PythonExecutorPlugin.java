package com.dk.pydroidflow;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PythonExecutor")
public class PythonExecutorPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void runWorkflow(PluginCall call) {
        String workflow = call.getString("workflow");
        String csvText = call.getString("csvText");

        if (workflow == null || csvText == null) {
            call.reject("workflow and csvText are required");
            return;
        }

        worker.execute(() -> {
            try {
                Python python = Python.getInstance();
                PyObject module = python.getModule("pydroid_flow.engine");
                PyObject result = module.callAttr("execute_workflow", workflow, csvText);
                JSObject response = new JSObject();
                response.put("result", result.toString());
                call.resolve(response);
            } catch (Exception exception) {
                String message = exception.getMessage();
                call.reject(message == null ? "Python workflow failed" : message, exception);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdownNow();
        super.handleOnDestroy();
    }
}
