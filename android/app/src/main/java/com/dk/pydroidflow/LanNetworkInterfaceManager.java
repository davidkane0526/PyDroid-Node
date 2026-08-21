package com.dk.pydroidflow;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;

final class LanNetworkInterfaceManager {
    static final class Entry {
        final NetworkInterface networkInterface;
        final Inet4Address address;
        final short prefixLength;
        Entry(NetworkInterface networkInterface, Inet4Address address, short prefixLength) {
            this.networkInterface = networkInterface;
            this.address = address;
            this.prefixLength = prefixLength;
        }
        String key() { return networkInterface.getName() + ":" + address.getHostAddress() + "/" + prefixLength; }
    }

    static List<Entry> list() {
        List<Entry> all = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> enumeration = NetworkInterface.getNetworkInterfaces();
            if (enumeration == null) return all;
            for (NetworkInterface network : Collections.list(enumeration)) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress item : network.getInterfaceAddresses()) {
                    InetAddress address = item.getAddress();
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || address.isLinkLocalAddress()) continue;
                    all.add(new Entry(network, (Inet4Address) address, item.getNetworkPrefixLength()));
                }
            }
        } catch (Exception ignored) { }
        List<Entry> privatePhysical = filter(all, true, true);
        List<Entry> privateAny = filter(all, true, false);
        List<Entry> selected = !privatePhysical.isEmpty() ? privatePhysical : !privateAny.isEmpty() ? privateAny : filter(all, false, true);
        if (selected.isEmpty()) selected = all;
        selected.sort(Comparator.comparingInt(LanNetworkInterfaceManager::score).reversed().thenComparing(item -> item.networkInterface.getName()));
        return selected;
    }

    static Entry selectForRemote(List<Entry> entries, InetAddress remote) {
        if (remote instanceof Inet4Address) {
            byte[] candidate = remote.getAddress();
            for (Entry entry : entries) if (sameSubnet(entry.address.getAddress(), candidate, entry.prefixLength)) return entry;
        }
        return entries.isEmpty() ? null : entries.get(0);
    }

    private static List<Entry> filter(List<Entry> entries, boolean requirePrivate, boolean excludeVirtual) {
        List<Entry> result = new ArrayList<>();
        for (Entry entry : entries) {
            if (requirePrivate && !isPrivate(entry.address)) continue;
            if (excludeVirtual && isVirtual(entry.networkInterface.getName())) continue;
            result.add(entry);
        }
        return result;
    }

    private static int score(Entry entry) {
        String name = entry.networkInterface.getName().toLowerCase(Locale.ROOT);
        int score = isPrivate(entry.address) ? 100 : 0;
        if (!isVirtual(name)) score += 50;
        if (name.startsWith("wlan") || name.startsWith("wifi")) score += 20;
        if (name.startsWith("eth")) score += 18;
        return score;
    }

    private static boolean isVirtual(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.startsWith("tun") || lower.startsWith("tap") || lower.startsWith("rmnet") || lower.startsWith("ccmni") || lower.startsWith("pdp") || lower.contains("vpn") || lower.contains("dummy") || lower.contains("loopback");
    }

    private static boolean isPrivate(Inet4Address address) {
        byte[] bytes = address.getAddress();
        int a = bytes[0] & 0xff;
        int b = bytes[1] & 0xff;
        return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168);
    }

    private static boolean sameSubnet(byte[] a, byte[] b, short prefixLength) {
        int bits = Math.max(0, Math.min(32, prefixLength));
        for (int i = 0; i < 4; i++) {
            int remaining = bits - i * 8;
            int mask = remaining >= 8 ? 0xff : remaining <= 0 ? 0 : (0xff << (8 - remaining)) & 0xff;
            if (((a[i] & 0xff) & mask) != ((b[i] & 0xff) & mask)) return false;
        }
        return true;
    }
}
