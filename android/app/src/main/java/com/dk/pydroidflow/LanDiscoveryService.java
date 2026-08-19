package com.dk.pydroidflow;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

final class LanDiscoveryService {
    private static final String TAG = "PyDroid-LAN";

    private final Context context;
    private final int webPort;
    private final LanDeviceIdentity identity;
    private List<LanNetworkInterfaceManager.Entry> interfaces = new ArrayList<>();
    private String networkKey = "";
    private SsdpService ssdp;
    private MdnsService mdns;
    private ScheduledExecutorService monitor;
    private WifiManager.MulticastLock multicastLock;
    private volatile boolean running;

    LanDiscoveryService(Context context, int webPort) {
        this.context = context.getApplicationContext();
        this.webPort = webPort;
        this.identity = LanDeviceIdentity.load(this.context);
    }

    synchronized void start() {
        if (running) return;
        running = true;
        acquireMulticastLock();
        restartDiscovery(LanNetworkInterfaceManager.list());
        monitor = Executors.newSingleThreadScheduledExecutor(r -> { Thread thread = new Thread(r, "pydroid-lan-network-watch"); thread.setDaemon(true); return thread; });
        monitor.scheduleAtFixedRate(this::checkNetwork, 5, 5, TimeUnit.SECONDS);
    }

    synchronized void stop() {
        running = false;
        if (monitor != null) monitor.shutdownNow();
        monitor = null;
        stopProtocols();
        if (multicastLock != null) try { multicastLock.release(); } catch (Exception ignored) { }
        multicastLock = null;
        interfaces = new ArrayList<>();
        networkKey = "";
    }

    synchronized String primaryAddress() { return interfaces.isEmpty() ? "127.0.0.1" : interfaces.get(0).address.getHostAddress(); }
    String localUrl() { return "http://" + identity.hostname + ".local:" + webPort + "/?remote=1&v=" + BuildConfig.VERSION_NAME; }
    String deviceXml(String requestedAddress) {
        String ip = requestedAddress == null || requestedAddress.isBlank() || requestedAddress.contains(":") ? primaryAddress() : requestedAddress;
        return UpnpDeviceDescription.build(ip, webPort, identity);
    }

    private void checkNetwork() {
        if (!running) return;
        List<LanNetworkInterfaceManager.Entry> next = LanNetworkInterfaceManager.list();
        String nextKey = LanNetworkInterfaceManager.key(next);
        synchronized (this) {
            if (running && !nextKey.equals(networkKey)) {
                Log.i(TAG, "[LAN] network changed: " + networkKey + " -> " + nextKey);
                restartDiscovery(next);
            }
        }
    }

    private void restartDiscovery(List<LanNetworkInterfaceManager.Entry> next) {
        stopProtocols();
        interfaces = next;
        networkKey = LanNetworkInterfaceManager.key(next);
        if (next.isEmpty()) { Log.w(TAG, "[LAN] no usable IPv4 LAN interface; HTTP remains active"); return; }
        for (LanNetworkInterfaceManager.Entry entry : next) Log.i(TAG, "[LAN] interface " + entry.key());
        try { ssdp = new SsdpService(identity, webPort, next); ssdp.start(); }
        catch (Exception exception) { ssdp = null; Log.w(TAG, "[SSDP] startup failed; HTTP/mDNS continue", exception); }
        try { mdns = new MdnsService(identity, webPort, next); mdns.start(); }
        catch (Exception exception) { mdns = null; Log.w(TAG, "[mDNS] startup failed; HTTP/SSDP continue", exception); }
        Log.i(TAG, "[LAN] HTTP http://" + primaryAddress() + ":" + webPort + "/?remote=1&v=" + BuildConfig.VERSION_NAME);
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
        } catch (Exception exception) { Log.w(TAG, "[LAN] unable to acquire Wi-Fi multicast lock", exception); }
    }
}
