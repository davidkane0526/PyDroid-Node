# Current handoff — 1.4.78 / Phase 11 Workflow Compatibility & Migration

The user physically validated the 1.4.73 Desktop Remote Web/LAN path, reported no regression in 1.4.74, and then completed a real Windows dependency-backed build plus **22/22** diagnostics on 1.4.76. Treat **1.4.76 as the frozen Phase 10 boundary** and **1.4.73 as the accepted network-behavior baseline**: fixed TCP 8765, current Remote UI/copy, PIN/token semantics, LAN HTTP readiness and SSDP/UPnP/mDNS behavior must not change without a concrete defect. Any new UI text still requires explicit user approval.

1.4.78 is the corrected Phase 11 completion candidate. 1.4.77 completed the migration architecture but failed the first real dependency-backed Windows build because `src/diagnostics/automated-debug.ts` referenced a nonexistent `EditorWorkspaceSession.captureSnapshot()` API; 1.4.78 fixes that diagnostic-only error and brings the diagnostics module into the strict TypeScript gate. It introduces Workflow schema v3, explicit schema/NodeSpec/function migration chains, Editor Resource schema v2, future-version autosave/resource protection, a complete Git-history workflow corpus, migrated-workflow Python/JavaScript execution parity, a focused strict TypeScript compatibility gate and a Phase 11 freeze audit. It does not change the frozen Remote/LAN implementation or add UI copy.

Version: **1.4.78**, Android versionCode **101**. Build revision: `1.4.78-dev-r54-phase11-final-typecheck-hotfix`.

# Development handoff

Updated: 2026-08-21

## Current repository state

This delivery is a **single local Git repository** whose current Phase 11 work continues from the user-accepted/frozen `PyDroid Node 1.4.76` Phase 10 boundary; the repository ultimately derives from the user-provided clean `PyDroid Node 1.4.55.zip`. Do not use GitHub as a development baseline unless the user explicitly asks for a GitHub operation.

Long-lived branches in this repository:

- `main`: stable `1.4.27 (50)` LAN automatic-discovery baseline;
- `dev`: `1.4.53 (76)` architecture/reliability line with Phase 1 PlatformAdapter + Phase 2 ExecutionController + completed Phase 3 Workflow Core + accepted Phase 3.5 Multi-Workspace Execution + completed Phase 4 Unified NodeSpec / Node Contract + completed Phase 5 full dual-runtime golden parity + completed/frozen Phase 6 Runtime Engine modularization + Phase 7 Desktop/Android Host decomposition, cross-platform host binding contract and safe build-tool module split.
- `fix/phase7-android-service-polish`: `1.4.54 (77)` superseded visual candidate.
- `fix/phase7-final-ui-acceptance`: `1.4.55 (78)` accepted Phase 7 visual baseline used for this phase.
- `phase8/workflow-language-state-functions`: `1.4.59 (82)` accepted/frozen Phase 8 implementation with native Android/Desktop diagnostics export and removable automated diagnostics.
- `phase9/editor-core-workspace-session`: `1.4.60 (83)` Phase 9 Session/Gesture foundation.
- `phase9/editor-core-lifecycle-resources`: `1.4.61 (84)` Phase 9 structural/lifecycle milestone.
- `phase9/editor-core-node-mutations-document-lifecycle`: `1.4.62 (85)` Phase 9 node mutation/document lifecycle milestone.
- `phase9/editor-core-connections-drag-transactions`: `1.4.63 (86)` connection/reconnect, replacement, metadata/template and drag-history milestone.
- `phase9/full-build-gate-fix`: `1.4.65 (88)` production TypeScript build-gate repair.
- `phase9/resource-service-session-lifecycle-audit`: `1.4.66 (89)` Resource Library Service / Session-owned execution identity milestone.
- `phase9/final-freeze-audit`: `1.4.67 (90)` accepted/frozen Phase 9 boundary after the user-host build and 19/19 diagnostics.
- `phase10/desktop-platform-export-gate-fix`: `1.4.69 (92)` accepted Phase 10 Desktop production bundle gate repair milestone.
- `phase10/lan-discovery-lifecycle-automation`: `1.4.70 (93)` LAN discovery lifecycle automation milestone.
- `fix/phase10-remote-web-host-e2e`: `1.4.71 (94)` Remote Web real-host E2E and packaging repair milestone.
- `fix/phase10-lan-firewall-real-readiness`: `1.4.72 (95)` superseded foreground firewall/profile readiness experiment.
- `fix/phase10-remote-startup-single-flight`: `1.4.73 (96)` user-accepted Remote Web/LAN baseline.
- `phase10/host-lifecycle-recovery`: `1.4.74 (97)` accepted-without-observed-regression host lifecycle/recovery milestone.
- `phase10/host-state-reconciliation`: `1.4.75 (98)` read-only native-host/UI state reconciliation milestone (real Windows build later exposed TS18047).
- `fix/phase10-host-state-typecheck`: `1.4.76 (99)` accepted Phase 10 TypeScript production-build hotfix/freeze boundary.
- `phase11/workflow-compatibility-migration`: `1.4.77 (100)` rejected completion candidate due to diagnostics TS2339 in the first real Windows build.
- `fix/phase11-final-typecheck-hotfix`: `1.4.78 (101)` corrected Phase 11 completion candidate.

