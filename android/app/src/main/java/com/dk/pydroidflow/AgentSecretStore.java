package com.dk.pydroidflow;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Keeps the AI API key encrypted by an Android Keystore key that survives app updates. */
final class AgentSecretStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "pydroid-flow-agent-api-key-v1";
    private static final String PREFERENCES = "pydroid-flow-secrets";
    private static final String VALUE = "agent-api-key";
    private static final String SMB_VALUE = "smb-password";

    private AgentSecretStore() { }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private static void saveNamed(Context context, String name, String value) throws Exception {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (value == null || value.trim().isEmpty()) {
            preferences.edit().remove(name).apply();
            return;
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] packed = new byte[cipher.getIV().length + encrypted.length];
        System.arraycopy(cipher.getIV(), 0, packed, 0, cipher.getIV().length);
        System.arraycopy(encrypted, 0, packed, cipher.getIV().length, encrypted.length);
        preferences.edit().putString(name, Base64.encodeToString(packed, Base64.NO_WRAP)).apply();
    }

    private static String loadNamed(Context context, String name) throws Exception {
        String stored = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(name, "");
        if (stored == null || stored.isEmpty()) return "";
        byte[] packed = Base64.decode(stored, Base64.NO_WRAP);
        if (packed.length < 13) throw new IllegalStateException("Stored AI key is invalid");
        byte[] iv = java.util.Arrays.copyOfRange(packed, 0, 12);
        byte[] encrypted = java.util.Arrays.copyOfRange(packed, 12, packed.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    static void save(Context context, String value) throws Exception { saveNamed(context, VALUE, value); }
    static String load(Context context) throws Exception { return loadNamed(context, VALUE); }
    static void saveSmbPassword(Context context, String value) throws Exception { saveNamed(context, SMB_VALUE, value); }
    static String loadSmbPassword(Context context) throws Exception { return loadNamed(context, SMB_VALUE); }
}
