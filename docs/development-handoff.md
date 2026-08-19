# Development handoff

Updated: 2026-08-19

## Current repository state

This delivery is a **single local Git repository** based only on the user-provided `PyDroid Node 1.4.27 dev architecture baseline.zip`. Do not use GitHub as a development baseline unless the user explicitly asks for a GitHub operation.

Long-lived branches in this repository:

- `main`: stable `1.4.27 (50)` LAN automatic-discovery baseline;
- `dev`: `1.4.35 (58)` architecture/reliability line with Phase 1 PlatformAdapter + Phase 2 ExecutionController + completed Phase 3 Workflow Core + accepted Phase 3.5 Multi-Workspace Execution + active Phase 4 Unified NodeSpec / Node Contract.

Current working branch: `dev`.

The repository must stay as one project directory with `.git` intact. Do not create parallel `dev`, `js`, Android, desktop or rewritten project copies.

## Current product direction

The UI is considered stable. Unless the user reports a concrete UI/interaction defect, do not start another broad visual redesign. The `dev` branch focuses on:

1. architecture boundaries;
2. execution reliability;
3. multi-workspace execution scheduling;
4. unified NodeSpec and Python/JavaScript semantic parity;
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

**Complete, user-tested and frozen.** Phase 2 established execution IDs, timeout/cancel semantics and real host-release barriers. Do not reintroduce global UI booleans as an execution authority. Windows Python can hard-terminate child process trees; Android Chaquopy remains cooperative for native C/NumPy work.

## Phase 3 status — Workflow Core

**Complete/frozen on `dev` 1.4.31 (54).** `src/workflow-core/` owns workflow snapshot/signature semantics, guarded persistence, migration/validation, reusable graph commands (including recursive node deletion and node/edge disconnection), independent per-workspace history and dirty/saved session state. Workspace runtime state also retains selected input files across tab switches. Session-only tabs no longer use the dead `pydroid-flow.tabs.v1` localStorage path.

`ui.alert` continues to use `upstreamSubgraph` to compute its current content before opening. Side-effecting ancestors can still be executed again by the final workflow; Phase 4 NodeSpec side-effect metadata will make this policy explicit.

## Phase 3.5 status — Multi-Workspace Execution

**Accepted on Windows Desktop and Android; refined on `dev` 1.4.35 (58) with a background completion badge and task-trigger polish.**

Shared renderer/application behavior:

- `ExecutionManager` owns one `ExecutionController` per `workspaceId`; successful results are stored by workspace so inactive-tab runs survive remount.
- every host request carries `executionId`, `workspaceId`, `workspaceLabel`, `clientId` and `source`; Remote Web and local UI are peers rather than separate special execution slots.
- the primary Run/Stop button controls only the current workspace; same-client background workspaces are managed by switching tabs, while cross-client host actions are available from the bottom status bar.
- paired Remote Web pages poll `/api/execution-status` every 400 ms, fixing the former host→browser stale-button defect.

Desktop host:

- `desktop/execution/WorkflowExecutionScheduler.cjs` schedules Python child processes; capacity is `min(4, available CPU parallelism)` with FIFO queueing above capacity.
- each execution keeps independent process/cancel/timeout lifecycle and shares the scheduler with remote clients.

Android host:

- one Chaquopy worker remains the safe execution capacity; additional workspaces/remote clients queue FIFO instead of receiving global `EXECUTION_BUSY`.
- queued time does not consume execution timeout; queued cancellation is immediate; running cancellation keeps the slot until the callable exits.

JavaScript limitation: the current JS engine still executes synchronously in the renderer and must not be described as truly parallel. Move it to Web Workers before enabling true JS concurrency/hard cancellation.

## Next development task

**Phase 4 — Unified NodeSpec / Node Contract** is now in progress on `dev` 1.4.34 (57). NodeSpec owns runtime support and contract overrides; `src/nodeContract.ts` normalizes the shared execution/state/cache contract. Runtime support, Agent planning and inspector metadata already consume it. Continue by finishing the remaining NodeContract migrations around runtime auto-selection, validation and safe pre-execution guards; once stable, proceed to Phase 5 Python/JavaScript golden-workflow parity tests.

### Production TypeScript vs test TypeScript

Do not add Node typings to the root browser/Android `tsconfig.json` to make a test compile. Production source must remain browser-compatible and uses `types: ["vite/client"]`. Test/spec files are intentionally excluded from the production config and are checked separately by `tsconfig.test.json` through `pnpm test:types`. Any future AI adding tests under `src/` must preserve this boundary.


## Phase 4 status — Unified NodeSpec / Node Contract

**In progress on `dev` 1.4.35 (58).** NodeSpec is now the authoring source for runtime support and contract overrides; `src/nodeContract.ts` normalizes it into a complete shared contract used by runtime support, Agent context, inspector metadata, runtime auto-selection, workflow import validation and side-effect-aware preview guards. Contracts cover runtime support, execution model, determinism, side effects, cache policy, state scope/access and future function role.

Future node families must extend these semantics instead of adding parallel ad-hoc lists:

- function nodes: use `executionModel = function` and `functionRole = definition/call`;
- temporary variables: `stateScope = temporary` with explicit read/write access;
- global variables: `stateScope = global` with explicit read/write access and persistence policy to be defined before implementation;
- stateful or side-effecting nodes must not default to cacheable.

Phase 4 is not frozen yet. Continue moving validation/runtime/UI capability decisions to NodeContract, then add concrete function/variable nodes only after the contract and migration semantics are stable.
