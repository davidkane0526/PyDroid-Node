# Shared build toolchain baseline

Baseline: **RC10 unified shared toolchain** (2026-08-17).

Future build-tool changes should be based on this implementation rather than the older RC3-RC8 wrappers.
The user-facing entry remains `Build PyDroid GUI.cmd`; PowerShell files under `tools/` are implementation details.

## Runtime baseline

PyDroid Node development/build runtime is standardized on **Node.js 24**:

- `.nvmrc`: `24.19.0`
- `package.json` engines: `>=24.19.0 <25`
- shared build tool default auto-install version: `24.19.0`
- GitHub Actions build/test runtime: Node.js 24
- pnpm: `11.21.0`

This Node.js version controls development scripts, tests and packaging. Electron keeps its own embedded Node.js runtime as defined by the project's Electron version; upgrading the build host to Node.js 24 does not independently replace Electron's embedded runtime.

## Shared layout

Preferred environment variables:

```text
DK_TOOL_ROOT=D:\Code
DK_CACHE_ROOT=D:\Code\BuildCache
```

Recommended shared layout:

```text
D:\Code\
  NodeJs\
  Java\jdk-21\
  Android\Sdk\
  Python\3.12\
  Python\runtime-3.12\
  BuildCache\
    downloads\
    pnpm-store\
    npm\
    corepack\
    electron\
    electron-builder\
    gradle\
```

Node/JDK/Android SDK/Python are reusable machine tools. Electron, electron-builder, Gradle wrapper and JS package versions remain project-controlled; only their download caches are shared.

## Fixes that must be preserved

- CMD-only user entry; PowerShell runs with execution-policy bypass internally.
- WinForms collection-return values are suppressed, so the launcher never prints `0 1 2 ...`.
- GUI avoids PowerShell automatic `$args` mutation and uses Windows PowerShell 5.1-compatible process argument quoting.
- Build output is streamed into the GUI and persisted under `<OutputRoot>\logs`.
- Auto/Direct/Manual network modes propagate proxy settings to pnpm, Electron and script downloads; Direct clears inherited proxy environment variables.
- Persistent pnpm store with `--prefer-offline`, retry, timeout and concurrency controls.
- Shared npm/Corepack/Electron/electron-builder/Gradle/download caches.
- `desktop-package.mjs` compatibility guard handles native `pnpm.exe` correctly instead of passing it to `node.exe`.
- JDK major version is validated and the selected JDK is activated before `sdkmanager` runs.
- Project source remains read-only; compatibility patches are applied only to the temporary workspace.

## Current PyDroid Electron policy

`package.json` declares `electron: ^43.4.0` and `electron-builder: ^26.15.3`.
`pnpm-lock.yaml` currently locks them to Electron **43.4.0** and electron-builder **26.15.3**. Because normal builds use `pnpm install --frozen-lockfile`, that lockfile is the effective reproducible version until it is intentionally updated.

Electron is therefore **not globally fixed by the shared toolchain**. Another project may use another Electron version and reuse the same `DK_CACHE_ROOT`; each project still installs/locks its own package version.
