# Desktop Host Modularization

Phase 7 rules for the Electron main process.

## Composition root

`desktop/main.cjs` is intentionally small. It may own application lifecycle composition, service creation, IPC registration and window lifecycle wiring. It must not regain concrete Python, SMB, HTTP Remote Web, secret-storage or IPC handler implementations.

## Services

Concrete Desktop capabilities live under `desktop/services/`:

- `python-service.cjs` — Python process lifecycle + multi-workspace scheduler facade;
- `smb-service.cjs` — Windows SMB discovery/session/file operations and cleanup;
- `remote-server.cjs` — Remote Web HTTP API + LAN discovery lifecycle;
- `profile-service.cjs` — project/runtime paths and user profile initialization;
- `secret-service.cjs` — Electron `safeStorage` encrypted secrets;
- `logging-service.cjs` — Desktop diagnostics.

Services may depend on lower-level modules such as `desktop/execution/` and `desktop/lan/`, but renderer/preload code must not import service implementations directly.

## IPC

Electron IPC registration is split under `desktop/ipc/`:

- `runtime-ipc.cjs`;
- `smb-ipc.cjs`;
- `file-ipc.cjs`;
- `remote-ipc.cjs`;
- `window-ipc.cjs`;
- `register.cjs` as the single composition registrar.

Existing preload channel names are a public host contract. Do not rename or duplicate them casually. Add new host capabilities through the relevant service + IPC domain and expose them through the existing PlatformAdapter boundary.

## Window host

`desktop/window/create-window.cjs` owns BrowserWindow construction and the existing Electron smoke path. Window creation is separated because the smoke scenario is large, but lifecycle ownership remains in `main.cjs`.

## Architecture guard

Run:

```text
pnpm test:desktop-host-architecture
```

The guard ensures `main.cjs` stays small, concrete service logic does not return to it, IPC remains domain-split and packaged builds include service/IPC/window modules.

## Next Phase 7 tranche

Android Host should be decomposed next: Capacitor plugin methods become thin bindings over Python/File/SMB/Profile/Remote services. Do not refactor Android and build tooling simultaneously. Build-tool `.psm1` extraction is the final Phase 7 tranche because it carries the most machine-specific compatibility risk.
