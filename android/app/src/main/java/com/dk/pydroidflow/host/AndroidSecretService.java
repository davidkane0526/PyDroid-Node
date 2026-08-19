package com.dk.pydroidflow;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.ExecutorService;

/** Android-keystore-backed secret bindings. */
final class AndroidSecretService {
    private final Context context;
    private final ExecutorService worker;

    AndroidSecretService(Context context, ExecutorService worker) { this.context = context; this.worker = worker; }

    void saveAgent(PluginCall call) {
        String value = call.getString("value", "");
        worker.execute(() -> {
            try { AgentSecretStore.save(context, value); JSObject response = new JSObject(); response.put("saved", true); call.resolve(response); }
            catch (Exception exception) { call.reject("Unable to save encrypted AI key", exception); }
        });
    }

    void loadAgent(PluginCall call) {
        worker.execute(() -> {
            try { JSObject response = new JSObject(); response.put("value", AgentSecretStore.load(context)); call.resolve(response); }
            catch (Exception exception) { call.reject("Unable to load encrypted AI key", exception); }
        });
    }

    void saveSmb(PluginCall call) {
        String value = call.getString("value", "");
        worker.execute(() -> {
            try { AgentSecretStore.saveSmbPassword(context, value); JSObject response = new JSObject(); response.put("saved", true); call.resolve(response); }
            catch (Exception exception) { call.reject("Unable to save encrypted SMB password", exception); }
        });
    }

    void loadSmb(PluginCall call) {
        worker.execute(() -> {
            try { JSObject response = new JSObject(); response.put("value", AgentSecretStore.loadSmbPassword(context)); call.resolve(response); }
            catch (Exception exception) { call.reject("Unable to load encrypted SMB password", exception); }
        });
    }
}