Current working branch: `phase11/workflow-compatibility-migration`.

The repository must stay as one project directory with `.git` intact. Do not create parallel `dev`, `js`, Android, desktop or rewritten project copies.

## Current product direction

The UI is considered stable. Unless the user reports a concrete UI/interaction defect, do not start another broad visual redesign. The `dev` branch focuses on:

1. architecture boundaries;
2. execution reliability;
3. multi-workspace execution scheduling;
4. unified NodeSpec and Python/JavaScript semantic parity;
5. host/build modularization after the previous layers stabilize.

Read `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md` before continuing architecture work.

## Phase 9 status — Editor Core & Workspace Session

**Started on 1.4.60 (83), accepted/frozen at 1.4.67 (90) after the dependency-backed user-host build and 19/19 diagnostics passed.** `EditorWorkspaceSession` is the per-tab owner of workflow snapshot, selected input, history/dirty state and session-only editor view state. React consumes it through `useSyncExternalStore`; `App.tsx` no longer keeps a second ReactFlow graph via `useNodesState` / `useEdgesState`. Editor Commands now cover deletion/disconnection, group/function/resource structure, ordinary node insertion/duplication/parameter edits/layout, connection/reconnect, node replacement, metadata/template edits and drag completion. Session owns continuous-edit history coalescing plus explicit begin/commit drag-history transactions. `EditorWorkspaceLifecycleService` owns autosave persistence, save/open/reset/close decisions and explicit autosave restore. Explicit restore does not alter the normal one-empty-workflow startup behavior.

Input semantics are explicitly split by **input profile** (`desktop` vs `mobile`) and **target kind** (`node`, `group`, `canvas`, `resource`, `tab`). Do not merge these policies merely to reduce code. In particular, Android node long-press is a multi-select gesture, Android group long-press retains the accepted multi-select gesture while group double-tap remains subflow entry, desktop node double-click opens node actions, and desktop group double-click enters the subflow. See `docs/phase9-editor-core-workspace-session.md`.

The frozen Phase 9 diagnostic boundary contains fifteen Editor Core/session cases plus the four Phase 8 runtime cases and was accepted at **19/19**. Phase 10 1.4.68 added two Remote security/Agent-proxy cases, producing the former **21/21** contract. Those two cases remain valid security/transport-contract checks, but the 21-case runner did not start a real Remote Web host and therefore must not be used as evidence that HTTP/discovery is operational. 1.4.71 adds a real host case; Desktop/Android full-host target is now **22/22**.

## Phase 10 status — Remote Access Security & Host Reliability

