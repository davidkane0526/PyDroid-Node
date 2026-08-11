package com.dk.pydroidflow;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PythonExecutorPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
