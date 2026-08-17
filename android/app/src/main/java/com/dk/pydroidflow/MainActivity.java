package com.dk.pydroidflow;

import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String RUNTIME_PREFS = "pydroid_runtime";
    private static final String WEB_CACHE_VERSION = "web_cache_version";

    private void applyPreferredTheme() {
        boolean dark = UiChromePlugin.readPreferredDark(this);
        UiChromePlugin.applySystemBars(this, dark);
        if (getBridge() != null && getBridge().getWebView() != null) {
            int surface = dark ? Color.rgb(11, 16, 32) : Color.rgb(244, 247, 251);
            getBridge().getWebView().setBackgroundColor(surface);
        }
    }

    private void clearWebCacheAfterAppUpdate() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        SharedPreferences preferences = getSharedPreferences(RUNTIME_PREFS, MODE_PRIVATE);
        int cachedVersion = preferences.getInt(WEB_CACHE_VERSION, -1);
        if (cachedVersion == BuildConfig.VERSION_CODE) return;
        getBridge().getWebView().clearCache(true);
        preferences.edit().putInt(WEB_CACHE_VERSION, BuildConfig.VERSION_CODE).apply();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PythonExecutorPlugin.class);
        registerPlugin(UiChromePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        clearWebCacheAfterAppUpdate();
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
