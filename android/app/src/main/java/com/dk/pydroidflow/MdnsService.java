package com.dk.pydroidflow;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class MdnsService {
    private static final String TAG = "PyDroid-LAN";
    private static final String ADDRESS = "224.0.0.251";
    private static final int PORT = 5353;
    private static final int A = 1, PTR = 12, TXT = 16, SRV = 33, ANY = 255;

    private final LanDeviceIdentity identity;
    private final int webPort;
    private final List<LanNetworkInterfaceManager.Entry> interfaces;
    private volatile boolean running;
    private MulticastSocket socket;
    private Thread receiveThread;

    MdnsService(LanDeviceIdentity identity, int webPort, List<LanNetworkInterfaceManager.Entry> interfaces) {
        this.identity = identity;
        this.webPort = webPort;
        this.interfaces = new ArrayList<>(interfaces);
    }

    void start() throws Exception {
        MulticastSocket created = new MulticastSocket(null);
        created.setReuseAddress(true);
        created.bind(new InetSocketAddress(PORT));
        InetAddress group = InetAddress.getByName(ADDRESS);
        for (LanNetworkInterfaceManager.Entry entry : interfaces) {
            try { created.joinGroup(new InetSocketAddress(group, PORT), entry.networkInterface); }
            catch (Exception exception) { Log.w(TAG, "[mDNS] join failed " + entry.key(), exception); }
        }
        socket = created;
        running = true;
        receiveThread = new Thread(this::receiveLoop, "pydroid-mdns");
        receiveThread.setDaemon(true);
        receiveThread.start();
        announce(120);
        Log.i(TAG, "[mDNS] " + identity.hostname + ".local / _http._tcp.local published");
    }

    void stop() {
        running = false;
        try { announce(0); } catch (Exception ignored) { }
        MulticastSocket current = socket;
        socket = null;
        if (current != null) {
            InetSocketAddress group;
            try { group = new InetSocketAddress(InetAddress.getByName(ADDRESS), PORT); } catch (Exception exception) { group = null; }
            if (group != null) for (LanNetworkInterfaceManager.Entry entry : interfaces) try { current.leaveGroup(group, entry.networkInterface); } catch (Exception ignored) { }
            current.close();
        }
    }

    private String host() { return identity.hostname + ".local"; }
    private String service() { return "_http._tcp.local"; }
    private String instance() {
        String label = "PyDroid Node - " + identity.hostname.replace('.', '-');
        if (label.length() > 63) label = label.substring(0, 63);
        return label + "." + service();
    }

    private void announce(int ttl) {
        for (LanNetworkInterfaceManager.Entry entry : interfaces) send(responsePacket(records(entry, ttl)), entry);
    }

    private List<byte[]> records(LanNetworkInterfaceManager.Entry entry, int ttl) {
        List<byte[]> records = new ArrayList<>();
        records.add(record(host(), A, ttl, entry.address.getAddress(), true));
        records.add(record(service(), PTR, ttl, encodeName(instance()), false));
        records.add(record(instance(), SRV, ttl, srvData(host(), webPort), true));
        records.add(record(instance(), TXT, ttl, txtData("path=/?remote=1", "product=PyDroid Node"), true));
        records.add(record("_services._dns-sd._udp.local", PTR, ttl, encodeName(service()), false));
        return records;
    }

    private void receiveLoop() {
        byte[] buffer = new byte[8192];
        while (running) {
            MulticastSocket current = socket;
            if (current == null) return;
            try {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                current.receive(packet);
                byte[] message = new byte[packet.getLength()];
                System.arraycopy(packet.getData(), packet.getOffset(), message, 0, packet.getLength());
                if (isRelevant(message)) announce(120);
            } catch (Exception exception) { if (running) Log.w(TAG, "[mDNS] receive failed", exception); }
        }
    }

    private boolean isRelevant(byte[] message) {
        if (message.length < 12) return false;
        int count = unsignedShort(message, 4);
        int cursor = 12;
        String host = host().toLowerCase(Locale.ROOT), service = service().toLowerCase(Locale.ROOT), instance = instance().toLowerCase(Locale.ROOT);
        for (int index = 0; index < count; index++) {
            NameResult name = decodeName(message, cursor);
            cursor = name.end;
            if (cursor + 4 > message.length) return false;
            int type = unsignedShort(message, cursor);
            cursor += 4;
            boolean supported = type == ANY || type == A || type == PTR || type == SRV || type == TXT;
            if (supported && (name.name.equals(host) || name.name.equals(service) || name.name.equals(instance) || name.name.equals("_services._dns-sd._udp.local"))) return true;
        }
        return false;
    }

    private void send(byte[] bytes, LanNetworkInterfaceManager.Entry entry) {
        MulticastSocket current = socket;
        if (current == null) return;
        try {
            current.setNetworkInterface(entry.networkInterface);
            InetAddress address = InetAddress.getByName(ADDRESS);
            current.send(new DatagramPacket(bytes, bytes.length, address, PORT));
        } catch (Exception exception) { if (running) Log.w(TAG, "[mDNS] send failed", exception); }
    }

    private static byte[] responsePacket(List<byte[]> records) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            DataOutputStream output = new DataOutputStream(bytes);
            output.writeShort(0); output.writeShort(0x8400); output.writeShort(0); output.writeShort(records.size()); output.writeShort(0); output.writeShort(0);
            for (byte[] record : records) output.write(record);
            return bytes.toByteArray();
        } catch (Exception exception) { return new byte[0]; }
    }

    private static byte[] record(String name, int type, int ttl, byte[] data, boolean flush) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            DataOutputStream output = new DataOutputStream(bytes);
            output.write(encodeName(name)); output.writeShort(type); output.writeShort(flush ? 0x8001 : 1); output.writeInt(ttl); output.writeShort(data.length); output.write(data);
            return bytes.toByteArray();
        } catch (Exception exception) { return new byte[0]; }
    }

    private static byte[] encodeName(String name) {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            for (String part : name.replaceAll("\\.$", "").split("\\.")) {
                byte[] label = part.getBytes(StandardCharsets.UTF_8);
                if (label.length == 0 || label.length > 63) throw new IllegalArgumentException("Invalid mDNS label");
                output.write(label.length); output.write(label);
            }
            output.write(0); return output.toByteArray();
        } catch (Exception exception) { throw new IllegalArgumentException(exception); }
    }

    private static byte[] srvData(String hostname, int port) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); DataOutputStream output = new DataOutputStream(bytes);
            output.writeShort(0); output.writeShort(0); output.writeShort(port); output.write(encodeName(hostname)); return bytes.toByteArray();
        } catch (Exception exception) { return new byte[0]; }
    }

    private static byte[] txtData(String... values) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (String value : values) {
            byte[] bytes = value.getBytes(StandardCharsets.UTF_8); int length = Math.min(255, bytes.length);
            output.write(length); output.write(bytes, 0, length);
        }
        return output.toByteArray();
    }

    private static NameResult decodeName(byte[] message, int offset) {
        List<String> labels = new ArrayList<>(); int cursor = offset, end = -1, hops = 0;
        while (cursor < message.length && hops++ < 64) {
            int length = message[cursor] & 0xff;
            if (length == 0) { cursor++; if (end < 0) end = cursor; break; }
            if ((length & 0xc0) == 0xc0) {
                if (cursor + 1 >= message.length) break;
                int pointer = ((length & 0x3f) << 8) | (message[cursor + 1] & 0xff);
                if (end < 0) end = cursor + 2; cursor = pointer; continue;
            }
            if (cursor + 1 + length > message.length) break;
            labels.add(new String(message, cursor + 1, length, StandardCharsets.UTF_8)); cursor += 1 + length;
        }
        return new NameResult(String.join(".", labels).toLowerCase(Locale.ROOT), end < 0 ? cursor : end);
    }

    private static int unsignedShort(byte[] data, int offset) { return ((data[offset] & 0xff) << 8) | (data[offset + 1] & 0xff); }
    private static final class NameResult { final String name; final int end; NameResult(String name, int end) { this.name = name; this.end = end; } }
}
