package com.dk.pydroidflow;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "UiChrome")
public class UiChromePlugin extends Plugin {
    private static final String PREFS = "pydroid-ui";
    private static final String KEY_DARK = "dark";

    public static boolean readPreferredDark(Activity activity) {
        SharedPreferences preferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (preferences.contains(KEY_DARK)) return preferences.getBoolean(KEY_DARK, true);
        int mode = activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    public static void applySystemBars(Activity activity, boolean dark) {
        Window window = activity.getWindow();
        int surface = dark ? Color.rgb(11, 16, 32) : Color.rgb(244, 247, 251);
        window.setStatusBarColor(surface);
        window.setNavigationBarColor(surface);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) window.setNavigationBarDividerColor(surface);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        int visibility = window.getDecorView().getSystemUiVisibility();
        if (dark) {
            visibility &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) visibility &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            visibility |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) visibility |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        window.getDecorView().setSystemUiVisibility(visibility);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        }
        window.getDecorView().setBackgroundColor(surface);
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        Boolean requested = call.getBoolean("dark");
        final boolean dark = requested == null || requested;
        Activity activity = getActivity();
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_DARK, dark).apply();
        activity.runOnUiThread(() -> {
            applySystemBars(activity, dark);
            if (getBridge() != null && getBridge().getWebView() != null) {
                int surface = dark ? Color.rgb(11, 16, 32) : Color.rgb(244, 247, 251);
                getBridge().getWebView().setBackgroundColor(surface);
            }
            call.resolve();
        });
    }
}
