package com.dk.pydroidflow;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor binding façade for Android host services.
 * Host implementations live in Android*Service classes; keep method names stable for PlatformAdapter.
 */
@CapacitorPlugin(name = "PythonExecutor")
public class PythonExecutorPlugin extends Plugin {
    private AndroidHostServices services;

    @Override
    public void load() {
        super.load();
        services = new AndroidHostServices(getContext());
        services.profile.ensureProfileRoot();
    }

    private AndroidHostServices host() {
        if (services == null) throw new IllegalStateException("Android host services are not initialized");
        return services;
    }

    @PluginMethod public void listSmb(PluginCall call) { host().smb.list(call); }
    @PluginMethod public void scanSmbShares(PluginCall call) { host().smb.scanShares(call); }
    @PluginMethod public void discoverSmbServers(PluginCall call) { host().smb.discoverServers(call); }
    @PluginMethod public void readSmbCsv(PluginCall call) { host().smb.readFiles(call); }

    @PluginMethod public void saveUserProfileFile(PluginCall call) { host().profile.saveUserProfileFile(call); }
    @PluginMethod public void getUserProfileInfo(PluginCall call) { call.resolve(host().profile.info()); }
    @PluginMethod public void listWorkflowLibrary(PluginCall call) { host().profile.listWorkflowLibrary(call); }
    @PluginMethod public void renameWorkflowFile(PluginCall call) { host().profile.renameWorkflowFile(call); }
    @PluginMethod public void deleteWorkflowFile(PluginCall call) { host().profile.deleteWorkflowFile(call); }

    @PluginMethod
    public void chooseWorkflowFolder(PluginCall call) {
        startActivityForResult(call, host().profile.createChooseWorkflowFolderIntent(), "chooseWorkflowFolderResult");
    }

    @PluginMethod
    public void openWorkflowFolder(PluginCall call) {
        Intent intent = host().profile.createOpenWorkflowFolderIntent();
        if (intent == null) { call.reject("尚未选择用户流程文件夹"); return; }
        startActivityForResult(call, intent, "openWorkflowFolderResult");
    }

    @ActivityCallback private void openWorkflowFolderResult(PluginCall call, ActivityResult result) { host().profile.handleOpenWorkflowFolderResult(call, result); }
    @ActivityCallback private void chooseWorkflowFolderResult(PluginCall call, ActivityResult result) { host().profile.handleChooseWorkflowFolderResult(call, result); }

    @PluginMethod
    public void pickCsv(PluginCall call) {
        startActivityForResult(call, host().files.createPickerIntent(call.getString("mode", "files")), "pickCsvResult");
    }

    @ActivityCallback private void pickCsvResult(PluginCall call, ActivityResult result) { host().files.handlePickerResult(call, result); }

    @PluginMethod public void saveAgentSecret(PluginCall call) { host().secrets.saveAgent(call); }
    @PluginMethod public void loadAgentSecret(PluginCall call) { host().secrets.loadAgent(call); }
    @PluginMethod public void saveSmbSecret(PluginCall call) { host().secrets.saveSmb(call); }
    @PluginMethod public void loadSmbSecret(PluginCall call) { host().secrets.loadSmb(call); }

    @PluginMethod public void warmUp(PluginCall call) { host().python.warmUp(call); }
    @PluginMethod public void getRuntimeStats(PluginCall call) { host().python.runtimeStats(call); }
    @PluginMethod public void runWorkflow(PluginCall call) { host().python.runWorkflow(call); }
    @PluginMethod public void cancelWorkflow(PluginCall call) { host().python.cancelWorkflow(call); }
    @PluginMethod public void getExecutionStatus(PluginCall call) { host().python.executionStatus(call); }
    @PluginMethod public void getEnvironment(PluginCall call) { host().python.environment(call); }
    @PluginMethod public void analyzeNotebook(PluginCall call) { host().python.analyzeNotebook(call); }
    @PluginMethod public void analyzeSignature(PluginCall call) { host().python.analyzeSignature(call); }

    @PluginMethod public void startRemoteServer(PluginCall call) { host().remote.start(call); }
    @PluginMethod public void stopRemoteServer(PluginCall call) { host().remote.stop(call); }

    @Override
    protected void handleOnDestroy() {
        if (services != null) services.close();
        services = null;
        super.handleOnDestroy();
    }
}
