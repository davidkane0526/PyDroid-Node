# Development handoff

Updated: 2026-08-19

## Current repository state

This delivery is a **single local Git repository** based only on the user-provided `PyDroid Node 1.4.27 dev architecture baseline.zip`. Do not use GitHub as a development baseline unless the user explicitly asks for a GitHub operation.

Long-lived branches in this repository:

- `main`: stable `1.4.27 (50)` LAN automatic-discovery baseline;
- `dev`: `1.4.30 (53)` architecture/reliability line with Phase 1 PlatformAdapter + Phase 2 ExecutionController reliability closure + Phase 3 Workflow Core extraction.

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

## Phase 3 cloud validation snapshot

For the 1.4.29 Phase 3 delivery, the coding environment completed:

- Python suite: `103 passed, 1 skipped`;
- Desktop Python bridge: `6 passed`;
- real desktop Python cancellation sentinel test: cancellation prevented the slow workflow from writing its late-completion marker;
- Desktop process lifecycle smoke: success/cancel/timeout plus no-late-output cancellation;
- Android `PythonExecutionController` JDK 21 harness: success, cancel, timeout, slot-retained-until-worker-exit;
- Workflow Core runtime harness: history/session/upstream graph/migration;
- strict TypeScript subset checks for Workflow Core, ExecutionController and Android plugin bridge;
- full TS/TSX parser pass and Node CJS/MJS syntax checks;
- build-tool, PlatformAdapter, ExecutionController and Workflow Core architecture smoke guards;
- version sync, `git diff --check` and `git fsck`.

A full dependency-backed Electron/Android package build cannot be claimed in the Linux cloud environment because it does not provide the user's Windows/Android SDK toolchain. The user remains responsible only for the final Windows/Android real-host run/build verification.

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

**Implemented and user-tested; reliability closure is included in `dev` 1.4.29 (52).**

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
- timeout/cancel terminates the Python process (`taskkill /T /F` on Windows) and keeps registry state until the child actually closes; the renderer remains `cancelling` until host release is confirmed;
- `desktop/preload.cjs` / `desktop/renderer/bridge.ts` expose `cancelWorkflow`;
- Desktop Remote Web exposes `/api/cancel` and cancels tracked remote executions when the server stops.

Android host:

- `PythonExecutionController.java` owns a dedicated workflow executor, Future registry and timeout scheduler;
- workflow execution no longer occupies the generic SMB/Profile `worker`;
- `PythonExecutorPlugin.cancelWorkflow` and Remote `/api/cancel` use the same controller; execution status is exposed locally and remotely so the host UI can show/stop browser-started work;
- Remote Web and local Android execution therefore share one host concurrency policy.

Known Android limitation: Chaquopy is embedded in the app process. Cancellation marks a shared token, interrupts the Future and keeps the host execution slot occupied until the worker really exits. Pure-Python/Notebook code also observes the token through tracing, but native C/NumPy code may ignore interruption until it returns. Do not claim Android has Windows-style hard process termination. A strict hard-kill guarantee would require a separate process architecture.

## Phase 3 status — Workflow Core

**Started on `dev` as 1.4.29 (52). UI layout is intentionally unchanged.**

New core modules under `src/workflow-core/` own:

- persistent `WorkflowSnapshot` cloning/signatures;
- `WorkflowHistory` undo/redo/restore behavior;
- `WorkspaceSessionStore` per-tab dirty/saved state;
- guarded localStorage writes with quota/unavailable classification;
- structural workflow validation and version migration infrastructure;
- serialization helpers;
- reusable upstream graph slicing, currently used by `ui.alert` preflight.

The popup interaction fix deliberately computes only the ancestors feeding the alert `content` port before showing the dialog. The final workflow still executes after the user chooses a button, so side-effecting upstream nodes can execute again; avoid adding hidden side effects to alert-content preparation until the future command/cache layer can resume from a preflight result.

### Android build 82% interpretation

The old single 82% stage covered several expensive operations: production TypeScript/Vite build, Capacitor sync, Gradle startup, Chaquopy Python packaging, Java/resource compilation, DEX merge and APK packaging. `scripts/android-package.ps1` now emits 82/84/85/86/87 nested stage events and a 20-second heartbeat. The build GUI Cancel action is valid throughout this period and terminates the current build process tree and PyDroid Gradle daemon.

## Next development task

Continue Phase 3 by reducing the remaining workflow command/state ownership in `App.tsx` without changing UI layout. After the Workflow Core contract stabilizes, proceed to NodeSpec runtime metadata and Python/JavaScript parity tests.



### Production TypeScript vs test TypeScript

Do not add Node typings to the root browser/Android `tsconfig.json` to make a test compile. Production source must remain browser-compatible and uses `types: ["vite/client"]`. Test/spec files are intentionally excluded from the production config and are checked separately by `tsconfig.test.json` through `pnpm test:types`. Any future AI adding tests under `src/` must preserve this boundary.
