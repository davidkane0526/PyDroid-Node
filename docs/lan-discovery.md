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

## Windows firewall

The portable build does not silently elevate or install global firewall policy. When Windows first asks whether PyDroid Node may communicate through Defender Firewall, allow **Private networks only**. If the host PC has a centrally managed firewall which blocks inbound TCP or UDP 1900/5353, discovery or Web access can still be blocked by policy.

## Manual Windows acceptance test

1. Put the PyDroid host and another Windows PC on the same private Wi-Fi/Ethernet LAN.
2. Start “局域网网页访问”.
3. Confirm `http://HOST_IP:PORT/` loads from the other PC.
4. Open `http://HOST_IP:PORT/upnp/device.xml` and verify `friendlyName`, `UDN` and `presentationURL`.
5. Open File Explorer → Network and locate `PyDroid Node - ...`.
6. Double-click it and verify the default browser opens the same remote UI.
7. Resolve/open the published `.local` hostname.
8. Restart the host and verify the UPnP UUID is unchanged.
9. Change Wi-Fi/IP and verify the old discovery disappears and the new address is announced.
10. Stop Web access and verify discovery stops.
