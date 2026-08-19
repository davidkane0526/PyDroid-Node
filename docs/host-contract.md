# Cross-platform Host binding contract

Phase 7 introduces `src/platform/host-contract.json` as the transport-binding source of truth between the shared application PlatformAdapter and the two native hosts.

## Boundary

Application/UI code continues to consume `src/platform/types.ts` and the PlatformAdapter implementations. The host contract is **not** a second application API. It records how each stable capability reaches the native host:

```text
Shared UI / execution
        ↓
PlatformAdapter
        ↓
host-contract.json
   /             \
Desktop IPC    Android Capacitor
```

For Desktop, a native operation records the preload bridge name and Electron IPC channel. For Android, it records the Capacitor plugin and Java method. Platform-specific operations may use an explicit `mode` (`renderer-session`, `system-dialog`, `renderer-css`, `not-applicable`, etc.) rather than inventing fake parity.

## Rules

1. Do not access Electron IPC or Capacitor plugins from shared UI code; extend PlatformAdapter first.
2. Do not rename an existing IPC channel or Capacitor method silently. If a transport name must change, plan a migration and update the contract in the same change.
3. New native host operations must be added to `host-contract.json` and covered by `scripts/host-contract-smoke.mjs`.
4. Desktop service/IPC decomposition and Android service decomposition remain implementation details behind this stable transport surface.
5. Do not force Desktop and Android to implement fake identical behavior where the platform genuinely differs; use an explicit contract mode and keep the difference visible.

## Validation

Run:

```text
pnpm test:host-contract
```

The smoke checks Desktop preload methods/channels, Desktop IPC registration, Android TypeScript plugin methods, Android Java bindings and the main PlatformAdapter capability surface.

## Remote Web presentation stability

Remote Web startup must stay lightweight. Desktop resolves its packaged browser bundle and Android resolves the packaged asset root, then the host binds HTTP and reports the service without synchronously fetching its own shell/assets. The SPA shell is served with `no-store` so clean URLs do not need version query parameters.

Presentation/discovery URLs are intentionally concise: `http://host:port/`. Browser-mode detection uses a non-loopback HTTP(S) host instead of `?remote=1`, so the address shown to users and advertised by SSDP/mDNS/UPnP remains memorable.

## Remote Web renderer boundary (1.4.50+)

Remote Web is a browser client and must always receive a browser-native renderer bundle. Android serves the Capacitor `public` web assets. Packaged Desktop stages the normal browser Vite output under `desktop/package-remote`; the Electron-only `desktop/package-renderer` bundle remains private to the local Electron window. When multiple LAN interfaces exist, the host may expose alternate addresses, but the UI shows only one address by default and lets the user expand the rest on demand.
