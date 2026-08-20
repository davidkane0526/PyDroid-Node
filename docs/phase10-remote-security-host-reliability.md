# Phase 10 — Remote Access Security & Host Reliability

Started: 2026-08-20
Foundation: accepted/frozen `1.4.67 (90)` Phase 9
Current milestone: `1.4.68 (91)`

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

If the real host build and 21/21 diagnostics pass, 1.4.69 should deepen LAN discovery lifecycle automation rather than redesign discovery. Required coverage includes SSDP `ssdp:all`, CRLF/USN/LOCATION/ST, device.xml identity fields, UUID persistence, network restart, stop/byebye, and mDNS A/PTR/SRV/TXT lifecycle behavior.
