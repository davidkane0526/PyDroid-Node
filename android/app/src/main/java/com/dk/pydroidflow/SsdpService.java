package com.dk.pydroidflow;

import android.util.Log;

import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

final class SsdpService {
    private static final String TAG = "PyDroid-LAN";
    private static final String ADDRESS = "239.255.255.250";
    private static final int PORT = 1900;
    private static final String ROOT = "upnp:rootdevice";
    private static final String BASIC = "urn:schemas-upnp-org:device:Basic:1";

    private final LanDeviceIdentity identity;
    private final int webPort;
    private final List<LanNetworkInterfaceManager.Entry> interfaces;
    private volatile boolean running;
    private MulticastSocket socket;
    private Thread receiveThread;
    private ScheduledExecutorService scheduler;

    SsdpService(LanDeviceIdentity identity, int webPort, List<LanNetworkInterfaceManager.Entry> interfaces) {
        this.identity = identity;
        this.webPort = webPort;
        this.interfaces = new ArrayList<>(interfaces);
    }

    void start() throws Exception {
        MulticastSocket created = new MulticastSocket(null);
        created.setReuseAddress(true);
        created.bind(new InetSocketAddress(PORT));
        created.setTimeToLive(2);
        InetAddress group = InetAddress.getByName(ADDRESS);
        int joined = 0;
        for (LanNetworkInterfaceManager.Entry entry : interfaces) {
            try { created.joinGroup(new InetSocketAddress(group, PORT), entry.networkInterface); joined++; }
            catch (Exception exception) { Log.w(TAG, "[SSDP] join failed " + entry.key(), exception); }
        }
        if (joined == 0) { created.close(); throw new java.io.IOException("SSDP did not join any LAN multicast interface"); }
        socket = created;
        running = true;
        receiveThread = new Thread(this::receiveLoop, "pydroid-ssdp");
        receiveThread.setDaemon(true);
        receiveThread.start();
        announce("ssdp:alive");
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> { Thread thread = new Thread(r, "pydroid-ssdp-timer"); thread.setDaemon(true); return thread; });
        scheduler.scheduleAtFixedRate(() -> announce("ssdp:alive"), 300, 300, TimeUnit.SECONDS);
        Log.i(TAG, "[SSDP] joined " + ADDRESS + ":" + PORT);
    }

    void stop() {
        running = false;
        try { announce("ssdp:byebye"); } catch (Exception ignored) { }
        if (scheduler != null) scheduler.shutdownNow();
        scheduler = null;
        MulticastSocket current = socket;
        socket = null;
        if (current != null) {
            InetSocketAddress group;
            try { group = new InetSocketAddress(InetAddress.getByName(ADDRESS), PORT); } catch (Exception exception) { group = null; }
            if (group != null) for (LanNetworkInterfaceManager.Entry entry : interfaces) try { current.leaveGroup(group, entry.networkInterface); } catch (Exception ignored) { }
            current.close();
        }
    }

    private List<Target> targets() {
        String uuid = "uuid:" + identity.uuid;
        List<Target> result = new ArrayList<>();
        result.add(new Target(ROOT, uuid + "::" + ROOT));
        result.add(new Target(uuid, uuid));
        result.add(new Target(BASIC, uuid + "::" + BASIC));
        return result;
    }

    private String location(LanNetworkInterfaceManager.Entry entry) { return "http://" + entry.address.getHostAddress() + ":" + webPort + "/upnp/device.xml"; }

    private void announce(String nts) {
        MulticastSocket current = socket;
        if (current == null || interfaces.isEmpty()) return;
        try {
            InetAddress target = InetAddress.getByName(ADDRESS);
            for (LanNetworkInterfaceManager.Entry entry : interfaces) {
                current.setNetworkInterface(entry.networkInterface);
                for (Target type : targets()) {
                    boolean alive = "ssdp:alive".equals(nts);
                    StringBuilder body = new StringBuilder();
                    body.append("NOTIFY * HTTP/1.1\r\n").append("HOST: ").append(ADDRESS).append(':').append(PORT).append("\r\n");
                    if (alive) body.append("CACHE-CONTROL: max-age=1800\r\nLOCATION: ").append(location(entry)).append("\r\n");
                    body.append("NT: ").append(type.st).append("\r\nNTS: ").append(nts).append("\r\n")
                        .append("SERVER: Android UPnP/1.0 PyDroid-Node/1.0\r\nUSN: ").append(type.usn).append("\r\n")
                        .append("BOOTID.UPNP.ORG: 1\r\nCONFIGID.UPNP.ORG: 1\r\n\r\n");
                    byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                    current.send(new DatagramPacket(bytes, bytes.length, target, PORT));
                }
            }
            Log.i(TAG, "[SSDP] NOTIFY " + nts);
        } catch (Exception exception) { if (running) Log.w(TAG, "[SSDP] announce failed", exception); }
    }

    private void receiveLoop() {
        byte[] buffer = new byte[8192];
        while (running) {
            MulticastSocket current = socket;
            if (current == null) return;
            try {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                current.receive(packet);
                handleSearch(new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8), packet);
            } catch (Exception exception) { if (running) Log.w(TAG, "[SSDP] receive failed", exception); }
        }
    }

    private void handleSearch(String text, DatagramPacket packet) {
        if (!text.toUpperCase(Locale.ROOT).startsWith("M-SEARCH * HTTP/1.1")) return;
        String st = "";
        for (String line : text.split("\\r?\\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && "st".equalsIgnoreCase(line.substring(0, colon).trim())) st = line.substring(colon + 1).trim();
        }
        String requested = st.toLowerCase(Locale.ROOT);
        List<Target> matched = new ArrayList<>();
        for (Target target : targets()) if ("ssdp:all".equals(requested) || target.st.toLowerCase(Locale.ROOT).equals(requested)) matched.add(target);
        if (matched.isEmpty()) return;
        LanNetworkInterfaceManager.Entry entry = LanNetworkInterfaceManager.selectForRemote(interfaces, packet.getAddress());
        if (entry == null) return;
        Log.i(TAG, "[SSDP] M-SEARCH from " + packet.getAddress().getHostAddress() + " ST=" + st);
        int index = 0;
        for (Target target : matched) {
            int delay = 10 + new java.security.SecureRandom().nextInt(71) + index++ * 8;
            final Target responseTarget = target;
            ScheduledExecutorService executor = scheduler;
            if (executor == null || executor.isShutdown()) return;
            executor.schedule(() -> sendResponse(packet, entry, responseTarget), delay, TimeUnit.MILLISECONDS);
        }
    }

    private void sendResponse(DatagramPacket request, LanNetworkInterfaceManager.Entry entry, Target target) {
        MulticastSocket current = socket;
        if (current == null) return;
        String body = "HTTP/1.1 200 OK\r\n" +
            "CACHE-CONTROL: max-age=1800\r\nEXT:\r\nLOCATION: " + location(entry) + "\r\n" +
            "SERVER: Android UPnP/1.0 PyDroid-Node/1.0\r\nST: " + target.st + "\r\nUSN: " + target.usn + "\r\n" +
            "BOOTID.UPNP.ORG: 1\r\nCONFIGID.UPNP.ORG: 1\r\n\r\n";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        try {
            current.send(new DatagramPacket(bytes, bytes.length, request.getAddress(), request.getPort()));
            Log.i(TAG, "[SSDP] response sent ST=" + target.st);
        } catch (Exception exception) { Log.w(TAG, "[SSDP] response failed", exception); }
    }

    private static final class Target {
        final String st, usn;
        Target(String st, String usn) { this.st = st; this.usn = usn; }
    }
}