**Started at 1.4.68 (91) from the frozen 1.4.67 Phase 9 boundary.** The first milestone hardens Remote Web without changing UI/gesture/workflow/runtime semantics: Desktop and Android share a 5-failure PIN cooldown policy, fresh client-bound 12-hour tokens, normal/expensive per-client API rate limits and a small unauthenticated pairing-body limit. Android Remote Web receives only `agentProxyAvailable`; when a Keystore-backed Agent secret exists, model requests go through the Android Host Agent Proxy and the raw key never enters the browser. Android wildcard CORS exposure was removed, and the proxy refuses unsupported provider protocols and upstream redirects.

Primary files: `desktop/services/remote-security.cjs`, `RemoteAccessGuard.java`, `src/remote-security-policy.ts`, `scripts/remote-security-smoke.mjs`, and `docs/phase10-remote-security-host-reliability.md`.

1.4.70 added the LAN discovery lifecycle regression gate: Desktop executable SSDP/UPnP/mDNS protocol/lifecycle checks plus Android parity and a pure-JDK protocol harness when `javac` is available. `LanDiscoveryService.checkNetwork()` exposes the existing 5-second poll body for deterministic restart testing; discovery behavior itself is not redesigned.

Real 1.4.69 Windows/Android use showed that the old **21/21** report did not prove Remote Web startup. 1.4.71 restored real host HTTP/resource coverage and packaged `package-remote`; 1.4.72 then added fixed 8765 plus stronger LAN/discovery readiness but incorrectly made synchronous Windows firewall/profile inspection a foreground startup blocker. Real 1.4.72 validation also exposed Android cleartext rejection of its own `127.0.0.1` readiness request. 1.4.73 removes those two regressions while retaining fixed-port/LAN/discovery checks and has now been physically accepted by the user. 1.4.74 does not alter that network contract; it adds start/stop generation barriers, Android lifecycle parity, transient per-protocol discovery recovery and fresh running-host observability. 1.4.75 then adds a read-only `getHostStatus()` transport on both hosts and reconciles the already-running UI against that native state every 3 seconds, so address changes, discovery recovery and unexpected native stop cannot leave a stale running indicator. The confirmed validation-regression boundary remains 1.4.51. The Desktop compatibility packaging defect was possible from 1.4.50 onward.

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

### Frozen Phase 10 / 1.4.76 validation

- Python suite: **111 passed, 1 skipped**.
- Runtime parity: **68/68** golden workflows and **75/75** JavaScript-capable NodeContracts.
- Build-tool, UI regression, PlatformAdapter, Host Contract, Remote security, Execution, Desktop Host/file export, Android Host, Workflow Core, Editor Core, Runtime Engine and NodeContract architecture smokes: passed.
- Real Desktop source-host E2E: HTTP bind, `/health`, SPA shell, main JS asset, UPnP XML, PIN pairing, authenticated API and live UDP SSDP M-SEARCH response: passed. Android actual-server JVM E2E: compile, socket startup, health/shell/JS and discovery status: passed.
- LAN discovery lifecycle smoke: Desktop SSDP/UPnP/mDNS identity, `ssdp:all`, CRLF/ST/USN/LOCATION, network restart, byebye/goodbye; Android parity + JDK protocol harness: passed.
- Packaged Desktop smoke source now calls `startRemoteServer(true)` and the compatibility package path stages both Electron and Remote Web browser bundles.
- The real user-host 1.4.75 dependency-backed build exposed `TS18047` in `useRemoteHostReconciliation.ts`. 1.4.76 fixes that exact strict-null narrowing defect by capturing `status.info` before the React updater callback, and the no-dependency UI regression smoke now guards against re-reading nullable `status.info` inside that callback.
- Full dependency-backed TypeScript 7.0.2/Vite/Electron/Gradle packaging still cannot be rerun in this delivery container because project `node_modules`/pnpm are absent and the available Node is 22.16.0 while the repository requires Node 24.19.x. Therefore this delivery does **not** claim a full production build pass until the user-host build completes.
- Desktop start/stop lifecycle smoke covers stale-start cancellation, stop barrier restart, read-only running/stopped host status, PIN stability and idempotent stop. Android JVM host coverage includes queued-start cancellation, concurrent-start ownership and read-only running/stopped status.
- LAN discovery smoke covers transient single-protocol self-recovery without restarting the healthy protocol. The UI reconciliation hook is separately guarded to remain read-only, 3-second bounded, and free of `setMessage()`/new user copy.
- `git diff --check`, syntax checks and version sync must pass before delivery.

