# Phase 10 — Remote Access Security & Host Reliability

Started: 2026-08-20
Foundation: accepted/frozen `1.4.67 (90)` Phase 9
Current milestone: `1.4.71 (94)`

## Goal

Phase 10 hardens the existing LAN/Remote Web host without changing the accepted editor UI, workflow/runtime semantics or Desktop/Mobile gesture contracts. Discovery remains a public LAN convenience layer; authenticated execution and host-sensitive capabilities remain behind the Remote Web pairing session.

The intended boundary is:

```text
LAN discovery / health
        │ public metadata only
        ▼
Remote Web pairing
        │ PIN abuse guard
        ▼
short-lived client-bound session token
        │ API rate limits
        ▼
Authenticated Remote API
        ├─ execution / status / configuration
        └─ Host Agent Proxy (Android when a host secret exists)
                 │
                 └─ raw API key never crosses to Remote Web
```


## 1.4.71 real-host startup and packaging E2E

The real 1.4.69 Windows/Android result exposed a test-scope error: the former **21/21** in-app diagnostics verified Editor/Runtime/Security contracts but did not actually start a packaged Remote Web host. Therefore those results remain meaningful for their individual contracts, but they are not proof of network-service availability.

1.4.71 closes that gap at three layers:

- **Service readiness:** Desktop and Android bind the real server, then verify `/health`, the SPA shell and its main JS resource over loopback before startup resolves. A selected LAN address is not used as a production startup blocker because LAN hairpin routing is not universally reliable.
- **Packaging readiness:** the Windows compatibility fallback now builds/stages both the Electron renderer and the dedicated browser-native `desktop/package-remote` bundle. Packaged Desktop smoke actually starts/stops Remote Web.
- **Device diagnostics:** host connection info returns LAN interfaces plus SSDP/mDNS state. The removable diagnostics add `remote-host-e2e`; a full Desktop/Android host target is now **22/22**, and the new case rejects loopback-only advertisement, missing usable IPv4 interfaces, or non-running SSDP/mDNS.

Repository `test:remote-host-e2e` additionally starts the real Desktop service, fetches health/shell/UPnP, performs PIN pairing and an authenticated API request, and sends a live SSDP M-SEARCH UDP packet which must receive a valid response. When JDK is available, the same gate also compiles the actual Android `RemoteWorkflowServer` against minimal platform stubs, starts it on a real JVM socket, and verifies health/shell/main-JS plus reported discovery status.

### Version boundary

- 1.4.50 introduced the dedicated browser-native Remote Web bundle. The normal packager staged it, but the older Windows compatibility fallback did not; compatibility builds from 1.4.50 through 1.4.70 could therefore omit the bundle while the old Desktop smoke remained green.
- 1.4.51 explicitly removed the real Desktop/Android HTTP/resource readiness checks introduced in 1.4.50. This is the confirmed validation-regression boundary.
- 1.4.68 is the strongest common functional-regression candidate because both hosts' Remote security paths changed there, but repository history alone does not prove it caused the Android failure. Do not label 1.4.68 as the proven Android root cause without packaged-host evidence.

## 1.4.70 LAN discovery lifecycle automation

1.4.70 does not redesign SSDP/mDNS. It freezes the existing LAN discovery behavior behind an executable regression gate. `pnpm test:lan-discovery` now covers the required lifecycle surface:

- persistent Desktop UUID identity and Android SharedPreferences-backed UUID identity;
- UPnP `device.xml` UDN, friendlyName and concise presentationURL;
- SSDP `ssdp:all` expansion to the three supported targets;
- SSDP CRLF framing and ST/USN/LOCATION consistency;
- Desktop network-change restart without unnecessary restart when the interface key is unchanged;
- SSDP stop-time `ssdp:byebye`;
- mDNS A/PTR/SRV/TXT publication, query response and TTL=0 goodbye;
- Android source parity plus a pure-JDK compile/runtime protocol harness when `javac` is available.

Desktop `LanDiscoveryService` exposes the existing network poll body as `checkNetwork()` so the restart boundary can be exercised deterministically by the smoke test; the production timer remains 5 seconds. The accepted UI, Remote security policy, Editor/Workflow contracts and Python/JavaScript runtime semantics were unchanged in 1.4.70. At that point the removable in-app diagnostics still contained **21** cases; 1.4.71 supersedes that host-certification scope with the 22nd real-host case.


## 1.4.69 Desktop production bundle gate repair

