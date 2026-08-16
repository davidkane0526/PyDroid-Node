package com.dk.pydroidflow;

import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void applyPreferredTheme() {
        boolean dark = UiChromePlugin.readPreferredDark(this);
        UiChromePlugin.applySystemBars(this, dark);
        if (getBridge() != null && getBridge().getWebView() != null) {
            int surface = dark ? Color.rgb(11, 16, 32) : Color.rgb(244, 247, 251);
            getBridge().getWebView().setBackgroundColor(surface);
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PythonExecutorPlugin.class);
        registerPlugin(UiChromePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        applyPreferredTheme();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyPreferredTheme();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) getWindow().getDecorView().post(this::applyPreferredTheme);
    }
}