The removable in-app diagnostics now contain twenty-two full-host cases. A real Desktop/Android host with both runtimes should report **22/22**. Plain browser/paired Remote Web cannot host another service, so `remote-host-e2e` is skipped there.

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

## Phase 11 status — Workflow Compatibility & Migration

**Implemented in 1.4.78 (101) from the accepted 1.4.76 Phase 10 freeze boundary.** Workflow schema is v3 and migrates through immutable explicit steps. NodeSpec evolution has a registered per-node version chain with parameter/type/port migration, stable-id protection and edge/group/function-handle reconciliation. Reusable function calls only advance when saved signature evidence proves compatibility. Saved Node/Group/Flow resources use resource schema v2; future/invalid payloads are retained as opaque protected raw records rather than normalized or overwritten. Future autosave/workflow open is non-destructive and atomic.

The compatibility corpus is derived from the repository's complete local Git history: all 8 unique committed historical `.workflow.json` documents (schemas v1/v2) are fixtures, plus a future-v99 protection fixture. `test:workflow-compatibility` runs the Git corpus audit, the real parser/migration + canonical save/reopen + migrated-v1 Python/JavaScript execution smoke, a strict TypeScript no-emit subset covering eight production modules including the diagnostics module, and the Phase 11 freeze audit. The full-host diagnostic UI remains 22 cases; Phase 11 checks are embedded into existing rows with no new visible labels. See `docs/phase11-workflow-compatibility-migration.md`.

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

**Final one-shot Phase 11 real-host verification, then freeze Phase 11.** Development scope for Workflow Compatibility & Migration is complete in the corrected 1.4.78 candidate; 1.4.77 is not an accepted build candidate. The next user action should be a single dependency-backed build plus the existing 22-case diagnostics/normal workflow-open check; do not ask for intermediate Phase 11 tests. If that final feedback is clean, mark Phase 11 frozen before defining any Phase 12 scope. Do not modify the frozen Remote Web/LAN path or add UI copy without a concrete defect and explicit user approval.

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

**Phase 7 architecture is complete and frozen on `dev` 1.4.53 (76) after real Windows/Android host/build validation.** `fix/phase7-android-service-polish` carries only the requested 1.4.54 visual-acceptance pass before Phase 8: Android now shows the same `计算服务已开启` label as Desktop in a wider compact banner, and the right-side SMB/Remote/History glyphs are visually refined. Desktop `main.cjs` is a composition/lifecycle façade with focused services under `desktop/services/` and IPC registration under `desktop/ipc/`. Android `PythonExecutorPlugin.java` is a Capacitor binding façade; `AndroidHostServices` owns host lifetimes and focused Java services implement Python/SMB/SAF/Profile/Secret/Remote capabilities.

Cross-platform transport bindings are now documented in `src/platform/host-contract.json`. `scripts/host-contract-smoke.mjs` checks the stable Desktop preload/IPC and Android Capacitor/Java method surface so PlatformAdapter transport cannot drift silently. Read `docs/host-contract.md` before adding or renaming any native host operation.

The Windows builder keeps `Build PyDroid GUI.cmd` as the only user entry. `tools/build-pydroid.ps1` remains the orchestration root while reusable Network/Paths/Node/Java/Android/Python/Packaging primitives live under `tools/modules/*.psm1`. Do not perform another large build-script rewrite: machine-sensitive installation, Gradle and packaging sequence stays in the orchestration script until a concrete independently testable boundary exists. Read `BUILD_TOOLCHAIN.md` and `tools/README-build.md` before build-tool changes.

