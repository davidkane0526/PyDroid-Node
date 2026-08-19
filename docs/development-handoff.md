# Development handoff

Updated: 2026-08-19

## Current repository state

This delivery is a **single local Git repository** based only on the user-provided `PyDroid Node 1.4.27 dev architecture baseline.zip`. Do not use GitHub as a development baseline unless the user explicitly asks for a GitHub operation.

Long-lived branches in this repository:

- `main`: stable `1.4.27 (50)` LAN automatic-discovery baseline;
- `dev`: `1.4.49 (72)` architecture/reliability line with Phase 1 PlatformAdapter + Phase 2 ExecutionController + completed Phase 3 Workflow Core + accepted Phase 3.5 Multi-Workspace Execution + completed Phase 4 Unified NodeSpec / Node Contract + completed Phase 5 full dual-runtime golden parity + completed/frozen Phase 6 Runtime Engine modularization + Phase 7 Desktop/Android Host decomposition, cross-platform host binding contract and safe build-tool module split.

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

**Phase 4 — Unified NodeSpec / Node Contract** is complete/frozen on `dev` 1.4.36 (59). NodeSpec owns explicit runtime support and contract overrides; `src/nodeContract.ts` normalizes runtime/state/cache/function metadata. Runtime Auto, JavaScript compatibility diagnostics, Agent planning, inspector metadata, workflow import validation and speculative pre-execution guards consume this contract. The next architecture stage is Phase 5 Python/JavaScript golden-workflow parity testing.

### Production TypeScript vs test TypeScript

Do not add Node typings to the root browser/Android `tsconfig.json` to make a test compile. Production source must remain browser-compatible and uses `types: ["vite/client"]`. Test/spec files are intentionally excluded from the production config and are checked separately by `tsconfig.test.json` through `pnpm test:types`. Any future AI adding tests under `src/` must preserve this boundary.


## Phase 4 status — Unified NodeSpec / Node Contract

**Complete/frozen on `dev` 1.4.36 (59).** NodeSpec is the authoring source for explicit runtime support, node version and contract overrides; `src/nodeContract.ts` normalizes it into the shared contract used by Runtime Auto, JavaScript compatibility diagnostics, Agent context, inspector metadata, workflow validation and safe speculative execution. Contracts cover runtime support, execution model, determinism, side effects, cache policy, state scope/access and future function role.

Future node families must extend these semantics instead of adding parallel ad-hoc lists:

- function nodes: use `executionModel = function` and `functionRole = definition/call`;
- temporary variables: `stateScope = temporary` with explicit read/write access;
- global variables: `stateScope = global` with explicit read/write access and persistence policy to be defined before implementation;
- stateful or side-effecting nodes must not default to cacheable.

Phase 4 is frozen. Concrete function/global-variable nodes may now be added later, but must extend the established contract and migration semantics; do not create parallel capability lists.


## Phase 5 status — Python / JavaScript parity

**Complete/frozen on `dev` 1.4.38 (61).** `pnpm test:parity` executes 66 golden workflows through both `python/pydroid_flow/engine.py` and the bundled TypeScript/JavaScript engine. The harness validates fixture expectations, compares normalized semantic results, compiles NodeContract and requires golden coverage for every JavaScript-capable contract. Current coverage is 72/72 contracts, including stochastic nodes, interactive nodes, visual subflows and legacy group compatibility.

Scalar/object node previews expose a JSON-safe semantic `value` alongside their human-readable text, so parity compares actual output values instead of presentation formatting. Plot transport remains runtime-specific (Python PNG vs JavaScript interactive chart), so plot cases require valid artifacts on both sides without comparing bytes to chart objects. Python cases run in one batched interpreter process to keep the larger suite fast enough for routine checks.

The suite has already found and fixed real divergences in JSON `indent=0`, CSV terminal newlines, empty `pandas.describe(include=...)` handling and oscillating-pulse symmetry. Read `docs/runtime-parity.md` before changing a dual-runtime node. Remaining special categories include seeded random/sample policy, UI side-effect boundaries and visual subflow structures; these require explicit policies rather than naive exact double execution.


## Phase 6 status — Runtime Engine modularization

**Complete/frozen on `dev` 1.4.42 (65).** Python `engine.py` and `node_dispatch.py` remain compatibility/routing facades with concrete runtime/node responsibilities under `engine_parts/`. JavaScript `engine/nodes.ts` is routing-only and `engine/engine.ts` is now a compatibility facade; node-domain handlers live under `engine/nodes/`, while workflow input/graph/structures/execution/result responsibilities live under `engine/workflow/`. Architecture limits protect all facade and module boundaries from monolith regression. Phase 5 parity remains mandatory for any runtime change.

Read `docs/runtime-engine-modularization.md` before changing runtime structure. Phase 6 is frozen; future runtime changes must preserve its facade/module boundaries and keep Phase 5 parity green. The next architecture stage is Phase 7 Host modularization.


## Phase 7 — Host modularization and build boundary

**Architecture work is complete on `dev` 1.4.49 (72), pending combined real Windows/Android validation before freezing the phase.** Desktop `main.cjs` is a composition/lifecycle façade with focused services under `desktop/services/` and IPC registration under `desktop/ipc/`. Android `PythonExecutorPlugin.java` is a Capacitor binding façade; `AndroidHostServices` owns host lifetimes and focused Java services implement Python/SMB/SAF/Profile/Secret/Remote capabilities.

Cross-platform transport bindings are now documented in `src/platform/host-contract.json`. `scripts/host-contract-smoke.mjs` checks the stable Desktop preload/IPC and Android Capacitor/Java method surface so PlatformAdapter transport cannot drift silently. Read `docs/host-contract.md` before adding or renaming any native host operation.

The Windows builder keeps `Build PyDroid GUI.cmd` as the only user entry. `tools/build-pydroid.ps1` remains the orchestration root while reusable Network/Paths/Node/Java/Android/Python/Packaging primitives live under `tools/modules/*.psm1`. Do not perform another large build-script rewrite: machine-sensitive installation, Gradle and packaging sequence stays in the orchestration script until a concrete independently testable boundary exists. Read `BUILD_TOOLCHAIN.md` and `tools/README-build.md` before build-tool changes.

The 1.4.46/1.4.47 real Windows validation exposed a Windows PowerShell 5.1 module-scope regression. The final root cause was a nested `Import-Module -Force` inside `PyDroid.Build.Packaging.psm1`, which reloaded/re-scoped the Paths module after the composition root imported it globally. 1.4.48 removes all nested build-module imports: `build-pydroid.ps1` is the only module composition root, while each `.psm1` remains self-contained. Linux does not provide Windows PowerShell 5.1, so Phase 7 still requires one normal Windows `Build PyDroid GUI.cmd` run (Desktop + Android) before freezing.

### Phase 7 validation fixes in 1.4.49

Real-device validation confirmed Android Host services and successful Windows/Android packaging, then exposed four integration issues. Build finalization now reports each directly usable platform output immediately and defers expensive old-tree/release cleanup to `tools/deferred-cleanup.ps1`; cleanup failure never invalidates an already successful build. Remote Web now verifies its renderer/asset root before start resolves, serves a non-stale SPA shell, and appends a version query to direct, mDNS and UPnP presentation URLs. Android node-group/workflow resources use movement-vs-hold gesture arbitration plus double-click/double-tap management-menu access, and the main workspace status bar collapses while palette/inspector text input owns the soft keyboard.
