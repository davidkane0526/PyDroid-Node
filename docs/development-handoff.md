# Development handoff

Updated: 2026-08-19

## Current repository state

This delivery is a **single local Git repository** based only on the user-provided `PyDroid Node 1.4.27 dev architecture baseline.zip`. Do not use GitHub as a development baseline unless the user explicitly asks for a GitHub operation.

Long-lived branches in this repository:

- `main`: stable `1.4.27 (50)` LAN automatic-discovery baseline;
- `dev`: `1.4.28 (51)` architecture/reliability line with Phase 1 PlatformAdapter + Phase 2 ExecutionController.

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

**Implemented and accepted by the user on Windows/Android. Treat the Phase 1 contract as frozen unless a concrete bug is found.**

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
- `node scripts/check-version-sync.mjs`: rerun for Phase 2 as `1.4.28 (51)` before delivery.

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

## Phase 2 status — ExecutionController

**Implemented on `dev` as 1.4.28 (51); pending user Windows/Android runtime acceptance.**

Shared lifecycle:

- `src/execution-controller.ts`
- one active workflow at a time;
- generated/preserved `executionId`;
- `queued → running → success|failed|timeout` and `running → cancelling → cancelled`;
- default timeout 10 minutes; callers may supply another timeout;
- `App.tsx` subscribes to controller state and uses one Stop action for node and Notebook execution.

Windows host:

- `desktop/execution/PythonProcessController.cjs` owns Python child processes;
- `desktop/main.cjs` maps executionId to the host process lifecycle;
- timeout/cancel removes registry state and terminates the Python process; Windows also calls `taskkill /T /F`;
- `desktop/preload.cjs` / `desktop/renderer/bridge.ts` expose `cancelWorkflow`;
- Desktop Remote Web exposes `/api/cancel` and cancels tracked remote executions when the server stops.

Android host:

- `PythonExecutionController.java` owns a dedicated workflow executor, Future registry and timeout scheduler;
- workflow execution no longer occupies the generic SMB/Profile `worker`;
- `PythonExecutorPlugin.cancelWorkflow` and Remote `/api/cancel` use the same controller;
- Remote Web and local Android execution therefore share one host concurrency policy.

Known Android limitation: Chaquopy is embedded in the app process. `Future.cancel(true)` releases Java-side waiting/registry state and interrupts the execution thread, but native C/NumPy code may ignore thread interruption until it returns. Do not claim Android has Windows-style hard process termination. A strict hard-kill guarantee would require a separate process architecture.

## Next development task

After the user confirms Phase 2 host behavior, start **Phase 3 — Workflow Core**. Extract workflow document/session/history/serialization/migration behavior from `App.tsx` without redesigning the UI. Do not start Node Contract or broad host modularization before Workflow Core is stable.


### Production TypeScript vs test TypeScript

Do not add Node typings to the root browser/Android `tsconfig.json` to make a test compile. Production source must remain browser-compatible and uses `types: ["vite/client"]`. Test/spec files are intentionally excluded from the production config and are checked separately by `tsconfig.test.json` through `pnpm test:types`. Any future AI adding tests under `src/` must preserve this boundary.
