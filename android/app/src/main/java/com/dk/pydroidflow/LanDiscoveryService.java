package com.dk.pydroidflow;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class LanDiscoveryService {
    private static final String TAG = "PyDroid-LAN";

    private final Context context;
    private final int webPort;
    private final LanDeviceIdentity identity;
    private List<LanNetworkInterfaceManager.Entry> interfaces = new ArrayList<>();
    private SsdpService ssdp;
    private MdnsService mdns;
    private WifiManager.MulticastLock multicastLock;

    LanDiscoveryService(Context context, int webPort) {
        this.context = context.getApplicationContext();
        this.webPort = webPort;
        this.identity = LanDeviceIdentity.load(this.context);
    }

    synchronized void start() {
        acquireMulticastLock();
        startProtocols(LanNetworkInterfaceManager.list());
    }

    synchronized void stop() {
        stopProtocols();
        if (multicastLock != null) try { multicastLock.release(); } catch (Exception ignored) { }
        multicastLock = null;
        interfaces = new ArrayList<>();
    }

    synchronized String primaryAddress() { return interfaces.isEmpty() ? "127.0.0.1" : interfaces.get(0).address.getHostAddress(); }

    synchronized List<String> urls() {
        List<String> values = new ArrayList<>();
        for (LanNetworkInterfaceManager.Entry entry : interfaces) values.add("http://" + entry.address.getHostAddress() + ":" + webPort + "/");
        values.add(localUrl());
        return values;
    }

    synchronized JSONObject status() {
        JSONObject result = new JSONObject();
        JSONArray values = new JSONArray();
        for (LanNetworkInterfaceManager.Entry entry : interfaces) {
            JSONObject item = new JSONObject();
            try {
                item.put("name", entry.networkInterface.getName());
                item.put("address", entry.address.getHostAddress());
            } catch (Exception ignored) { }
            values.put(item);
        }
        try {
            result.put("interfaces", values);
            result.put("ssdp", interfaces.isEmpty() ? "unavailable" : ssdp != null ? "running" : "failed");
            result.put("mdns", interfaces.isEmpty() ? "unavailable" : mdns != null ? "running" : "failed");
        } catch (Exception ignored) { }
        return result;
    }

    String localUrl() { return "http://" + identity.hostname + ".local:" + webPort + "/"; }

    String deviceXml(String requestedAddress) {
        String ip = requestedAddress == null || requestedAddress.isBlank() || requestedAddress.contains(":") ? primaryAddress() : requestedAddress;
        return UpnpDeviceDescription.build(ip, webPort, identity);
    }

    private void startProtocols(List<LanNetworkInterfaceManager.Entry> next) {
        stopProtocols();
        interfaces = next;
        if (next.isEmpty()) {
            Log.w(TAG, "[LAN] no usable IPv4 LAN interface; HTTP remains active");
            return;
        }
        for (LanNetworkInterfaceManager.Entry entry : next) Log.i(TAG, "[LAN] interface " + entry.key());
        try {
            ssdp = new SsdpService(identity, webPort, next);
            ssdp.start();
        } catch (Exception exception) {
            ssdp = null;
            Log.w(TAG, "[SSDP] startup failed; HTTP remains active", exception);
        }
        try {
            mdns = new MdnsService(identity, webPort, next);
            mdns.start();
        } catch (Exception exception) {
            mdns = null;
            Log.w(TAG, "[mDNS] startup failed; HTTP remains active", exception);
        }
        Log.i(TAG, "[LAN] HTTP http://" + primaryAddress() + ":" + webPort + "/");
        Log.i(TAG, "[LAN] local " + localUrl());
    }

    private void stopProtocols() {
        if (ssdp != null) ssdp.stop();
        if (mdns != null) mdns.stop();
        ssdp = null;
        mdns = null;
    }

    private void acquireMulticastLock() {
        try {
            WifiManager manager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            if (manager == null) return;
            multicastLock = manager.createMulticastLock("pydroid-lan-discovery");
            multicastLock.setReferenceCounted(false);
            multicastLock.acquire();
        } catch (Exception exception) {
            Log.w(TAG, "[LAN] unable to acquire Wi-Fi multicast lock", exception);
        }
    }
}