The 1.4.46/1.4.47 real Windows validation exposed a Windows PowerShell 5.1 module-scope regression. The final root cause was a nested `Import-Module -Force` inside `PyDroid.Build.Packaging.psm1`, which reloaded/re-scoped the Paths module after the composition root imported it globally. 1.4.48 removes all nested build-module imports: `build-pydroid.ps1` is the only module composition root, while each `.psm1` remains self-contained. Linux does not provide Windows PowerShell 5.1, so Phase 7 still requires one normal Windows `Build PyDroid GUI.cmd` run (Desktop + Android) before freezing.

### Phase 7 validation fixes in 1.4.49

Real-device validation confirmed Android Host services and successful Windows/Android packaging, then exposed four integration issues. Build finalization now reports each directly usable platform output immediately and defers expensive old-tree/release cleanup to `tools/deferred-cleanup.ps1`; cleanup failure never invalidates an already successful build. Remote Web now verifies its renderer/asset root before start resolves, serves a non-stale SPA shell, and appends a version query to direct, mDNS and UPnP presentation URLs. Android node-group/workflow resources use movement-vs-hold gesture arbitration plus double-click/double-tap management-menu access, and the main workspace status bar collapses while palette/inspector text input owns the soft keyboard.


### Phase 7 final validation note (1.4.53)

Remote Web startup must remain lightweight: do not add synchronous shell/asset/LAN self-tests before resolving the start action. Resolve the packaged renderer root, bind the HTTP server, start discovery best-effort, and report the clean `http://host:port/` address. Remote browser mode is detected from a non-loopback HTTP(S) host rather than a `?remote=1` query parameter.


## Phase 8 — Workflow Language / State & Function System

**Frozen/accepted on `phase8/workflow-language-state-functions` as 1.4.59 (82).** Desktop/Android build and interaction acceptance plus the 4/4 automated diagnostic report were confirmed by the user before Phase 9 started. The implementation follows the planned order: execution/workspace state isolation, stable function IDs/versions/signatures, dynamic function-call NodeContracts, Python/JavaScript runtime support, parity coverage, then UI. Runtime semantics remain outside `App.tsx`.

Workspace state is renderer/workspace-session scoped, passed explicitly to each execution and returned from successful runs; it is never host/process global. Temporary `variable.get/set` semantics are unchanged. Closing a tab or creating a new workflow clears that workspace's session state.

Workflow schema v2 persists reusable `functions[]`. Calls bind an exact function ID/version and derive typed ports from the signature. Validation rejects broken mappings, version drift and recursive function graphs. Updating a function synchronizes existing calls and removes obsolete call-port edges. Auto runtime selection inspects reachable function bodies, including nested functions, so hidden Python-only dependencies cannot be dispatched to JavaScript accidentally.

The existing Resources sidebar now orders its tabs as Nodes → Functions → Groups → Flows; the palette has a 216 px minimum/default width so the four Chinese labels remain fully visible. The Functions tab contains current-tab workspace variables and persisted function resources. Groups can be saved/updated as functions; calls can be inserted or expanded as editable groups. See `docs/phase8-workflow-language.md` and `tests/manual/phase8/README.md`.

1.4.57 fixed the Desktop state/function adapter and dynamic function-call handles. In 1.4.58, the user-provided Desktop diagnostics report passed 4/4, and Android diagnostics export was moved from WebView anchor download to a native SAF create-document flow with visible save/cancel/failure feedback. In 1.4.59, the Desktop renderer file capability and Electron save-dialog IPC were synchronized after the 1.4.58 TypeScript build failure exposed the missing `exportTextFile` implementation. A temporary automated-diagnostics panel remains available under Settings → Debug & hot reload; it is intentionally isolated in `src/diagnostics/` and may be removed using `docs/automated-diagnostics.md` without touching workflow semantics.
