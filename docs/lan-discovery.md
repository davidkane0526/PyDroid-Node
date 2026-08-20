# LAN automatic discovery

PyDroid Node 1.4.27 attaches discovery to the existing “局域网网页访问” service. Starting Web access starts discovery automatically; stopping Web access or destroying the host plugin stops it. No new settings UI and no second business HTTP server are introduced.

## Runtime architecture

```text
Existing Remote Web Server
  /                       packaged Web UI
  /api/*                  existing PIN/token-protected APIs
  /health                 plain health probe
  /upnp/device.xml        public UPnP description
        |
        +-- LanDiscoveryService
              +-- SSDP / UPnP Basic Device
              +-- mDNS / DNS-SD (_http._tcp.local)
              +-- network-interface change watcher
              +-- persistent device identity
```

Windows/Electron code lives under `desktop/lan/`. Android code lives beside `RemoteWorkflowServer.java` under `android/app/src/main/java/com/dk/pydroidflow/`.

## Discovery behavior

SSDP uses IPv4 multicast `239.255.255.250:1900`, sends `ssdp:alive` for `upnp:rootdevice`, the persistent UUID and `urn:schemas-upnp-org:device:Basic:1`, repeats the alive announcement every 300 seconds, responds to the same targets plus `ssdp:all`, and sends `ssdp:byebye` when Web access stops.

mDNS uses `224.0.0.251:5353`, publishes an A record for the stable `.local` hostname plus `_http._tcp.local` PTR/SRV/TXT records. TXT advertises the concise root path `path=/`.

The UPnP `presentationURL` is the same clean `http://HOST:PORT/` address. Remote-runtime mode is detected from the non-loopback HTTP(S) host, so discovery does not need query parameters.

## Identity storage

- Windows/Electron: `<Electron userData>/settings/lan-device.json`.
- Android: `SharedPreferences` named `pydroid_lan_identity`.

The UUID is generated once and reused. Android `.local` hostnames include the persistent UUID short suffix to avoid collisions between multiple phones of the same model.

## Security

Discovery itself exposes only the device identity, IP, port and UPnP metadata. Existing `/api/*` execution and configuration paths remain protected by the current optional PIN plus browser session token. `/upnp/device.xml`, `/health`, static Web assets and `/api/health` remain intentionally reachable before pairing so a browser can discover and start the pairing flow.

## Windows firewall and stable endpoint

Starting with 1.4.72, Desktop uses the same stable Web endpoint as the proven LAN demo: **TCP 8765**. Android already uses 8765. On first LAN enable, Windows checks three named inbound rules and may request one-time UAC elevation to create them:

- TCP 8765 — Remote Web
- UDP 1900 — SSDP
- UDP 5353 — mDNS

The rules are restricted to **Private profile + LocalSubnet**. The application does not create Public-profile rules. If the current active profile is Public or the user declines the elevation and the rules remain missing, Desktop does not present LAN Web as successfully enabled. Centrally managed policy may still override local rules.

`desktop/lan/firewall.cjs` owns this boundary. Disabling LAN stops the sockets but does not repeatedly delete/recreate the narrow rules; no installer/uninstaller cleanup hook exists in the current portable distribution.

## Manual Windows acceptance test

1. Put the PyDroid host and another Windows PC on the same private Wi-Fi/Ethernet LAN.
2. Ensure Windows reports the active LAN as **Private**, then start “局域网网页访问”. Approve the one-time firewall UAC prompt if rules are not yet present.
3. Confirm `http://HOST_IP:8765/` loads from the other PC.
4. Open `http://HOST_IP:8765/upnp/device.xml` and verify `friendlyName`, `UDN` and `presentationURL`.
5. Open File Explorer → Network and locate `PyDroid Node - ...`.
6. Double-click it and verify the default browser opens the same remote UI.
7. Resolve/open the published `.local` hostname.
8. Restart the host and verify the UPnP UUID is unchanged.
9. Change Wi-Fi/IP and verify the old discovery disappears and the new address is announced.
10. Stop Web access and verify discovery stops.

## Automated lifecycle regression gate

Phase 10 / 1.4.70 adds `pnpm test:lan-discovery`. The gate verifies Desktop packet/lifecycle behavior directly and audits Android parity; with JDK available it also compiles and runs the Android LAN protocol classes against minimal Android stubs. Covered contracts include `ssdp:all`, CRLF/ST/USN/LOCATION, UPnP identity fields, persistent UUID, network restart, SSDP byebye, and mDNS A/PTR/SRV/TXT live/goodbye records.


## 1.4.72 readiness semantics

A discovery subsystem is not `running` merely because `socket.bind()` was called. Desktop SSDP and mDNS transition `starting -> running` only after the UDP socket bind callback completes and at least one usable LAN interface successfully joins its multicast group. Remote Web startup also probes `/health` through every advertised LAN IPv4. The primary advertised address prefers the Windows default-route interface. Multiple adapters on the same IPv4 subnet are collapsed to the best/default-route entry, which avoids publishing the same UPnP identity simultaneously at addresses such as a primary `WLAN` and a secondary `WLAN 2`; adapters on different LAN subnets remain publishable in parallel.

The built-in `remote-host-e2e` report exposes these checks under `readiness`. This is still not a substitute for the final physical second-device acceptance test, but a missing firewall rule, Public profile, failed LAN-IP HTTP probe, failed UDP bind or failed multicast membership can no longer produce a passing Desktop host case.