The dependency-backed Windows build exposed a Desktop Vite alias drift that TypeScript alone did not catch: `App.tsx` imports `proxyRemoteAgentRequest` from `./platform`, but Desktop Vite replaces that facade with `desktop/renderer/platform.ts`, which lacked the corresponding named export. 1.4.69 adds the Desktop facade wrapper and strengthens `platform-architecture-smoke.mjs` so every named `./platform` import used by `App.tsx` must exist in both the shared and Desktop facades.

This is a build-contract repair only. The 1.4.68 PIN/token/rate-limit/Agent-secret policy, Workflow/Runtime semantics, UI and gesture contracts remain unchanged; automated diagnostics therefore remain **21/21**.

## 1.4.68 security policy

The Desktop and Android hosts use the same policy values:

- PIN failure window: 60 seconds;
- lock after 5 failed PIN attempts from one client address;
- cooldown: 60 seconds;
- successful pairing issues a fresh random 24-byte session token;
- token is bound to the paired client address;
- token lifetime: 12 hours;
- at most 32 active tokens are retained per host process;
- normal authenticated APIs: 240 requests/minute/client;
- expensive APIs (`execute`, notebook/signature analysis, Agent proxy): 30 requests/minute/client;
- throttled requests return HTTP 429 plus `Retry-After`;
- unauthenticated pairing bodies have a separate 64 KiB limit.

Remote browser tokens remain in `sessionStorage`; a 401 invalid/expired response removes the stale token so a subsequent request cannot silently keep reusing it.

## Agent secret boundary

### Android host

Android already stores the Agent secret in the native secret store. In 1.4.68:

- `/api/app-configuration` reports only `agentProxyAvailable`; it never serializes the raw Agent API key;
- Remote Web uses `/api/agent-proxy` when the host has a secret;
- the Android host loads the secret only at request time and injects the provider authorization header itself;
- provider and endpoint are taken from host settings, not from arbitrary Remote Web endpoint input;
- only the supported OpenAI Responses, OpenAI-compatible and Anthropic Messages protocol families are proxied;
- upstream redirects are disabled so credentials are not forwarded to a redirected host;
- the Remote Web Agent dialog disables the API-key field and explicitly reports that the key is host-managed.

### Desktop host

Desktop Agent keys intentionally remain renderer-session-only and are not persisted in the Desktop host service. Therefore `agentProxyAvailable` is currently false on Desktop. Remote Web may still use a key entered for that browser session, but the Desktop host never exports the Desktop renderer's session key.

## Browser-origin boundary

Android Remote Web no longer emits wildcard `Access-Control-Allow-Origin: *` for authenticated APIs. The packaged Remote Web app uses same-origin relative API requests, so normal LAN use is unaffected while an unrelated browser origin cannot use CORS to drive authenticated endpoints.

## Diagnostics and regression gates

1.4.68 adds:

- `desktop/services/remote-security.cjs` — Desktop policy/guard/token implementation;
- `RemoteAccessGuard.java` — pure-Java Android policy/guard/token implementation;
- `src/remote-security-policy.ts` — shared diagnostic description;
- `scripts/remote-security-smoke.mjs` — policy parity, secret-boundary and browser-origin audit;
- `test:remote-security` in the normal repository `check` chain.

The removable in-app diagnostics add two host-independent cases:

1. Remote Web PIN/token/API rate policy;
2. Host Agent transport can operate without a browser-held raw key.

Together with the accepted 19 Phase 8/9 cases, a fully capable Desktop/Android host should report **21/21**. These diagnostics verify policy/transport contracts. The platform smoke tests separately verify that the real Desktop/Android host implementations enforce the same boundary.

## Non-goals for 1.4.68

- no UI redesign;
- no change to Desktop/Mobile × Node/Group gesture meaning;
- no workflow schema change;
- no Python/JavaScript runtime semantic change;
- no redesign of SSDP/mDNS protocols;
- no attempt to persist Desktop Agent secrets merely to make the proxy available.

## Next milestone

After the 1.4.71 real-host E2E repair is validated on packaged Windows and Android hosts, continue Phase 10 host observability/recovery without changing accepted UI or protocol semantics.


## 1.4.72 correction after real 1.4.71 Windows validation

A packaged 1.4.71 host returned 22/22 while external Web/discovery still failed. The case had verified internal HTTP startup and reported discovery state, but the Desktop discovery services marked themselves running before asynchronous bind/join had completed and the application had no Windows firewall ownership. The Desktop host also used an ephemeral Web port instead of the already-proven demo's 8765 contract.

1.4.72 fixes this by using TCP 8765, adding Private/LocalSubnet firewall rules for 8765/1900/5353, checking the active network profile, probing every advertised LAN IPv4, preferring the default-route interface, and withholding SSDP/mDNS `running` until real multicast membership succeeds. The in-app case count remains 22; its acceptance criteria are stronger.
