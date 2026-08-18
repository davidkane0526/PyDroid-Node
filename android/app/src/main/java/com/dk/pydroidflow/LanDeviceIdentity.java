package com.dk.pydroidflow;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Locale;
import java.util.UUID;

final class LanDeviceIdentity {
    private static final String PREFS = "pydroid_lan_identity";
    private static final String UUID_KEY = "device_uuid";

    final String uuid;
    final String friendlyName;
    final String hostname;

    private LanDeviceIdentity(String uuid, String friendlyName, String hostname) {
        this.uuid = uuid;
        this.friendlyName = friendlyName;
        this.hostname = hostname;
    }

    static LanDeviceIdentity load(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String uuid = preferences.getString(UUID_KEY, null);
        if (uuid == null || uuid.isBlank()) {
            uuid = UUID.randomUUID().toString();
            preferences.edit().putString(UUID_KEY, uuid).apply();
        }
        String device = Build.MODEL == null || Build.MODEL.isBlank() ? "Android" : Build.MODEL.trim();
        String friendlyName = "PyDroid Node - " + device;
        String hostname = "pydroid-node-" + slug(device) + "-" + uuid.substring(0, 6).toLowerCase(Locale.ROOT);
        if (hostname.length() > 63) hostname = hostname.substring(0, 63).replaceAll("-+$", "");
        return new LanDeviceIdentity(uuid, friendlyName, hostname);
    }

    private static String slug(String value) {
        String result = value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]+", "-").replaceAll("^-+|-+$", "").replaceAll("-+", "-");
        return result.isBlank() ? "android" : result;
    }
}
