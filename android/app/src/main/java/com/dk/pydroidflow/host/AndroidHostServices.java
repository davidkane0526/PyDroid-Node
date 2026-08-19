package com.dk.pydroidflow;

import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Owns Android host service lifetimes. Capacitor plugins should bind calls, not own host logic. */
final class AndroidHostServices implements AutoCloseable {
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    final ExecutorService remoteRequests = Executors.newCachedThreadPool();
    final PythonExecutionController executionController = new PythonExecutionController();

    final AndroidSmbService smb;
    final AndroidProfileService profile;
    final AndroidFileService files;
    final AndroidSecretService secrets;
    final AndroidPythonService python;
    final AndroidRemoteService remote;

    AndroidHostServices(Context context) {
        smb = new AndroidSmbService(worker);
        profile = new AndroidProfileService(context, worker);
        files = new AndroidFileService(context, worker);
        secrets = new AndroidSecretService(context, worker);
        python = new AndroidPythonService(worker, remoteRequests, executionController);
        remote = new AndroidRemoteService(context, worker, remoteRequests, executionController);
    }

    @Override
    public void close() {
        remote.close();
        executionController.close();
        remoteRequests.shutdownNow();
        worker.shutdownNow();
    }
}
