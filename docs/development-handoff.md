# Development handoff

Updated: 2026-08-18

## Current repository state

This delivery is a **single local Git repository** based only on the user-provided `PyDroid Node 1.4.27 dev architecture baseline.zip`. Do not use GitHub as a development baseline unless the user explicitly asks for a GitHub operation.

Long-lived branches in this repository:

- `main`: stable `1.4.27` LAN automatic-discovery baseline;
- `dev`: architecture and reliability development line, based directly on `main`.

Current working branch: `dev`.

The repository must stay as one project directory with `.git` intact. Do not create parallel `dev`, `js`, Android, desktop or rewritten project copies.

## Current product direction

The UI is considered stable. Unless the user reports a concrete UI/interaction defect, do not start another broad visual redesign. The `dev` branch focuses on:

1. architecture boundaries;
2. execution reliability;
3. workflow-core extraction;
4. Python/JavaScript semantic parity;
5. host/build modularization after the previous layers stabilize.

Read `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md` before continuing architecture work.

## Phase 1 status — PlatformAdapter

**Implemented on `dev`; pending user Windows/Android runtime acceptance.**

Shared contract:

- `src/platform/types.ts`

Android/Web:

- `src/platform/index.ts`
- `src/platform/android.ts`
- `src/platform/browser.ts`
- `src/platform/android-plugin.ts`
- `src/platform/remote-session.ts`
- `src/platform/bytes.ts`

Windows renderer:

- `desktop/renderer/bridge.ts`
- `desktop/renderer/platform.ts`
- `desktop/vite.config.ts` maps `./platform` to the desktop adapter.

Boundary after Phase 1:

```text
App.tsx
├─ ./platform
│  ├─ files
│  ├─ SMB
│  ├─ profile/workflow external storage
│  ├─ secrets
│  ├─ remote access
│  └─ runtime/system stats
└─ ./execution
   ├─ Python environment / analysis
   ├─ Python execution
   ├─ JavaScript execution
   └─ Runtime selection
```

The current user-visible UI, Electron preload method names and Android Capacitor plugin method names are intentionally unchanged.

## Validation completed in the cloud

Phase 1 production-boundary checks:

- strict TypeScript check of PlatformAdapter + Runtime module graph with external bridge stubs: passed;
- full TS/TSX syntax parse with TypeScript `--noCheck`: passed;
- compiled JS Runtime harness for Remote Session + Browser + Desktop PlatformAdapter: passed;
- compiled JS Runtime harness for Android PlatformAdapter with a mocked Capacitor PythonExecutor: passed;
- Python tests: `102 passed, 1 skipped`;
- `node scripts/build-tools-smoke.mjs`: passed;
- `node scripts/check-version-sync.mjs`: passed, `1.4.27 (50)`.

The sandbox cannot currently download pnpm from npm (`EAI_AGAIN registry.npmjs.org`), therefore dependency-backed Vitest/Vite production builds cannot be rerun from a fresh clean ZIP in this environment. This is an environment/network limitation, not a passing build claim. The committed Vitest tests will run when dependencies are available.

## User acceptance scope

The user should only need to confirm real-host behavior:

### Windows

- application starts and UI is unchanged;
- CSV picker works;
- SMB discovery/login/browse/read works;
- Remote Web host start/stop and pairing work;
- Python and JavaScript workflows still execute.

### Android

- application starts and UI is unchanged in portrait/landscape;
- native file picker works;
- SMB discovery/login/browse/read works;
- Remote Web host start/stop and pairing work;
- Python and JavaScript workflows still execute.

Do not ask the user to perform routine unit/static/protocol tests that can be automated in the cloud.

## Next development task

After the user confirms Phase 1 host behavior, start **Phase 2 — ExecutionController**:

- execution ID;
- queued/running/cancelling/success/error/timeout states;
- timeout;
- cancellation;
- Windows Python child-process cleanup;
- Android execution Future/task cleanup;
- deterministic recovery after failure/cancel.

Do not start Workflow Core or another UI redesign before this execution lifecycle is stable.
