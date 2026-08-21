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

Desktop and Android use the stable LAN Web endpoint **TCP 8765**. The runtime host binds `0.0.0.0:8765`; SSDP uses UDP 1900 and mDNS uses UDP 5353.

1.4.72 attempted to synchronously inspect the active Windows network category and create Private/LocalSubnet firewall rules during every foreground service-start path. Real validation showed this was not a safe readiness gate: PowerShell could return `Unknown`, the service was then stopped even though the host stack could start, and repeated starts/diagnostics could trigger slow or repeated elevation flows.

Starting with 1.4.73, **firewall inspection/elevation is not part of the foreground Remote Web start transaction or in-app diagnostic pass criteria**. `desktop/lan/firewall.cjs` retains the narrow Private+LocalSubnet rule definitions for future installer/explicit provisioning, but the portable runtime does not block HTTP/discovery startup on that helper. A same-process diagnostic cannot prove that Windows Defender Firewall or enterprise policy permits a second physical device, so cross-device access remains a required manual acceptance test.

## Manual Windows acceptance test

1. Put the PyDroid host and another Windows PC on the same private Wi-Fi/Ethernet LAN.
2. Start “局域网网页访问”. If Windows itself presents a network-access prompt, allow only the trusted/private network according to the local system policy.
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


## 1.4.73 readiness semantics

A discovery subsystem is not `running` merely because `socket.bind()` was called. Desktop SSDP and mDNS transition `starting -> running` only after the UDP socket bind callback completes and at least one usable LAN interface successfully joins its multicast group. Remote Web startup also probes `/health` through every advertised LAN IPv4. The primary advertised address prefers the Windows default-route interface. Multiple adapters on the same IPv4 subnet are collapsed to the best/default-route entry, which avoids publishing the same UPnP identity simultaneously at addresses such as a primary `WLAN` and a secondary `WLAN 2`; adapters on different LAN subnets remain publishable in parallel.

The built-in `remote-host-e2e` report exposes host-side checks under `readiness`. It requires fixed port 8765, LAN-address `/health`, and completed SSDP/mDNS bind + multicast membership. It deliberately does **not** certify Windows firewall/profile state, because same-process probes cannot establish reachability from a second physical device. The final cross-device access and File Explorer discovery tests remain mandatory.


## 1.4.74 transient protocol recovery

1.4.74 keeps the 1.4.73 discovery protocol and UI behavior unchanged. The lifecycle owner now retries a transient failed SSDP or mDNS startup on an unchanged network at most once per 15 seconds, and only the failed protocol is restarted. A healthy sibling protocol is left running. `recoveryAttempts` is included in host discovery status so diagnostics can distinguish an initially clean startup from a recovered one.


## 1.4.75 host-state reconciliation

1.4.75 does not change SSDP, UPnP, mDNS, TCP 8765, interface selection or discovery retry behavior. It adds a read-only native host-status contract used by the existing UI while the service is already active. After the 5-second network watcher changes the advertised interface set or a protocol recovers, the current banner/status state can refresh to the new canonical URL/discovery snapshot without calling `start()` again. If the native host has actually stopped, the stale running indicator is cleared. This reconciliation path adds no user-visible text and never starts/stops the host by itself.


## 1.4.79 Windows inbound-boundary correction

Real 1.4.78 Desktop use again showed that same-host `http://<LAN-IP>:8765/` probes can pass while another physical LAN device cannot connect. The failed environment was `192.168.3.185`; the in-app case completed in about 135 ms and therefore certified only local socket/bundle/discovery state, not the Windows inbound path.

1.4.79 keeps the accepted network protocol surface unchanged: fixed TCP 8765, SSDP 1900, mDNS 5353, UPnP identity, PIN/token behavior and all existing UI copy remain unchanged. The correction is limited to the Windows inbound boundary and its evidence model:

- When the user explicitly starts LAN service, Desktop ensures versioned inbound rules for TCP 8765, UDP 1900 and UDP 5353. Rules are restricted to `LocalSubnet`; they use the Windows `Any` profile selector so connectivity does not depend on mutable/unknown Public-vs-Private categorization.
- Rule provisioning is single-flight. Existing v2 rules take the fast path; missing rules can request one system UAC elevation. A rejected/failed elevation is not repeatedly retriggered in the same app process. No application UI explanation text is added.
- Legacy/private-profile PyDroid rules are removed when the elevated v2 rule set is installed, avoiding competing stale rules.
- Host connection info separates `networkBoundaryReady` from `externalClientObserved`. Loopback and the host's own interface addresses never count as external evidence.
- External-client evidence expires after 10 minutes and is invalidated when the host LAN-address set changes, so evidence from another network cannot make the current network pass.
- `remote-host-e2e` no longer treats a same-host LAN-IP HTTP request as proof of LAN reachability. On Desktop, it passes only after the Windows boundary is ready and a real non-local client has reached the service; otherwise it fails for a boundary defect or skips for missing external evidence.

This supersedes the 1.4.72 Private-profile startup experiment. 1.4.79 does **not** reintroduce Private-profile gating, synchronous profile checks, repeated application dialogs or any new UI copy.
