# LAN discovery and Remote Web

Current baseline: **1.4.92 Baseline Consolidation**. See `docs/BASELINE.md`.

## Accepted behavior

The Windows Remote Web Host in 1.4.91 was successfully opened from an Android tablet over the LAN. This physical-device result is the acceptance anchor for future Remote Web changes.

Desktop startup is intentionally simple:

1. User explicitly starts Remote Web.
2. HTTP binds `0.0.0.0:8765`.
3. The Host returns its URL/PIN information.
4. SSDP/UPnP and mDNS/DNS-SD start as best-effort discovery helpers.

Discovery failure must never change HTTP startup success into failure.

## Address selection

Desktop enumerates Node `os.networkInterfaces()` and deterministically prefers private, non-virtual Wi-Fi/Ethernet interfaces. This is a **preferred advertised interface heuristic**, not a claim that the application queried the Windows default route.

The discovery status field is `preferred`. No PowerShell, `route.exe`, active UDP route probe or other external network process is used.

For a request that arrives on another known local subnet, UPnP response construction may choose the matching local interface so that `LOCATION`/presentation URLs are reachable from that subnet.

## Discovery protocols

### SSDP / UPnP

- Multicast group: `239.255.255.250:1900`.
- The service sends `ssdp:alive`/`ssdp:byebye` notifications when possible.
- M-SEARCH replies advertise `/upnp/device.xml`.
- The device description exposes the HTTP presentation URL on port 8765.

### mDNS / DNS-SD

- Publishes the PyDroid HTTP service under `_http._tcp.local` when the runtime can join the relevant multicast interface.
- `.local` discovery is convenience only; the numeric LAN URL remains available.

## Security boundary

Remote Web uses the current PIN/session-token model. Discovery does not bypass API authentication.

The runtime does not inspect or modify Windows Firewall/profile state and does not request UAC. OS/network policy remains outside the application control path.

Historical Phase 10 security policies (PIN cooldown, token TTL/IP binding and rate limits) are not active baseline requirements. They can only be reconsidered independently from Host lifecycle/startup.

## Validation

Required automated checks for LAN changes:

- `scripts/remote-host-e2e-smoke.mjs`
- `scripts/android-remote-host-jvm-smoke.mjs`
- `scripts/lan-runtime-boundary-smoke.mjs`
- `scripts/lan-network-selection-smoke.mjs`
- `scripts/host-contract-smoke.mjs`

Automated tests prove listener/API/discovery behavior in their environment. They do not substitute for physical second-device LAN acceptance.
