## 1.4.73 (96) — Phase 10 Remote startup reliability correction — 2026-08-21

- Corrected two regressions exposed by the real 1.4.72 Desktop/Android builds. Desktop no longer blocks Remote Web startup on synchronous Windows network-profile/firewall PowerShell probing, and Android no longer uses `HttpURLConnection` for its loopback readiness probe.
- Desktop Remote Web startup is single-flight in both the renderer transition and Electron host service. Repeated clicks/concurrent IPC calls share one in-flight startup instead of creating repeated elevation/start attempts; a failed start no longer reopens the Remote Access dialog automatically.
- Removed the unapproved Windows-firewall explanatory sentence added to the Remote Access dialog in 1.4.72. No new UI copy is introduced in this release.
- The runtime start path no longer calls `ensureWindowsLanFirewall()`. Fixed TCP 8765, LAN-address `/health`, default-route interface selection, real SSDP/mDNS bind+multicast readiness, persistent UPnP identity and PIN/token security remain intact. Firewall tooling remains separated from the foreground host startup path.
- Android host readiness now performs a real raw TCP/HTTP request to `127.0.0.1:8765`, avoiding Android cleartext-policy rejection while still proving that the actual server socket serves `/health`, the SPA shell and its main asset. `SO_REUSEADDR` is set before bind, and SSDP/mDNS only report running after at least one multicast join succeeds.
- Diagnostics remain 22 cases. The host E2E case verifies host/LAN-interface HTTP and discovery readiness but no longer pretends that same-process testing can certify Windows firewall policy or reachability from a second physical device.
- Build script revision: `1.4.73-dev-r49-phase10-remote-startup-reliability`.

## 1.4.72 (95) — Phase 10 LAN firewall / readiness experiment — 2026-08-20

- Introduced fixed TCP 8765, stronger LAN-IP and multicast readiness, and default-route/same-subnet interface selection. These parts are retained in 1.4.73.
- Also introduced synchronous Windows firewall/profile enforcement in the foreground Remote Web startup path. Real 1.4.72 validation showed `NetworkCategory=Unknown` could stop an otherwise startable host, cause long first-start latency/repeated elevation prompts, and make diagnostics fail for the wrong reason. That foreground enforcement is reverted in 1.4.73.

## 1.4.71 (94) — Phase 10 Remote Web host E2E repair — 2026-08-20

- Corrected a validation gap exposed by the real 1.4.69 Windows/Android builds: the previous 21/21 in-app diagnostics verified editor/runtime/security contracts but did not prove that a packaged host actually bound HTTP, served the browser bundle, or started SSDP/mDNS.
- Desktop and Android Remote Web now perform a non-blocking loopback readiness check for `/health`, the SPA shell and its main JavaScript asset before startup is reported as successful. LAN-address hairpin access is intentionally not a production startup blocker.
- Fixed the Windows compatibility-packaging fallback introduced after the dedicated Remote Web browser bundle appeared in 1.4.50: it now builds and stages both `desktop/package-renderer` and `desktop/package-remote`. The packaged Desktop smoke actually starts and stops Remote Web, so a missing browser bundle can no longer ship behind a green desktop smoke.
- Host connection info now reports usable LAN interfaces and live SSDP/mDNS status. Built-in diagnostics add `remote-host-e2e`; a capable Desktop/Android host must now report **22/22** and fails when only loopback is exposed or discovery is not running.
- Added `test:remote-host-e2e`: Desktop starts the real HTTP service, fetches health/shell/UPnP, pairs with a PIN, calls an authenticated API and sends a live SSDP M-SEARCH datagram; a pure-JVM Android harness compiles and starts the actual `RemoteWorkflowServer`, then verifies health/shell/JS and discovery status.
- Reinstated strong readiness coverage removed in 1.4.51, without reinstating the former LAN hairpin startup dependency.
- Build script revision: `1.4.71-dev-r47-phase10-remote-host-e2e`.

## 1.4.70 (93) — Phase 10 LAN Discovery Lifecycle Automation — 2026-08-20

- Promoted the existing SSDP/UPnP + mDNS implementation to a guarded Phase 10 lifecycle contract instead of redesigning discovery behavior.
- Added `scripts/lan-discovery-lifecycle-smoke.mjs` with executable Desktop coverage for persistent UUID identity, UPnP `device.xml`, SSDP `ssdp:all` three-target responses, CRLF/ST/USN/LOCATION framing, network-change restart, SSDP `ssdp:byebye`, mDNS A/PTR/SRV/TXT publication and TTL=0 goodbye.
- Added Android parity auditing plus a pure-JDK compile/runtime harness (when `javac` is available) for persistent identity, UPnP identity fields, SSDP target/USN parity and mDNS record/TTL parity without requiring an emulator or Android SDK.
- Extracted Desktop network polling into `LanDiscoveryService.checkNetwork()` so network-change restart behavior is directly testable while preserving the existing 5-second production monitor.
- Added `test:lan-discovery` to the normal `pnpm check` gate. The in-app automated diagnostic contract remains **21/21** because this milestone protects host discovery transport rather than adding a renderer/runtime diagnostic case.
- Accepted UI, gesture, Workflow schema, Remote security and Python/JavaScript runtime semantics are unchanged.
- Build script revision: `1.4.70-dev-r46-phase10-lan-discovery-lifecycle`.

## 1.4.69 (92) — Phase 10 Desktop Platform Export / Production Bundle Gate Repair — 2026-08-20

- Fixed the dependency-backed Desktop Vite/Rolldown build failure where `App.tsx` imported `proxyRemoteAgentRequest` through `./platform` but the Desktop Vite alias facade did not export that symbol.
- Added the missing Desktop `proxyRemoteAgentRequest(provider, body)` facade wrapper while preserving the existing Desktop remote-session implementation and Android Host Agent Proxy security boundary.
- Strengthened `platform-architecture-smoke.mjs`: every named symbol imported by `App.tsx` from `./platform` must now exist in both the shared facade and the Desktop aliased facade, catching module-link export drift before production bundling.
- Remote security/runtime/editor behavior and the 21-case automated diagnostic contract are unchanged.
- Build script revision: `1.4.69-dev-r45-phase10-desktop-platform-export-gate`.

## 1.4.68 (91) — Phase 10 Remote Access Security / Host Agent Proxy — 2026-08-20

- Phase 9 is formally frozen at 1.4.67 after the user-host dependency-backed build and **19/19** automated diagnostics passed.
- Added Desktop/Android Remote Web PIN failure throttling: 5 failures in a 60 s window trigger a 60 s cooldown and HTTP 429/`Retry-After`.
- Replaced reusable host-wide pairing tokens with fresh client-address-bound session tokens (12 h TTL, 32-token cap) and added normal/expensive API rate limits (240/min and 30/min).
- Added a small 64 KiB unauthenticated pairing-body limit and stale-token removal after Remote Web receives HTTP 401.
- Android `/api/app-configuration` no longer returns the raw Agent API key. Remote Web uses an Android Host Agent Proxy when a Keystore-backed secret is available; provider/endpoint remain host-owned and upstream redirects are disabled.
- Removed Android wildcard CORS exposure for Remote APIs; packaged Remote Web continues to use same-origin requests.
- Added `remote-security-smoke.mjs`, pure-Java Android `RemoteAccessGuard`, shared diagnostic policy, Agent transport abstraction and two automated diagnostic cases. A full Desktop/Android host should now report **21/21**.
- Accepted Desktop/Mobile × Node/Group gesture semantics, Workflow schema and Python/JavaScript runtime semantics are unchanged.
- Build script revision: `1.4.68-dev-r44-phase10-remote-security`.

## 1.4.67 (90) — Phase 9 Final Ownership / Freeze Candidate — 2026-08-20

- Moved workflow dependency-list add/update/remove into explicit Editor Commands; package requirements are now undoable Session transactions rather than direct React state mutations.
- Interactive `ui.input_dialog` / `ui.alert` responses now use execution-only node-parameter overrides and no longer write runtime answers back into the persisted Editor Snapshot or dirty state.
- Added `scripts/phase9-freeze-audit.mjs` as a stricter freeze gate: persistent workflow fields may not be mutated through direct `setNodes`/`setRequirements` paths in `App.tsx`; remaining direct graph writes are presentation-only selection/status/class state.
- Expanded removable automated diagnostics from 17 to **19** cases with requirement-command ownership and runtime-interaction isolation.
- Accepted Desktop/Mobile × Node/Group/Canvas/Resource/Tab gesture semantics are unchanged.
- Build script revision: `1.4.67-dev-r43-phase9-final-freeze-audit`.

## 1.4.66 (89) — Phase 9 Resource Service / Session Execution Lifecycle / Ownership Audit — 2026-08-20

- Added `EditorResourceLibraryService` as the observable persistence owner for saved nodes, group resources and workflow-library entries; `App.tsx` no longer owns their localStorage keys or mutable library copies.
- `EditorWorkspaceSession` now owns a stable `workspaceId + clientId + source` identity for its entire tab lifetime.
- Shared and Desktop renderer execution controllers are keyed by the full Session identity, preventing equal tab IDs from different Local/Remote clients from sharing local execution lifecycle state.
- Tab status subscription, cancellation and workspace result/variable cleanup now consume the Session-owned identity; Host execution matching uses the same identity boundary.
- Added `scripts/phase9-ownership-audit.mjs` to prevent resource persistence, raw tab-ID execution control or legacy Agent graph surgery from returning to React.
- Expanded removable automated diagnostics from 15 to **17** cases with Resource Service persistence and Session/Execution lifecycle isolation.
- Accepted Desktop/Mobile × Node/Group/Canvas/Resource/Tab gesture semantics are unchanged.
- Build script revision: `1.4.66-dev-r42-phase9-resource-service-session-lifecycle`.

## 1.4.65 (88) — Phase 9 Production TypeScript Build Gate Repair — 2026-08-20

- Restored the optional requested-position parameter for Function resource insertion so drag/drop retains its canvas position while button insertion keeps automatic placement.
- Added a regression guard for the Function resource-drop helper contract after the user production build exposed the prior arity mismatch.
- Runtime diagnostics remained 15/15; this release was a compile-gate repair.

## 1.4.64 (87) — Phase 9 Resource Contract / Remote Session Identity / Atomic AI Graph Surgery — 2026-08-20

- Added a shared Resource Contract for catalog nodes, saved nodes, functions, groups and workflows, including centralized primary-action/drag/rename/remove/lock capabilities and built-in/locked protection.
- Added cross-layer `WorkspaceSessionIdentity` (`workspaceId + clientId + source`) and keyed execution results/workspace variables by that identity to prevent Remote Web client collisions.
- Shared and Desktop execution adapters now read/write workspace state through the same session identity and host execution matching requires workspace + client + source identity.
- Added Session-level atomic command batches and moved AI plan graph surgery into Editor Core. A valid plan produces one undo baseline; an invalid plan is rejected without partial graph mutation.
- Expanded removable automated diagnostics from 12 to 15 cases with Resource Contract, workspace identity and AI atomic-batch coverage.
- Accepted Desktop/Mobile × Node/Group gesture behavior remains unchanged.
- Build script revision: `1.4.64-dev-r40-phase9-resource-remote-agent-session`.

## 1.4.60 (83) — Phase 9 Editor Core / Workspace Session foundation — 2026-08-20

- Started Phase 9 by introducing `EditorWorkspaceSession` / `EditorSessionStore` as the canonical per-tab owner of graph, reusable functions, requirements, selected input, undo/redo history, dirty/saved state and editor view state.
- Added a `useSyncExternalStore` React adapter so React Flow renders session-owned state instead of maintaining a second `useNodesState` / `useEdgesState` graph copy in `App.tsx`.
- Added the first Editor Command boundary for graph deletion/disconnection, moving editing semantics out of event handlers and toward `UI -> EditorCommand -> WorkspaceSession -> Workflow Core`.
- Added an explicit gesture-policy matrix keyed by input profile and target kind (`desktop/mobile × node/group/canvas/resource/tab`). Desktop and mobile no longer share hidden timing constants, and nodes/groups no longer have to share the same long-press/double-click meaning.
- Current intended gesture contract preserves desktop node double-click actions and group double-click subflow entry, while Android node stationary long-press enters multi-select and Android group stationary long-press remains multi-select while its double-tap enters the group/subflow. Canvas pan/marquee, resource hold and tab hold thresholds are also centralized.
- Expanded temporary automated diagnostics with Editor Session isolation and gesture-contract cases; a fully capable Desktop/Android host should now report 6/6 rather than 4/4.
- Build script revision: `1.4.60-dev-r36-phase9-editor-core-session`.

## 1.4.59 (82) — Desktop export/build repair — 2026-08-20

- Fixed the 1.4.58 Windows Desktop TypeScript build break: the Desktop `files` PlatformAdapter now implements the required `exportTextFile` capability.
- Added a native Electron save-file IPC path for diagnostics/text export (`showSaveDialog` + UTF-8 write), so Desktop export no longer depends on a browser download fallback.
- Fixed Desktop PlatformAdapter initialization so TypeScript no longer returns a nullable adapter after construction.
- Added `files.exportTextFile` to the renderer-to-host contract and Desktop architecture smoke coverage to prevent Android/Desktop file-capability drift.
- Build script revision: `1.4.59-dev-r35-phase8-desktop-export-build-fix`.

## 1.4.58 (81) — Android diagnostics export + Resources layout — 2026-08-20

- Android automated-diagnostics JSON export now uses the system Storage Access Framework (`ACTION_CREATE_DOCUMENT`) instead of a WebView download anchor, so tapping **导出 JSON** opens the native file-save picker and reports saved/cancelled/failed status inside the diagnostics dialog.
- The latest diagnostics report continues to be written to the application profile log as a fallback.
- Reordered Resources tabs to **节点 → 函数 → 组合 → 流程**.
- Raised the Resources pane minimum/default width to 216 px and removed tab-label ellipsis so the four Chinese tab labels remain fully visible.
- Added UI/Android-host regression guards for tab order, palette minimum width and native diagnostic export.
- Build script revision: `1.4.58-dev-r34-phase8-diagnostics-export-ui`.

## 1.4.57 (80) — Phase 8 acceptance fixes + automated diagnostics — 2026-08-20

- Fixed Windows Desktop workspace-session variables by bringing the renderer execution adapter onto the same Phase 8 state/function contract as the shared Android/Web execution path.
- Fixed reusable `function.call` canvas cards so persisted dynamic input/output signatures render real connectable handles.
- Explicitly refreshes the Functions resource page after a successful execution so workspace variables such as `phase8_rows` appear immediately.
- Added a temporary, isolated automated-diagnostics module in Settings for Desktop and Android. One click checks cross-run workspace state, reusable-function dynamic ports/absolute-value execution, and both JavaScript/Python hosts when available, then copies/exports a JSON report.
- The diagnostics feature uses disposable diagnostic workspace IDs, does not mutate the active canvas/workspace state, and can be removed without changing workflow schema or runtime protocols.
- Build script revision: `1.4.57-dev-r33-phase8-diagnostics-fix`.

## 1.4.56 (79) — Phase 8 Workflow Language / State & Function System — 2026-08-20

- Added per-workspace session variables alongside execution-local variables, with explicit JSON-safe runtime state transport and tab isolation.
- Added schema-v2 versioned reusable workflow functions, dynamic function-call ports, migration/validation/recursion guards and Python/JavaScript execution parity.
- Auto runtime selection now inspects reachable function bodies; Python-only nodes hidden inside a reusable function correctly force Python.
- Added Functions resource UI, editable function expansion/update, call synchronization and obsolete-port edge cleanup.
- Added Phase 8 automated coverage and a complete real-host acceptance pack under `tests/manual/phase8/`.
- Build script revision: `1.4.56-dev-r32-phase8-workflow-language`.

## 1.4.55 (78) — Phase 7 final UI acceptance correction — 2026-08-20

- Restored the Phase-1 content-width Remote Web banner model and kept status, URL, copy, PIN and collapse on one aligned row on both Desktop and Android.
- Reduced SMB import-footer and AI Agent plan-action button metrics to match the main application control system.
- Removed the active Remote shortcut blue fill, kept only the green running indicator, thinned all three status-bar glyphs, and replaced the SMB server-stack glyph with a network-topology symbol.
- Runtime/host behavior is unchanged.
- Build script revision: `1.4.55-dev-r31-phase7-final-ui-acceptance`.

## 1.4.54 (77) — Phase 7 Android service UI acceptance polish — 2026-08-20

- Remote Web banner now reserves a stable wider row and explicitly keeps `计算服务已开启` visible on Android, matching the Desktop information hierarchy while retaining the compact canonical URL / copy / PIN / collapse controls.
- Refined the three right-side status-bar shortcut glyphs with a lighter shared stroke weight; replaced the SMB folder-style glyph with a compact two-bay network-drive/server glyph.
- Added UI regression guards for Android banner status visibility/width, the SMB glyph, and shared status-bar icon stroke weight. No Remote Web, SMB, execution, or host-contract behavior changed.
- This is the final Phase 7 visual-acceptance candidate before starting Phase 8 after user confirmation.
- Build script revision: `1.4.54-dev-r30-phase7-android-service-polish`.

## 1.4.53 (76) — Phase 7 service-statusbar polish and freeze — 2026-08-20

- Remote Web service banner can now collapse into the bottom status bar without stopping the host service. The host Remote button remains visually active while the service is running, and the bottom Remote shortcut restores the compact banner on demand.
- Added a compact SMB shortcut beside the Remote and History controls on the right side of the bottom status bar; it opens the existing SMB file manager directly without introducing a second SMB implementation.
- Desktop and Android share the same service-status UI behavior and styling, including light/dark themes.
- Phase 7 Host + Build modularization is now frozen after real Windows/Android validation and this final service-statusbar UX pass.
- Build script revision: `1.4.53-dev-r29-phase7-service-statusbar`.

## 1.4.52 (75) — Remote Web banner rollback + Android palette drag restoration — 2026-08-20

- Rolled the Remote Web host banner back to the compact Phase-1-style presentation: one canonical URL, one copy button, and optional compact PIN only. Alternate adapter addresses remain internal and no longer expand the banner.
- Restored Android palette dragging by returning resource cards to `touch-action: pan-y`: vertical palette scrolling remains native, while horizontal movement is reserved for the custom drag-to-canvas gesture instead of being consumed by WebView `manipulation`.
- Kept the 1.4.51 Remote Web host implementation and concise canonical URL unchanged; this change intentionally simplifies presentation without adding new Remote Web startup logic.
- Build script revision: `1.4.52-dev-r28-phase7-ui-drag-rollback`.

## 1.4.51 (74) — concise Remote Web startup + Android selection polish — 2026-08-20

- Simplified the Desktop/Android Remote Web banner to `计算服务已开启`, one fully visible clean URL, `复制地址`, an optional address expander, and the PIN only when enabled. Removed version/query noise and diagnostic self-test wording.
- Removed blocking Remote Web HTTP/resource self-tests from service startup. Desktop reports once the server is listening; Android starts the server on the host request executor so the Capacitor action stays responsive.
- Remote browser detection now uses the served HTTP(S) host rather than `?remote=1`, allowing memorable URLs such as `http://192.168.1.104:5671/`. SSDP/mDNS/UPnP advertisements use the same clean path.
- Android app chrome now disables accidental webpage-style text selection while preserving editable fields and explicit text outputs.
- Refined group/flow resource gestures: stationary long press is ~0.7 s, touch double-tap tolerance is more practical, native `dblclick` is accepted when WebView emits it, and drag movement still cancels menu recognition.
- Build script revision: `1.4.51-dev-r27-phase7-remote-ui-startup`.

## 1.4.50 (73) — Phase 7 real validation fixes: immediate GUI artifacts, Remote Web browser bundle, robust Android touch menus — 2026-08-19

- Build GUI now consumes `@@PYDROID_ARTIFACT@@` events and shows clickable Windows/Android output paths immediately when each platform finishes; Android packaging is invoked directly instead of through an extra pnpm/PowerShell wrapper to avoid the observed 87% handle stall.
- Desktop Remote Web now packages and serves a dedicated browser-native renderer (`desktop/package-remote`) instead of the Electron renderer bundle. Desktop and Android both self-test `/health`, the SPA shell and its main JS asset before reporting that Remote Web is ready. Hosts also expose alternate LAN URLs when multiple interfaces exist.
- Android palette resource gestures now use a pointer-level double-tap detector (<=360 ms) because WebView does not reliably synthesize `dblclick`. Stationary long-press is 680 ms; movement over 8 px cancels the menu and wins as drag. Workflow and group resources share the same gesture state machine.
- Preserves the 1.4.49 Android keyboard/status-bar fix.
- Build script revision: `1.4.50-dev-r26-phase7-real-validation-fixes`.

## 1.4.49 (72) — Phase 7 validation fixes: Remote Web, touch gestures, keyboard, non-blocking build finalization — 2026-08-19

- Build completion no longer waits for large Electron/Python directory deletion. Windows and Android print their directly usable build paths immediately when each platform finishes; final old-output/workspace cleanup is launched in a detached PowerShell worker after outputs are ready.
- Remote Web startup now validates its packaged renderer/assets before reporting success, serves SPA routes robustly, disables stale shell caching, and version-tags direct/mDNS/UPnP presentation URLs so browsers do not reuse an old hashed-asset index after an app upgrade.
- Android node-group and workflow-library resources now distinguish movement from stationary hold at an 8 px threshold; stationary menu hold is 520 ms and both resources support double-click/double-tap menu opening without sacrificing drag behavior.
- On Android main-workspace palette/parameter text editing, the bottom status-bar row collapses while the IME is visible instead of floating upward above the keyboard.
- Build script revision: `1.4.49-dev-r25-phase7-validation-fixes`.

## 1.4.48 (71) — Windows PowerShell 5.1 nested-module scope fix — 2026-08-19

- Fixed the real root cause of the Phase 7 Windows GUI build failure: `PyDroid.Build.Packaging.psm1` was force-importing `PyDroid.Build.Paths.psm1` inside another module, which can evict/re-scope the globally imported Paths module under Windows PowerShell 5.1.
- Removed all nested imports between PyDroid build modules. Packaging now owns a private extended-length-path helper and no longer reloads Paths.
- Strengthened the build-tool architecture guard so focused build modules may not import one another; module composition is owned only by `build-pydroid.ps1`.
- Build script revision: `1.4.48-dev-r24-phase7-build-module-scope-fix`.

## 1.4.47 (70) — Windows build-module command resolution hotfix — 2026-08-19

- Fixed the Phase 7 Windows build-tool regression where `Resolve-AbsolutePath` and other helpers moved to `.psm1` modules could be unavailable in the GUI-launched Windows PowerShell child process.
- Build modules are now imported with global scope and all orchestration calls use explicit `ModuleName\CommandName` qualification, so helper resolution no longer depends on PowerShell scope lookup.
- Added an immediate module-surface preflight for `PyDroid.Build.Paths\Resolve-AbsolutePath` and strengthened build-tool architecture smoke checks to prevent unqualified helper calls from returning.
- No application/runtime behavior changed; this is a build-tool reliability hotfix on top of the accepted 1.4.46 Android gesture fix.
- Build script revision: `1.4.47-dev-r23-phase7-build-module-import-fix`.

## 1.4.46 (69) — Android node drag/menu gesture separation — 2026-08-19

- Fixed Android resource dragging so moving a palette node/group/saved node cancels the menu hold and enters drag mode instead of triggering the node resource menu.
- Preserved touch resource management: a stationary long press (~760 ms) still opens the node/group menu, including rename/delete actions for saved/custom nodes. Desktop right-click behavior is unchanged.
- Saved/custom nodes now use the same touch drag gesture path on coarse pointers while keeping desktop drag sorting.
- Added a touch-drag guard for canvas nodes so the synthetic WebView context-menu event emitted during an active node drag is ignored, while a stationary long press can still open the node menu.
- Phase 7 architecture remains unchanged from 1.4.45 and still awaits the planned combined Windows + Android validation.
- Build script revision: `1.4.46-dev-r22-phase7-touch-gesture-fix`.

## 1.4.45 (68) — Phase 7 host contract + build-tool modules + UI fixes — 2026-08-19

- Remote/Web workspace failure indicators are now transient: a host-aborted `failed`/`timeout` tab shows the red diagnostic dot briefly and then clears automatically without erasing the underlying execution error/status.
- Android SMB credential editing no longer lets the soft keyboard push the file-manager footer actions over the connection form. Native input focus temporarily hides the footer and restores it automatically after editing.
- Settings cards now stretch to their two-column grid row so the paired LAN SMB / AI Agent and Debug / Profile sections share aligned bottom edges.
- Added `src/platform/host-contract.json` plus `scripts/host-contract-smoke.mjs` to lock 30 stable Desktop IPC / Android Capacitor transport bindings behind PlatformAdapter and prevent host binding drift.
- Continued/finalized the safe Phase 7 build-tool split: `tools/build-pydroid.ps1` remains the orchestration root while reusable Network, Paths, Node, Java, Android, Python and Packaging logic lives in focused Windows PowerShell 5.1-compatible `.psm1` modules under `tools/modules/`.
- Added build-tool architecture and UI regression smoke guards; existing package-manager/network/long-path compatibility smoke now validates both the orchestration script and imported modules.
- Build script revision: `1.4.45-dev-r21-phase7-host-contract-build-modules`.

## 1.4.44 (67) — Phase 7 Android Host service modularization — 2026-08-19

- Reduced `PythonExecutorPlugin.java` from 713 lines to a compact Capacitor binding façade. Existing `PythonExecutor` plugin method names and activity callback names remain stable for the TypeScript PlatformAdapter.
- Added Android host service composition under `android/app/src/main/java/com/dk/pydroidflow/host/`: lifecycle/composition, Python execution, SMB, Storage Access Framework files, profile/workflow library, encrypted secrets, and Remote Web server lifecycle.
- Kept `PythonExecutionController`, `RemoteWorkflowServer`, LAN discovery and keystore primitives behind these service boundaries rather than reimplementing them.
- Added `test:android-host-architecture` to prevent native logic from accumulating back inside the Capacitor plugin and to enforce stable plugin bindings/service ownership.
- Android Gradle compilation was attempted in the cloud but could not download the Gradle 8.14.3 distribution because outbound Gradle network access is unavailable; Java source syntax and architecture checks plus all platform-independent regression suites are still run.
- Build script revision: `1.4.44-dev-r20-phase7-android-host`.

## 1.4.43 (66) — Phase 7 Desktop Host services and IPC modularization — 2026-08-19

- Started Phase 7 by reducing `desktop/main.cjs` from 1021 lines to a small composition/lifecycle root.
- Split Desktop host responsibilities into explicit services: Python workflow scheduling/process lifecycle, SMB, Remote Web/LAN discovery, profile paths, encrypted secrets and desktop logging.
- Split Electron IPC registration by domain (`runtime`, `SMB`, `file`, `remote`, `window`) with a single composition registrar; preload/renderer channel contracts remain unchanged.
- Moved BrowserWindow construction/smoke behavior into a dedicated window host module while keeping `main.cjs` responsible for lifecycle composition.
- Added `test:desktop-host-architecture` and packaging assertions so Desktop service/IPC modules cannot be omitted or collapsed back into `main.cjs`.
- Phase 1–6 architecture checks, Python tests and the 72/72 dual-runtime parity gate remain green.
- Build script revision: `1.4.43-dev-r19-phase7-desktop-host`.

## 1.4.42 (65) — Phase 6 JavaScript workflow orchestration modularization — 2026-08-19

- Completed the remaining JavaScript Runtime orchestration split without changing workflow-visible semantics. `src/runtime/javascript/engine/engine.ts` dropped from ~596 lines to a compatibility facade that re-exports stable execution/environment/ordering APIs.
- Added `engine/workflow/` modules for input decoding/safety limits, graph/upstream/group topology, visual/loop structures, execution orchestration, result/error serialization and shared workflow types.
- Strengthened `runtime-engine-architecture-smoke.mjs`: JavaScript `engine.ts` is capped as a facade, all workflow modules are required and size-bounded, and orchestration logic may not migrate back into the facade.
- Phase 5 behavior locks remain green: 66/66 golden workflows pass and all 72 JavaScript-capable NodeContracts remain covered; Python regression remains 106 passed / 1 skipped.
- Phase 6 Runtime Engine modularization is now complete/frozen. The next architecture stage is Phase 7 Host modularization and build-tool organization.
- Build script revision: `1.4.42-dev-r18-phase6-workflow-orchestration`.

## 1.4.41 (64) — Phase 6 JavaScript node-domain handlers — 2026-08-19

- Split the former ~1129-line `src/runtime/javascript/engine/nodes.ts` into a 27-line routing facade plus six domain handlers: `io_generate`, `table_pandas`, `control_state`, `analysis_pulse`, `plots`, and `conversion_ui`.
- Split shared JavaScript node helpers into focused support modules (`types`, `common`, `io`, `table_ops`, `control`, `analysis`, `pulse`, `serialization`) instead of replacing one monolith with another helper monolith.
- Extended `runtime-engine-architecture-smoke.mjs` so `engine/nodes.ts` must remain routing-only, domain handlers stay below 260 lines, and support modules stay below 220 lines.
- Full Phase 5 parity remains green after the refactor: 66/66 golden workflows and 72/72 JavaScript-capable NodeContracts. Python regression remains 106 passed / 1 skipped.
- Build script revision: `1.4.41-dev-r17-phase6-js-domain-handlers`.

## 1.4.40 (63) — Phase 6 Python node-domain handlers — 2026-08-19

- Continued Phase 6 without changing workflow semantics. The transitional Python `engine_parts/node_dispatch.py` dropped from 577 lines to a routing-only facade (~28 lines).
- Added `engine_parts/nodes/` domain handlers for IO/generators, table/pandas, control/state, analysis/pulse, plotting, and conversion/UI/custom-code nodes. Concrete node algorithms no longer live in the central dispatcher.
- Added Python registry tests which require domain handler node-type sets to be disjoint and cover representative node families.
- Strengthened `runtime-engine-architecture-smoke.mjs`: `node_dispatch.py` is now capped at 80 lines, cannot contain node implementation branches, all six handler modules are required, and individual domain handlers are capped to prevent another monolith.
- Full Python regression and Phase 5 parity remained unchanged after the move: 106 passed / 1 skipped; 66/66 golden workflows; 72/72 JS-capable NodeContract coverage.
- JavaScript `engine/nodes.ts` remains the next Phase 6 split target; Phase 6 is not frozen yet.
- Build script revision: `1.4.40-dev-r16-phase6-domain-handlers`.

## 1.4.39 (62) — Phase 6 Python runtime core modularization — 2026-08-19

- Started Phase 6 Runtime Engine modularization without changing workflow-visible semantics. `python/pydroid_flow/engine.py` is reduced from 2361 lines to a small compatibility facade which preserves the existing public/legacy imports.
- Extracted Python runtime implementation into `python/pydroid_flow/engine_parts/`: workflow orchestration/cancellation, node dispatch, notebook execution, graph traversal, cache, value coercion, portable RNG, CSV readers, custom-function sandbox/signature logic, analysis helpers, pulse helpers and result presentation.
- JavaScript engine was already split into domain modules (`engine/nodes/table/plots/csv/notebook/random`), so Phase 6 keeps semantic symmetry through NodeContract/parity rather than forcing identical file layouts.
- Added `test:runtime-engine-architecture` / `scripts/runtime-engine-architecture-smoke.mjs`. The guard keeps `engine.py` a facade and prevents the transitional node dispatcher from growing unchecked.
- All Python regression tests and the Phase 5 golden parity gate remain behavior locks during the extraction.
- Build script revision: `1.4.39-dev-r15-phase6-runtime-modules`.

## 1.4.38 (61) — Phase 5 complete: full dual-runtime golden coverage — 2026-08-19

- Phase 5 Python/JavaScript parity is complete/frozen for the current NodeContract surface. `pnpm test:parity` now executes 66 golden workflows and requires coverage for every JavaScript-capable NodeContract; current coverage is **72/72 node contracts**.
- Added portable seeded RNG semantics for `generate.random_table` and `pandas.sample`. Python and JavaScript now use the same locked `portable-v1` 32-bit generator/sampling algorithm, so identical seeds produce identical values and sampled rows across runtimes. Golden fixtures pin representative random values and sample rows to prevent both engines drifting together.
- Compatibility note: seeded random/sample sequences produced by releases before 1.4.38 may differ because the old Python and JavaScript backends used different RNG implementations. From 1.4.38 onward the `portable-v1` sequence is locked by golden fixtures.
- Added parity coverage for `ui.alert` and `ui.input_dialog` using injected interaction values, including number/JSON/table input and true/null alert responses. Fixed JavaScript semantic result handling so an explicit `null` alert response is preserved instead of falling back to printable text.
- Added visual-structure golden workflows for `logic.if_subflow`, `logic.for_each_subflow` and `logic.while_subflow`, plus compatibility coverage for legacy `table.group_mean` and collapsed `workflow.group`.
- Runtime parity now compiles NodeContract during the test and fails automatically if a JavaScript-capable node type has no golden coverage.
- Build script revision: `1.4.38-dev-r14-phase5-complete`.

## 1.4.37 (60) — expanded Phase 5 runtime parity — 2026-08-19

- Expanded Python ↔ JavaScript golden parity from 4 to 49 workflows, covering 63 dual-runtime node types across table transforms, missing values, aggregation, control flow, temporary variables, file input including binary images, conversion, plots, pulse processing, TER analysis and error paths.
- Added JSON-safe semantic values to scalar/object node previews so parity compares real output values instead of runtime-specific human-readable formatting. Synthetic one-cell fallback previews are ignored when no table node executed.
- Plot parity now verifies both runtime-specific artifacts (Python PNG and JavaScript interactive chart) while deliberately not comparing PNG bytes against ECharts objects.
- Batched all Python parity cases into one Python 3.13 process, greatly reducing repeated pandas/matplotlib startup cost as the suite grows.
- Fixed four real Python/JavaScript parity defects discovered by the expanded suite: JSON stringify `indent=0` formatting, missing terminal newline in JavaScript CSV conversion/export, empty `pandas.describe(include=...)` handling, and asymmetric JavaScript oscillating-pulse ramp amplitudes.
- Build script revision: `1.4.37-dev-r13-phase5-parity`.

## 1.4.36 (59) — Phase 4 complete + Phase 5 golden runtime parity — 2026-08-19

- Completed/froze Phase 4 Unified NodeSpec / Node Contract. Every visible NodeSpec now explicitly declares runtime support; NodeSpec also exposes `nodeVersion` for future per-node migration. Runtime Auto, JavaScript unsupported-node diagnostics, workflow import validation and speculative preview safety use NodeContract-derived helpers.
- Workflow validation now rejects unknown/newer node versions, explicit unknown ports and declared incompatible port types while preserving dynamic `custom.python_function` signature handles and dynamic workflow-group ports.
- Fixed build-tool smoke maintenance: the build-script revision assertion now checks that the revision starts with the package version instead of hard-coding one release string.
- Started Phase 5 with `pnpm test:parity` and `tests/runtime-parity/golden/*.json`. The harness runs identical workflows in Python 3.13 and the bundled JS engine, validates fixture expectations, and compares execution order, tables, node results, exports, numeric values/null semantics and error identity.
- Initial parity suite: 4/4 golden workflows covering `io.read_csv`, `table.select_columns`, `table.filter_range`, `pandas.head`, `table.difference`, `pandas.fillna` and `python.len`, including a deliberate invalid-column error path.
- Build script revision: `1.4.36-dev-r12-phase5-parity`.

## 1.4.35 (58) — background completion badge + Phase 4 contract migration — 2026-08-19

- Added a green background-completed badge for non-active tabs. When a workflow finishes successfully on a tab that is not in the foreground, the tab gets a green indicator; opening that tab clears the badge automatically.
- Refined the status-bar task entry visual style by removing the outer pill outline and keeping only the icon, label and task count. The selectable task menu from 1.4.34 remains unchanged.
- Continued Phase 4 Node Contract migration: runtime auto-selection now uses Node Contract runtime support; JavaScript runtime compatibility checks now derive directly from Node Contract helpers; workflow import validation now rejects unknown node types via Node Contract; UI alert preview pre-execution now consults Node Contract side-effect/state metadata and skips unsafe upstream slices.
- Build script revision: `1.4.35-dev-r11-phase4-node-contract`.

## 1.4.34 (57) — selectable host tasks + deeper Phase 4 Node Contract — 2026-08-19

- Confirmed the 1.4.33 host-priority tab-phase fix is shared by Windows Desktop and Android; queued host executions override renderer-local `running`, so both platforms show queued = orange and running = blue.
- Replaced the bottom single-action host stop button with a compact task picker. It lists every active/queued host execution with workflow label, source, phase and short execution ID, and allows stopping/cancelling any selected task rather than only the first one.
- Execution metadata now carries `workspaceLabel` end-to-end across renderer, Desktop IPC/scheduler, Android Capacitor/Chaquopy scheduler and Remote Web, so the task picker can show human-readable workflow names.
- Phase 4 advanced: NodeSpec now owns runtime-support and contract overrides directly. `nodeContract.ts` normalizes NodeSpec into one contract for runtime support, execution model, determinism, side effects, cache policy, state scope/access and future function-role semantics.
- JavaScript runtime support is derived from the unified NodeSpec/NodeContract layer; Agent planning now receives execution/state/side-effect metadata; the inspector shows compact PY/JS/state/side-effect badges.
- Added contract invariants for cache safety and state semantics. The model explicitly reserves temporary/global state plus read/write access and function definition/call roles for future function, temporary-variable and global-variable node families.
- Build script revision: `1.4.34-dev-r10-phase4-node-contract`.

## 1.4.33 (56) — Android queued-state indicator fix — 2026-08-19

- Fixed the remaining Android Phase 3.5 tab-state mismatch: queued host executions now override the renderer-local `running` phase for tab badges, so queued = orange and running = blue exactly when the host scheduler transitions state.
- Added an execution architecture guard requiring tab badges to prefer the real host `queued/running/cancelling` phase over the renderer-local lifecycle.
- Phase 4 Node Contract foundation from 1.4.32 is unchanged; this release is intentionally a narrow real-host acceptance fix while Desktop 1.4.32/1.4.33 testing is still pending.
- Build script revision: `1.4.33-dev-r9-phase4-queue-indicator`.

## 1.4.32 (55) — Phase 3.5 UI polish + Phase 4 node-contract foundation — 2026-08-19

- User real-host acceptance completed for Phase 3.5: Desktop concurrent tabs, Android queueing, and proactive host→web state synchronization all passed.
- Fixed Android tab execution-badge alignment so the status dot lines up with the workflow title text instead of appearing vertically offset.
- Tab execution badges now use explicit semantics: running = blue, queued = orange, cancelling = dimmed blue, failed/timeout = red.
- Removed the topbar **停止其他** action to avoid consuming scarce toolbar width. Per-workspace Run/Stop remains on each tab; cross-client host cancellation moved to the bottom status bar as an auxiliary control.
- Started Phase 4 with `src/nodeContract.ts`, a unified node-contract metadata layer covering runtime support, execution model, determinism, side effects, cache policy and state scope. JavaScript runtime support now derives from this shared contract rather than a disconnected hard-coded list.
- This Phase 4 foundation is designed to support future expansion such as constrained function nodes, temporary/global variable nodes and richer runtime-neutral NodeSpec evolution.
- Build script revision: `1.4.32-dev-r8-phase4`.

﻿## 1.4.31 (54) — Phase 3 complete + Phase 3.5 multi-workspace execution — 2026-08-19

- Fixed Remote Web host-state refresh on Android/Desktop: once paired, the browser polls `/api/execution-status` every 400 ms, so a workflow started on the host changes the web run controls without requiring a click, tab change or other UI interaction.
- Phase 3 Workflow Core is complete/frozen for this architecture line. Per-workspace sessions now retain workflow snapshot/dirty state, independent undo/redo history and selected input files across tab switches; dead session-tab localStorage persistence was removed. Core graph deletion/disconnection semantics also moved out of `App.tsx` into reusable workflow commands.
- Added shared `ExecutionManager` and workspace/client identity. Each workflow execution carries `executionId + workspaceId + clientId + source`; switching tabs no longer destroys the execution lifecycle or successful result of a background workspace.
- Windows Desktop Python now uses `WorkflowExecutionScheduler`: host concurrency is `min(4, available CPU parallelism)` with FIFO queuing beyond capacity. Local tabs and Remote Web clients share the same scheduler and each execution remains independently cancellable.
- Android Python keeps one Chaquopy worker for safety but now accepts multiple workspace/client requests: one runs and the rest queue FIFO. Queue waiting does not consume execution timeout; queued cancellation is immediate; running cancellation retains the slot until the Python callable really exits.
- Current-tab Run/Stop controls only the current workspace. Other host/client executions remain observable through a secondary stop action, and tab headers show active execution state. JavaScript remains renderer-main-thread and is not advertised as truly parallel until it moves to Web Workers.
- Added Desktop scheduler smoke coverage, Android queue/cancel harness coverage, multi-workspace controller/session regression coverage and architecture guards for proactive Remote Web polling.
- Build script revision: `1.4.31-dev-r7-phase35`. Phase 4 `NodeSpec` / unified node contract is the next architecture stage after real-host acceptance of Phase 3.5.

## 1.4.30 (53) — Phase 3 desktop TypeScript build fix — 2026-08-19

- Fixed the Phase 3 host-execution polling regression where `remoteBrowser` was referenced by a React effect before its block-scoped declaration, which caused `TS2448/TS2454` during `desktop:build`.
- Added a Workflow Core architecture smoke assertion which requires the FlowEditor `remoteBrowser` declaration to precede the host-execution polling hook.
- Build script revision is `1.4.30-dev-r6-phase3-ts-fix`. No UI or runtime behavior was redesigned in this hotfix.

## 1.4.29 (52) — Phase 3 Workflow Core + Phase 2 reliability closure — 2026-08-19

- Phase 2 cancellation race fixed: renderer cancellation now stays in `cancelling` until host cleanup completes. Windows keeps the execution slot until the Python child actually emits `close`; Android keeps its slot until the Chaquopy worker callable really exits. A user-visible idle state therefore means the host slot is actually reusable instead of allowing an immediate `EXECUTION_BUSY` rerun.
- Host execution observability added end-to-end. Desktop and Android expose execution status locally and through Remote Web; when a browser starts a remote workflow, the host run control now shows **停止远程** and can cancel that execution instead of continuing to display **运行**.
- Android pure-Python / Notebook cancellation is improved with an execution cancellation token and Python tracing checks. Native C/NumPy calls remain cooperative-only and are still not advertised as hard-killable.
- `ui.alert` no longer reads stale `result` from the previous run. On the first run it computes only the upstream subgraph feeding the `content` port, then opens the dialog with that run's current value/plot/table preview.
- Phase 3 begins the Workflow Core extraction: history/undo-redo, workflow snapshot/persistence signatures, guarded localStorage writes, per-tab dirty session state, graph slicing, structural validation, serialization helpers and migration infrastructure now live under `src/workflow-core/`. `App.tsx` consumes these services rather than owning parallel history/session implementations.
- Android build progress no longer appears frozen at 82%: `android-package.ps1` emits nested 82/84/85/86/87 stages and a 20-second Gradle heartbeat. If Gradle has already printed `BUILD SUCCESSFUL` and the APK exists but the short-lived wrapper lingers, the wrapper is closed after a grace period. The existing GUI Cancel action remains valid during this stage and terminates the build tree plus PyDroid Gradle daemon.
- Build script revision is now `1.4.29-dev-r5-phase3`; the Node >=24.19 gate and MSI-independent CPython NuGet fallback remain part of the dev baseline.
- Added Workflow Core Vitest coverage, architecture smoke guards, Android cancellation-token regression coverage and stronger execution architecture checks.

## 1.4.28 (51) — Phase 2 ExecutionController — 2026-08-19

- `dev` 完成 Phase 2 执行生命周期重构：新增共享 `ExecutionController`，统一 `executionId`、`queued/running/cancelling/cancelled/success/failed/timeout` 状态、单活动执行策略、默认 10 分钟超时和可配置 timeout。
- `App.tsx` 不再自行维护独立运行布尔状态，运行状态订阅共享控制器；原“运行”按钮在执行期间切换为“停止/取消中”，Notebook 与节点工作流共用同一执行状态与取消入口，UI 视觉结构不做重写。
- Windows Desktop 新增 `desktop/execution/PythonProcessController.cjs`：每个 Python 工作流映射到独立 child process，取消/超时会清理 registry 并终止进程；Windows 额外使用 `taskkill /T /F` 清理进程树。Electron preload/IPC 增加 `cancelWorkflow(executionId)`。
- Android 新增 `PythonExecutionController.java`：工作流执行从 SMB/Profile 共用 worker 中剥离，采用独立单线程 execution worker、Future registry 与 timeout scheduler；Capacitor 增加 `cancelWorkflow`。1.4.29 起取消会立即结束调用方等待，但 registry 保留到实际 worker 退出，避免假空闲。
- Remote Web 的 `/api/execute` 现在携带同一个 `executionId/timeoutMs`，Desktop 与 Android 均增加 `/api/cancel`；浏览器取消会同时 abort HTTP 请求并通知宿主取消真实 Python 任务。关闭 Remote Web 服务时会取消该服务仍在跟踪的远程执行。
- Desktop/Android 宿主均拒绝第二个并发工作流，避免多个 UI/远程客户端同时覆盖结果或争用 Python；环境、签名分析等 utility Python 请求与工作流生命周期分离。
- 新增 `src/execution-controller.test.ts`、`scripts/execution-architecture-smoke.mjs` 和真实子进程 `scripts/execution-controller-smoke.mjs`；Desktop 打包清单明确包含 `desktop/execution/**/*`。
- Android 限制：Chaquopy 使用应用内嵌 Python，`Future.cancel(true)` 属于线程级 best-effort 中断；1.4.29 增加纯 Python tracing cancellation，但正在不可中断 native C/NumPy 调用中的 Python 线程仍无法像 Windows 独立子进程一样被安全强杀。后续如要求 Android 绝对强制终止，需要进程隔离架构，而不是继续增强 Future.cancel。

## dev — Architecture & Reliability / Phase 1 PlatformAdapter — 2026-08-18

- UI 进入稳定期，本阶段不做大规模视觉改版，重构目标转向架构边界与可靠性。
- 新增共享 `src/platform/types.ts` PlatformAdapter 契约，将文件选择、SMB、Profile/工作流外部存储、Agent/SMB Secrets、Remote Access 和 runtime stats 从 `src/execution.ts` 中抽离。
- Android/Web 使用 `src/platform/android.ts` / `browser.ts`；Capacitor `PythonExecutor` bridge 类型集中到 `android-plugin.ts`；远程 PIN/Token transport 独立到 `remote-session.ts`。
- Windows renderer 新增 `desktop/renderer/bridge.ts` 和 `platform.ts`，明确区分 Runtime Bridge 与 Platform Bridge；Desktop Vite 同时映射 `./execution` 与 `./platform`。
- `App.tsx` 平台能力改从 `./platform` 导入，Runtime 相关能力继续从 `./execution` 导入；同时把 Android native platform/theme chrome 与 Desktop window controls 纳入 system capability，UI 不再直接访问 Capacitor 或 `window.pyDroidDesktop`。UI 操作与 preload/Capacitor 原生 API 名称保持不变。
- 新增 PlatformAdapter 架构守卫、Browser adapter 与 Remote Session 测试；云端另使用编译后 JS harness 验证 Android/Desktop bridge 委托。
- 详细路线与后续 AI 开发约束见 `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md`。
- 构建可靠性热修：Windows PowerShell 5.1 清理 Electron/Capacitor 深层构建树时，若 `Remove-Item -Recurse` 遇到超过传统 `MAX_PATH` 的后代目录，自动切换 `\\?\` 扩展长度路径 `cmd rd`，仍失败时使用 `robocopy /MIR` 空目录镜像清理；阶段 15 与阶段 40 共用该清理器，不再静默遗留半清理的 `release`。

## dev - Android/Web production TypeScript test isolation

- Fixed `pnpm build` / Android packaging failure caused by Node-only architecture tests being included by the production `tsconfig.json`.
- Production TypeScript now excludes `*.test.*` / `*.spec.*` while keeping `types: ["vite/client"]`; Node globals are not exposed to browser/Android source code.
- Added `tsconfig.test.json` and `pnpm test:types` so tests remain type-checked separately with `@types/node`.
- Extended the PlatformAdapter architecture smoke guard to prevent tests or Node typings from leaking back into the production compile boundary.

## 1.4.27 (50) — LAN automatic discovery — 2026-08-18

- “局域网网页访问”启动后自动同时启动 SSDP/UPnP 与 mDNS/DNS-SD，不新增第二套业务 HTTP 服务，也不增加新的设置 UI。
- Windows 桌面端与 Android 端均发布 UPnP Basic Device；Windows“文件资源管理器 → 网络”可通过 SSDP 发现设备，并由 `presentationURL` 打开现有 `/?remote=1` Web UI。
- 现有 Web 服务增加公开的 `/upnp/device.xml` 与 `/health`；UPnP 描述使用当前可达局域网 IPv4，UUID 持久化，设备重启后身份保持稳定。
- mDNS 发布稳定 `.local` 主机名与 `_http._tcp.local` DNS-SD 服务；Android 主机名附加持久 UUID 短后缀，避免同型号设备发生名称冲突。
- SSDP 支持 `ssdp:all`、`upnp:rootdevice`、设备 UUID 与 `Basic:1` 的 M-SEARCH 响应，启动/每 300 秒发送 alive，停止时发送 byebye；网络接口变化会自动重建发现服务。
- SSDP、mDNS 与 HTTP 相互解耦；任一发现协议启动失败只写日志，不会终止网页访问。现有 PIN/Token 认证继续保护执行、文件和运行时 API，自动发现不会绕过配对。
- Windows 便携版不静默提权修改系统防火墙；若系统首次询问网络访问权限，应仅允许“专用网络”。

## 1.4.24 (47) — Python 3.13 installer URL normalization — 2026-08-18

- 修复 GUI/环境中保存 `PythonVersion=3.13` 时错误拼出 `https://www.python.org/ftp/python/3.13/python-3.13-amd64.exe` 的 404 问题。
- 将“Android Python 兼容系列”与“自动下载安装器补丁版本”分离：兼容要求仍为 Python 3.13.x，自动安装固定使用 python.org 已发布的 Python 3.13.14 x64。
- 下载完整 Python 安装器后校验官方 SHA-256 `C54D9B9BBB8A36E6489363DDD01139707FD781D72F1F9E90C7EC65D0061368E0`；缓存文件不匹配时自动删除并重新下载。
- GUI 将旧的 `3.13` / `3.13.x` 持久化值规范为 `3.13` 系列，避免旧设置再次生成错误 URL。
- `scripts/setup-windows.ps1` 的桌面嵌入式 Python 同步固定为 3.13.14，并更新为 python.org 官方 SHA-256。

## 1.4.23 (46) — Android full Python build host / read-only shared tool root — 2026-08-18

- Split Python responsibilities: the packaged Windows desktop keeps the embeddable Python 3.13 runtime, while Android Chaquopy buildPython now requires a full Python 3.13 installation with `venv` and `ensurepip`.
- Added early validation for `venv`, preventing the build from reaching Gradle with an incompatible embeddable Python runtime.
- Missing full Python 3.13 is installed only under the writable `WorkRoot` temporary tools directory.
- `ToolRoot` / `DK_TOOL_ROOT` is now treated as strictly read-only. Missing Node/JDK/Android SDK/Python components and all caches are written under `WorkRoot` / `CacheRoot` instead.
- If a read-only shared Android SDK is incomplete, the build creates a writable temporary SDK overlay and installs only the missing components there.

## 1.4.22 (45) — Gradle daemon isolation / GUI process cleanup — 2026-08-18

- Android Gradle 使用 `CacheRoot\gradle\<project>` 独立 Gradle User Home，避免旧项目或其它 Gradle 构建留下的 daemon registry 与 JVM 参数发生冲突。
- 临时工作区 `gradle.properties` 明确同步 `org.gradle.java.home` 到 GUI 已确认的 JDK，并把 PyDroid daemon 空闲超时限制为 10 分钟。
- Android 打包增加 daemon 启动失败自动恢复：先停止 PyDroid daemon、清理仅 daemon registry/log 状态后重试；若仍无法启动则自动降级为 `--no-daemon`，不再直接终止整个构建。
- GUI 的“取消”和关闭窗口共用统一清理流程：终止本次 PowerShell/pnpm/Gradle/Java 子进程树，并对 PyDroid 专属 Gradle User Home 执行 `gradlew --stop`。即使构建进程已经结束，关闭 GUI 也会停止残留 daemon。
- 不使用全局 `taskkill java.exe`，避免误杀其它 Java 应用。

## 1.4.20 (43) — Gradle daemon consistency / Android build reliability — 2026-08-18

- 修复构建日志显示“Gradle daemon 已启用”，但 `scripts/android-package.ps1` 实际仍硬编码 `--no-daemon` 的逻辑矛盾。默认 Android 构建现在显式使用 `--daemon`，确保连续构建真正复用 Gradle JVM。
- `-DisableGradleDaemon` 现在是唯一的 daemon 禁用入口；构建前会对临时工作区的 `assembleDebug` 命令进行硬校验，禁止“界面状态与实际命令不一致”再次出现。
- Gradle 的 `GRADLE_OPTS` 与临时工作区 `org.gradle.jvmargs` 保持一致：正常 daemon 模式下代理/内存参数传入构建 JVM；禁用 daemon 时避免因为 JVM 参数不匹配而再次派生 single-use daemon。
- 保留 `--no-watch-fs`，继续规避 Android 构建目录 junction 与 Chaquopy pip staging 的文件句柄冲突。
- 本地工作分支为 `local/gradle-daemon-fix-1.4.20`；`main` 保持原样未修改。

## 1.4.21

- 修复 Android Python 3.13 探测：不再仅因 `PYDROID_PYTHON_EXECUTABLE` 路径存在就接受错误的 Python 3.12。
- Android 优先复用共享 `Python\runtime-3.13`，并在 Electron 打包前执行 Python 3.13 预检。
- `android-package.ps1` 增加第二层 Python 3.13 硬校验，在 Gradle 启动前拒绝错误解释器。
- 构建 GUI 在子进程退出后不再于 UI 线程调用阻塞式 `WaitForExit()`；失败/成功对话框绑定主窗口并显示最后日志摘要。

## 1.4.19 (42) — Python 3.13 / settings layout refinement — 2026-08-18

- 项目 Python 基线由 3.12 升级到 3.13：Android Chaquopy 使用 Python 3.13，并固定 Android 可用的 NumPy 1.26.2、pandas 2.1.3、Matplotlib 3.8.4；Android 仍不声明 SciPy，因为 Chaquopy Android wheel 仓库目前没有 CPython 3.13 的 SciPy wheel。
- Windows/桌面便携 Python 改为 3.13 系列，开发依赖同步到 pandas 2.2.3、Matplotlib 3.10.8、SciPy 1.17.0；所有启动器、Notebook 元数据、测试、CI 配置和构建脚本统一使用 Python 3.13。
- 设置页标题栏精简为单行“设置 | v1.4.19”，删除“界面、运行时与平台配置”副标题，不再为版本号额外占用纵向空间。
- SMB 认证行重新对齐：访客复选框从“域”列左缘开始，字号/间距增大；登录按钮与密码输入框同为 32 px 高，并填充认证单元的剩余宽度。
- AI Agent 设置将“审计”移动到右侧权限区下方的空白区域；窄窗口仍自动恢复单列，避免错位和溢出。
- 本地工作分支为 `local/python313-ui-1.4.19`；`main` 保持原样未修改。

## 1.4.17 (40) — Agent contract / DeepSeek / UI / JDK reliability — 2026-08-18

- SMB 登录区重新对齐：访客复选框与登录按钮保持 32 px 输入行高度，并在同一认证单元内紧凑排列，避免宽屏下被拉到两端。
- AI Agent 设置页移除等高卡片造成的空白，权限区改为紧凑两列；窄桌面自动切单列；对设置内容滚动条使用主题化细滚动条，避免系统滚动条破坏暗/亮色一致性。
- DeepSeek 预设明确使用官方 `/chat/completions`；Agent 优先 Tool Calls / Function Calling，若工具调用缺失则使用 `response_format: {"type":"json_object"}` 的 JSON Output 兜底。新增官方 Anthropic 兼容预设 `https://api.deepseek.com/anthropic/v1/messages`；DeepSeek 预设不再允许误选 OpenAI Responses 协议。
- Agent 节点契约升级为本地硬校验：规划上下文提供节点角色、运行时支持、参数键、输入/输出类型和 required 标记；所有新增节点的必需输入都必须存在真实 `connect`，动态 `custom.python_function` 按函数签名解析端口；当前运行时为 JavaScript 时拒绝仅 Python 支持的节点。手工粘贴计划也经过同一校验。
- 新增跨 Python/JavaScript 后端原生数据源：`generate.random_table`（无输入随机数表）、`generate.empty_table`（空 DataFrame）和 `generate.empty_list`（空列表）。因此“创建随机数并打印”应直接生成 `generate.random_table → python.print`，不再用伪造空表或临时 Python 函数充当随机数源。
- JDK 手动路径再次加固：若用户选择的目录本身含 `bin\java.exe` 和 `bin\javac.exe`，直接接受该 JDK；可解析到主版本时仍阻止错误版本，厂商版本文本无法解析时不再误报“未找到”。容器目录最多向下三层扫描，同时 `where java` 与 `where javac` 都参与兜底；手动路径永不自动下载另一套 JDK。
- 正式源码交付恢复“干净工程”策略：ZIP 保留完整源码与 `.git`，但不包含 `node_modules`、Gradle/Android/Vite/Desktop 构建缓存和输出产物，依赖由构建工具/本机缓存按锁文件恢复。
- 本地工作分支为 `local/ui-agent-runtime-1.4.17`；`main` 保持原样未修改。

## 1.4.16 (39) — Manual JDK path / no-surprise download — 2026-08-18

- Build GUI 的“路径”区域新增 **JDK 目录**输入框和浏览按钮；本机存在 `D:\Code\Language\Java` 时默认填入该路径，也会保存用户选择供下次构建复用。
- 手动 JDK 路径具有最高优先级，并通过 `-JavaHome` 明确传给核心构建脚本。既可填写真正的 `JAVA_HOME`，也可直接填写包含多个 `jdk-*` 子目录的 Java 根目录，例如 `D:\Code\Language\Java`。
- JDK 路径解析最多向下扫描两层，要求同时存在 `bin\java.exe`、`bin\javac.exe` 且实际主版本等于 GUI 中的 JDK 主版本（默认 21）。
- **只要用户填写了 JDK 目录，就禁止 JDK 自动下载**：指定路径中没有找到有效 JDK 21 时直接给出明确错误，避免再次出现“明明安装了 Java，却转而下载另一套 JDK”的行为。
- 本地工作分支为 `local/manual-jdk-1.4.16`；`main` 保持原样未修改。

## 1.4.15 (38) — Windows JDK 21 discovery fix — 2026-08-18

- 修复已安装 Microsoft OpenJDK 21 仍被误判为“未找到 JDK 21”的问题。`JAVA_HOME` 不再是唯一可靠入口；构建器会主动扫描 Microsoft/Temurin/Java/Corretto/Zulu 常见安装目录、JavaSoft 注册表、Windows 卸载元数据，以及 PATH 中全部 `java.exe`/`javac.exe`。
- JDK 候选会统一规范化，支持直接传入 JDK 根目录、`bin` 目录或 `java.exe`/`javac.exe` 路径；同时要求 `java.exe` 与 `javac.exe` 都存在，避免误把 JRE 当作 Android 构建 JDK。
- Android 构建开始时明确打印实际采用的 `JDK 21：<路径>`；只有所有已安装候选都校验失败后才会下载 Microsoft OpenJDK 到共享工具目录。
- 本地工作分支为 `local/jdk-detection-1.4.15`；`main` 保持原样未修改。

## 1.4.14 (37) — Build GUI stage visibility / quiet workspace sync — 2026-08-18

- 构建 GUI 新增“当前步骤”与阶段进度条，直接显示读取配置、检查工具链、清理临时缓存、同步源码、检查 JS 依赖、Windows Desktop、Android Gradle/APK、复制产物与最终清理等阶段。
- 核心构建脚本通过机器可读阶段事件驱动 GUI；真正发生联网下载时，界面会明确显示“正在下载：文件名（重试次数）”，不再让“安装依赖/准备工具”与下载状态混在一起。
- 同步源码前先静默删除临时工作区中的旧 Android/Gradle/打包产物；`robocopy` 原始枚举输出被抑制，避免历史构建目录产生数千行 `*EXTRA File` / `*EXTRA Dir` 刷屏。
- JS 依赖阶段明确标注“本地缓存优先，缺失时才联网”；构建日志仍保留简洁的 `[阶段 xx%]` 记录，错误日志与取消行为保持不变。
- 本地工作分支为 `local/build-gui-1.4.14`；`main` 保持原样未修改。

## 1.4.13 (36) — Android-first UI / interaction consolidation — 2026-08-18

- Android 节点/选择/流程/资源菜单改为捕获阶段关闭，并在开始拖拽节点、点击空白画布时主动清理，避免菜单停留在旧坐标。
- 节点“本节点结果”中的交互式图表统一进入 PlotLightbox；ECharts 固定白色绘图区，并在窗口 resize / Android orientationchange 后进行双帧与延迟重排，减少旋转后图表裁切。
- `plot.line` 默认列恢复为 `X=0`、`Y=1`。
- SMB 连接区按真实文件管理器方式重排：常规宽度为“服务器/共享名/域 + 用户名/密码/访客+登录”两行三列；手机窄屏为智能两列换行，设备树在移动端使用多行网格；访客为普通复选框，不再伪装成按钮。
- 设置页直接显示真实 `APP_VERSION`，滑块统一暗/亮主题与粗指针触控尺寸；AI Agent 卡片改为响应式双列/单列，不再依赖固定高度制造空白。
- “语言”从 AI 规划专用选项提升为核心界面语言：主工具栏、资源/参数/结果关键控件、设置、SMB 与 Agent 的主要交互同步切换，同时继续作为 Agent 响应语言。
- 保持 `src/main.tsx` 为干净 React 启动路径，不重新启用 `ui-runtime.ts`、`settings-version.ts`、`catalog-overrides.ts` 等全局 DOM/运行时补丁。

## Build GUI RC10 PowerShell automatic-variable fix — 2026-08-17

- Fixed Android-stage crash on Windows PowerShell caused by using `Home` as a function parameter; PowerShell variable names are case-insensitive, so it collided with the read-only automatic `$HOME` variable.
- Renamed Java helper parameters to `JavaHomePath` and added a build-tool regression test that rejects future `$HOME` parameter/assignment collisions.
- Desktop packaging behavior and the RC9 shared-toolchain/cache/proxy baseline are otherwise unchanged.

## Build GUI RC9 unified shared toolchain — 2026-08-17

- 将另一项目使用的 Shared Toolchain 与 RC5-RC8 修复统一：`DK_TOOL_ROOT` / `DK_CACHE_ROOT` 作为跨项目共享工具与缓存基线，Node/JDK/Android SDK/Python 可复用，pnpm/npm/Corepack/Electron/electron-builder/Gradle 共享下载缓存。
- 保留 CMD 唯一用户入口、GUI 日志、代理网络层、`pnpm.exe` native launcher 兼容与临时工作区修补；Direct 模式进一步清除 npm/pnpm/ALL_PROXY 环境代理。
- 修复共享工具链的潜在 Android 首装问题：JDK 现在校验主版本，并在运行 `sdkmanager` 前先设置 `JAVA_HOME`/PATH；Python 静默安装的 `TargetDir` 同时支持带空格路径。
- 构建日志新增项目 `packageManager`、Electron/electron-builder 声明与 lockfile 版本以及实际 Node/pnpm 版本，便于区分“项目版本约束”和“共享缓存”。
- 当前 PyDroid `package.json` 为 Electron `^43.4.0` / electron-builder `^26.15.3`，`pnpm-lock.yaml` 实际锁定 43.4.0 / 26.15.3；共享工具链不强制其它项目使用相同 Electron。

## Build GUI RC8 local compile fix — 2026-08-17

- 修复 Windows 上 pnpm 11 `@pnpm/exe` 场景：`npm_execpath` 可能直接指向 `pnpm.exe`，桌面打包脚本不再错误地把该 EXE 作为 JavaScript 交给 `node.exe` 加载，而是按 `.exe` / `.cmd` / `.js|.cjs|.mjs` 类型选择正确启动方式。
- 新增无依赖 `test:build-tools` 回归测试，覆盖 native `pnpm.exe`、Corepack/JS launcher、Windows `.cmd` 与默认 fallback，防止同类启动回归。
- 修复 SMB 文件管理器连接设置使用 React typings 不支持的 `defaultOpen` 属性导致 `desktop:build` TypeScript 失败；改为 DOM ref + effect，仅在尚未选择共享时自动展开，同时保留用户原生折叠/展开行为。
- RC7 本地日志确认手动代理已生效，`pnpm install --prefer-offline` 54 ms 完成；本轮失败属于桌面打包调用与 TypeScript 源码错误，不再归因于网络。

## Build GUI RC7 network fix — 2026-08-17

- 修复 RC6 没有显式把 Windows/环境代理传给 pnpm 与 Electron 下载链的问题：默认 `Auto` 模式会读取 `HTTPS_PROXY`/`HTTP_PROXY`，否则读取 Windows 当前用户固定系统代理，并把同一代理传给 pnpm、`@electron/get` 和脚本下载。
- GUI 新增“网络模式 / 代理地址 / npm Registry / 请求超时 / pnpm 网络并发”设置；支持 Auto / Direct / Manual，手动代理示例为 `http://127.0.0.1:7890`。
- pnpm 安装默认启用持久 store + `--prefer-offline`，单次网络请求超时提高为 600 s，网络并发限制为 16，并在整次 `pnpm install` 失败后复用已经写入 store 的内容自动重试。
- 自动模式会先检查本地代理端口是否存活；检测到 PAC 但没有固定代理时给出明确提示，避免长时间等待后才以 `TimeoutError` 结束。
- 构建日志现在明确记录网络模式、代理、registry、timeout 和 concurrency；最终失败信息也会附带实际生效的网络参数。

## Build GUI RC6 hotfix — 2026-08-17

- 修复 WinForms `RowStyles/ColumnStyles/Controls.Add()` 返回索引未被丢弃，导致 CMD 窗口打印 `0 1 2 3 4` 等无意义数字的问题。
- GUI 启动器现在将内部 PowerShell 输出写入 `%LOCALAPPDATA%\PyDroidBuild\logs\launcher-last.log`，正常启动时 CMD 不再显示实现细节。
- 构建日志改为同时实时显示并持久保存到 `<输出目录>\logs\build-YYYYMMDD-HHMMSS.log`，成功/失败均弹出明确结果与日志位置。
- 构建子进程输出读取改为 `ReadLineAsync()` + WinForms 定时器轮询，避免后台事件回调在不同 PowerShell/.NET 运行时上的 runspace 兼容问题。
- GUI 正常关闭显式返回退出码 0；真正的 GUI 启动/运行崩溃由顶层 trap 写入诊断日志并返回非零退出码。

## 1.4.9 RC2 — settings / SMB file manager

- 设置窗口改为自适应双列卡片布局：宽屏优先利用横向空间，画布参数以响应式双列呈现，窄屏自动回落为单列；滚动条改为与亮/暗主题一致的细型内嵌滚动条。
- SMB 文件选择器由“设备/登录/共享/文件”纵向向导重写为文件管理器结构：左侧网络设备与共享树、顶部地址/面包屑、可折叠连接设置、主文件列表和统一底部导入操作。
- SMB 文件列表按名称/类型/大小显示，文件夹与文件使用统一 SVG 图标；移动端将网络树压缩为横向设备区并保持文件列表为主要可滚动区域。
- 新增 `AGENTS.md` 与 `docs/development-handoff.md`，用于新会话快速恢复 Git/架构/验证状态；继续坚持单一项目目录、单一共享 UI，不再维护 Python/JS 两套应用。
- Android 候选版本更新为 `1.4.9 (32)`；本提交由 AI 完成源码与静态检查，完整 pnpm/Android/Windows 编译仍交由本地环境验证。

## Runtime architecture refactor (unreleased)

- Introduce a shared `RuntimeAdapter`/registry while preserving the 149p UI and Python execution behavior. Auto mode uses the JavaScript engine only when the full workflow is compatible and otherwise falls back to Python; explicit JavaScript mode reports unsupported nodes.
- Recover the useful pure TypeScript data-flow engine from the former JS experiment branch into `src/runtime/javascript/engine/` instead of maintaining a second application/UI branch.
- Add shared runtime result types and a unified plot presentation layer: Python PNG plots and JavaScript interactive ECharts plots now use the same UI path.
- Add runtime preference settings (`Auto / Python / JavaScript`) and runtime-aware run status messages on Android, Web and Windows renderer builds.
- Add runtime compatibility/registry tests and `docs/runtime-architecture.md`; the remaining platform-host extraction and workflow-core split are explicitly staged as later refactors.

## 1.4.9o

### 1.4.9p mobile gesture/tab hotfix
- Android canvas now owns a two-pointer pinch state, restoring midpoint-anchored pinch zoom while preserving one-finger pan and long-press marquee selection.
- Mobile tab close affordance uses a centered SVG in the tab upper-right corner, auto-dismisses, dismisses on outside tap/scroll, and long-press opens the custom tab menu deterministically.

- 顶部“新建”改为二级选择：可在当前标签页清空新建，或直接新建标签页；当前标签页存在未保存修改时提供“保存 / 不保存 / 取消”。
- 标签页关闭增加未保存检查：保存后未再修改的标签页直接关闭，存在修改时才询问是否保存。
- 工作流标签页在当前应用会话中保留各自画布快照与保存基线，切换标签不会丢失当前内容。

## 1.4.9n


- 修复 Android 长按空白画布框选时 React Flow 已启动的单指平移仍继续生效、导致节点在框选过程中被“推走”的问题：触摸空白画布改由统一手势状态机接管，10 px 前置移动阈值判定平移，520 ms 稳定长按切换为框选；框选后禁止再进入平移，并通过手动 viewport 平移保留快速单指移动画布。
- 修复首次 Android TypeScript 构建中 `restoredSnapshot` 被常量收窄为 `null` 后可选链属性访问产生的 `never` 类型错误；启动节点、连线与 requirements 直接使用干净初值。

## 1.4.9m

- 启动时固定为单个空白“工作流 1”；修复窄数据表按钮溢出；底部参数区的概览、高级参数和组织字段改为响应式布局；移动端支持长按空白画布后拖动框选节点，并与快速单指平移使用独立阈值。

# 版本记录

每次用户可见的功能更新、缺陷修复或 APK 版本号变更，都必须在此文件、`README.md` 和
`docs/progress.md` 同步记录；Android 的 `versionName` 与 `versionCode` 必须与记录一致。

## dev（未发布，1.4.9 候选）

- UI 细节继续收敛：参数面板标题与资源栏统一，并在标题下优先显示节点名称；资源栏最小宽度提高到可完整显示“节点/组合/流程”；节点结果表格的换行/紧凑按钮改为紧凑图标宽度、复制/全屏保留完整文字；移动端标签激活线抬高至与顶部按钮底端对齐，桌面端激活线进一步细化。
- 桌面端 SMB 重写：设备发现优先使用 Windows `net view` 获取真实主机名并枚举共享，445 端口扫描补充、`nbtstat` 解析兜底；文件操作改用 Windows 原生 SMB（`net use` 凭据会话 + `Get-ChildItem` 列目录 + `[IO.File]` 读文件），彻底移除兼容性差的 node-smb2；凭据经子进程环境变量传递、错误信息统一 UTF-8 中文输出并按退出码映射清晰提示（网络名/凭据/权限等）、退出时清理会话、导入总量 128 MiB 限制；设备卡以主机名为主要显示，共享与 IP 作为辅助信息。
- 安卓端 SMB 设备发现改用 NetBIOS 节点状态查询（UDP 137，jcifs-ng）获取真实主机名，替代局域网基本失效的反向 DNS。
- 双击组合节点直接进入内部子流程画布（原先打开节点菜单）。
- 框选/多选期间保留连线与删除叉号之外的连线可见性，修复"点击组合后连线消失"的困惑；进入多选仍会提示操作方式。
- AI Agent 权限拆分为 8 项：新增 `groupNodes`（组合节点）独立于 `createNodes`，另有 `disconnectNodes`、`arrangeLayout` 等；权限面板按"节点 / 连线与布局 / 执行"分组对齐；旧存档无新权限键时沿用原值，避免权限静默放大。DeepSeek 预设升级为 Responses 接口（`https://api.deepseek.com/responses`）并使用 V4 模型（`deepseek-v4-flash` / `deepseek-v4-pro`，旧名 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用），已保存的旧配置自动迁移。
- 资源拖拽恢复为自定义预览卡片（悬浮光标上方），移除实色快照方案。
- AI Agent：DeepSeek 预设（thinking 模式不接受强制指定 function 的 `tool_choice`，报 400）在 Responses 与 OpenAI 兼容 Chat 两种协议下均改用 `tool_choice: "required"`；权限面板恢复简洁单列复选框并对齐。
- 移动端 UI 修复：SMB 对话框登录区改为紧凑两列排布（服务器、域/用户名、密码与按钮同行），共享列表与文件列表压缩间距；子流程画布"返回主流程"面包屑提高不透明度、强制单行并在超宽时横向滑动；组合输入/输出面板改为标签对齐的网格排布；移动端轻点组合资源卡不再直接加入画布，改为弹出"添加到画布"操作菜单（长按拖入画布不受影响）。
- SMB 对话框整体可上下滑动（移动端自然流布局、桌面端保留列表内滚动并整体兜底滚动），任何高度下内容不再被裁剪；组合资源卡说明提示仅在鼠标悬停设备（`hover: hover` 且 `pointer: fine`）显示，触摸模式点击不再出现提示；"返回主流程"面包屑增加与顶部工具栏一致的背景模糊，亮色模式下激活项改为深紫文字/浅紫背景，不再看不清。
- 组合资源卡触摸行为与节点卡片完全一致：轻点无操作，长按拖入画布才添加（移除触摸点击弹出菜单）；桌面 SMB 错误改为按 Win32 错误码（HResult 低 16 位）映射中文提示（如 67 = 网络名或共享名不存在），不再透传英文系统消息。
- 桌面 SMB 共享枚举改用 `NetShareEnum`（netapi32，走已建立的 IPC$ 凭据会话），替代依赖 SMB1/浏览器服务的 `Get-ChildItem \\server` 根枚举（现代 Windows/设备上普遍返回"找不到路径"），并过滤 `$` 结尾的隐藏共享。
- 桌面打包目标由 portable 单文件改为免安装目录版（`win-unpacked/PyDroid Flow.exe`，整个目录拷贝即用）；Windows 图标改用 512×512 的 `desktop/icon.png`（原 Android 192px 图标不满足 electron-builder ≥256px 要求）；`release/` 输出经 junction 指向 `D:/PyDroidTemp/PyDroid/generated/release`。
- 安卓端 SMB 错误按 jcifs-ng 异常关键词映射中文提示（网络名/共享名不存在、拒绝访问、凭据错误、连接超时等），不再透传英文；桌面端 SMB 对话框改 flex 列布局，文件列表吸收剩余高度、底部操作栏固定在底部，不再与"进入所选共享"区域重叠；组合资源卡移除原生 title 提示，悬停只显示自定义说明（与节点卡片一致的单一提示）。
- 安卓端共享列表枚举失败不再误报"共享名不存在"：枚举类错误提示"服务器可能禁止共享枚举，可手动输入共享名重试"；画布"返回主流程"面包屑去掉 transform 居中（Chromium 中 transform 会使 backdrop-filter 采样失效导致透明），改为 margin 居中，与顶部工具栏的模糊效果一致。
- 安卓端 SMB 协议范围放宽为 SMB1–SMB3.1.1（此前强制 SMB2.02 起，只支持 SMB1 的老 NAS/设备无法连接，Windows 桌面客户端却可访问）；SMB 错误提示附带 NT_STATUS 十六进制状态码便于定位；面包屑背景与模糊改由 `::before` 伪元素承载（`isolation: isolate`），避免主元素布局属性干扰 backdrop-filter 采样，安卓端与工具栏毛玻璃一致。
- 修复安卓端 SMB 中文/特殊字符共享名连接失败（0xC00000CC）：jcifs-ng 的 URL 解析不做百分号解码，此前 `Uri.encode` 编码后的共享名/路径被按字面量发送；改为原样拼接共享名与路径段；面包屑改回主元素承载背景与模糊并加 `transform: translateZ(0)` 强制合成层，规避 Android WebView 的 backdrop-filter 失效。
- SMB 界面紧凑化：登录/共享列表/共享名区域控件多列排列（移动端服务器|访客登录、域|用户名、密码|读取共享列表按钮两两同行，共享列表自动多列），文件列表最小高度 140→180px 且吸收剩余空间；移动端对话框改用 `100dvh` 视口高度并加底部安全区 padding，列表较长时底部不再被系统栏遮挡。面包屑背景提升至 96% 不透明度兜底（桌面保留 backdrop-filter 模糊，安卓 WebView 该元素渲染 bug 下也不再透明）。
- SMB 登录区进一步重排：访客登录移入小节标题行，共享名与服务器同行，"读取共享列表"与"进入所选共享"按钮合并为一行（移动端隐藏"域"字段），移动端登录区压缩到约 3 行；面包屑彻底移除 backdrop-filter（Android WebView 上该声明导致整个元素背景被丢弃），改用 100% 不透明背景，任何设备都不再透明。
- SMB 再调整：移动端"读取共享列表/进入所选共享"两按钮竖排于密码右侧（与"域"字段同列下），域字段恢复显示；文件/文件夹列表改为四列卡片网格（图标/复选框、名称、大小上下排列，选中高亮）；面包屑恢复 backdrop-filter 毛玻璃并把 `overflow-y` 显式设为 `hidden`（此前为计算值 `auto`，双轴滚动容器使 Android WebView 的 backdrop-filter 采样失效——与左上方工具栏失效原因一致，现与其完全对齐）。
- SMB：`net use` 显式引号包裹 UNC 以支持含空格/中文的共享名；共享枚举改用 `Get-ChildItem`（Unicode 输出，中文共享名不乱码）；新增凭据建立 IPC$ 会话后枚举服务器全部共享，界面改为"登录 → 列出共享 → 点共享进入"的资源管理器式流程。
- 修复组合子流程输入输出面板与画布顶部工具栏重叠；底部"返回主流程"面包屑改为水平居中，不再与左下角缩放按钮重叠。

## 1.4.8 (31) — 2026-08-13

- 组合接口改为根据跨边界连线与内部未占用端口共同推导；没有外部连线的新组合也会公开可连接的输入、输出，并自动修复旧的 0 输入/0 输出组合资源。
- 修复框选状态与“完成组合”计数不同步导致组合失败；框选时隐藏连线和删除叉号，仅保留节点勾选状态。
- 节点、我的节点和组合资源增加桌面右键菜单；组合资源卡直接显示组合名称，说明改为悬停提示且按下时隐藏。
- 桌面节点、组合与流程拖拽预览改为分类图标、浮层卡片、落点状态和独立配色，组合落入动画同步增强。

## 1.4.7 (30) — 2026-08-13

- SMB 文件选择器重排为设备、登录/共享和文件三段式多行界面；设备卡优先显示发现的共享名称和 IP，主机名作为辅助信息。
- “扫描设备”只负责发现开放 SMB 服务的设备，“读取共享列表”使用当前访客或账号凭据枚举共享；设置页移除三个容易混淆的按钮，统一为“选择 SMB 文件”。
- SMB 增加访客登录、密码眼睛显隐按钮；Windows IPC 与前端统一提取结构化错误，避免显示 `[object Object]`。
- Windows 和 Android 设备发现会尝试匿名枚举公开共享；认证后读取到的共享会回填到对应设备卡。
- 桌面鼠标可抓取连线端点并拖到空白处断开，或拖到兼容端口改接；断开按钮重新校准居中和颜色。
- 默认资源栏由 190px 收窄为 176px，并减淡固定区分隔线、搜索框边框和背景。

## 1.4.6 (29) — 2026-08-13

- 逻辑结构标题改为独立不透明层，内部节点下移且容器按成员数自动增高；补齐亮色分支标签、调整边框和组合紫色识别样式。
- 节点结果表格针对窄参数栏重新分组操作按钮与分页控件，避免按钮参差和溢出。
- 连线透明命中区域扩大至 38px；选中连线会在中部显示明确断开按钮，并保留双击、右键后 Delete/Backspace 三种断开方式。
- Android 与桌面统一资源拖拽预览；节点、组合和完整流程均支持鼠标/触摸拖入画布及落入动画。
- SMB 文件浏览器扩展到 Android 与 Windows：扫描本地子网的 445 端口发现设备，认证后扫描共享、逐级浏览目录并多选常见数据文件；Android 使用 jcifs-ng，Windows 使用 MIT 许可的 node-smb2。
- SMB 密码在 Android Keystore 或 Windows safeStorage 中加密保存；服务器、共享、域和用户名继续随设置持久化。

## 1.4.5 (28) — 2026-08-13

- 参数结果面板的右侧/底部改为实时预览同排图标；移除冗余宽度滑杆，底部结果与滚动参数栏使用固定边缘手柄，并修正窄栏数据表工具条溢出。
- Notebook 可无损导出 If、For-each 与 While 子流程；导出变量统一使用安全前缀，避免覆盖 `range` 等 Python 名称并触发 `DataFrame object is not callable`。
- 桌面 Python 桥强制 UTF-8；打印节点增加字节编码、错误策略和解码/十六进制/Base64/原始表示，历史乱码节点标签可由目录自动恢复。
- 画布方向切换会重排逻辑容器内部节点；节点图像居中；连线扩大交互区域，支持双击断开、右键选中后 Delete/Backspace 删除，并修复错误节点跨容器定位。
- AI Agent 增加断线、真正的多节点组合和横纵整理操作，发送父结构、分支和类型化端口上下文，继续禁止用代码块替代节点能力。
- 统一工具栏图标和文字基线、亮色滚动条与运行时依赖标签，并改用更醒目的圆形桌面应用图标。

## 1.4.4 (27) — 2026-08-13

- 桌面 Python IPC 使用带版本标记的 Base64 请求帧，避免工作流参数中的引号、换行或历史字面量破坏 JSON；保留旧版原始 JSON 兼容入口。
- Android 内置 SMB 连接信息可在设置中持久化，密码由 Keystore 加密保存，并支持扫描服务器共享后直接选择。
- 触屏与鼠标指针分流：触屏只平移/缩放画布，鼠标才启用框选；设置增加端点尺寸并统一节点尺寸、工具栏图标和间距。
- 弹窗提示增加任意类型内容输入；输入弹窗支持文本、多行、数值、布尔、选择、日期、时间、JSON、表格、文件和图片预览。
- 调试模式增加断点、运行到节点、首次单步、下一节点、耗时与结果快照；执行失败保留旧结果和已完成节点结果，并持续标红具体失败节点。
- 增加散点图、柱状图、直方图、箱线图和面积图节点及等价 Notebook 导出；通用表格节点改用准确的 `pydroid_flow.read_table_auto` 标识。
- 结果卡片移入节点内部避免遮挡连线；错误弹窗、复制反馈、弱文字和相关亮色主题完成修正。
- `logic-control-demo.workflow.json` 已通过 Python 核心执行，并加入工作流→Notebook→工作流结构往返回归。

## 1.4.3 (26) — 2026-08-13

- 桌面 Python 桥的所有异常统一返回结构化 JSON，修复 `workflow (unknown)` 与 JSON 解析错误直接击穿 Electron IPC 的问题。
- 错误响应保留已完成节点结果、执行顺序、单节点耗时、部分表格和 Python 堆栈；失败节点持续红框，完整错误可展开、复制和定位。
- Windows 桌面端内置带可选四位 PIN 的局域网网页服务，可由其他设备打开同一 UI 并在桌面 Python 内核执行。
- Notebook 编辑器增加源码行号；AST 转换可生成 If、For、While 可视结构，并把识别出的分支/循环节点放入容器。
- 表格预览和全屏表格升级为统一工具栏、筛选、排序、分页、首末页、行高、换行和 TSV 复制。
- 增加调试模式、通用表格/文本/JSON/图片读取节点，以及列表/对象/Series/数组转 DataFrame 节点。
- print 增加格式、类型信息、表格行数、字符上限和结尾参数；桌面文件选择保留原始字节，修复非 UTF-8 文本乱码。
- 补齐逻辑容器、结果控件、Notebook、调试面板和数据表格的亮色主题；统一端口类型字号并加深输出颜色。

## 1.4.2 (25) — 2026-08-13

- 修复打印节点将内容写入桌面桥接 stdout、污染 JSON 响应并触发 `Unexpected token 's'` 的根因；打印内容只进入结构化节点结果。
- 底部错误消息改为可点击入口，可查看、复制完整错误并定位节点；失败节点保持红色边框直到下次运行。
- 表格预览升级为带筛选、排序、分页、行号、悬停、复制和展开功能的数据网格；主结果最多传输前 500 行，节点结果最多 200 行。
- 连线改为从输出端类型色到输入端类型色的 SVG 渐变，端口同步按类型着色。
- 补齐亮色模式的函数签名卡、结果控件、数据网格和状态栏图标；降低画布选中按钮底色强度。
- Notebook 增加“运行全部”和逐单元“运行到此”按钮，显示执行计数、表格/文本/图形输出，并定位出错单元格。
- AST 分析新增常见标量转换、DataFrame/Series、NumPy 数组、JSON、记录列表和 CSV 文本转换识别；不再把未映射赋值误报为已识别节点。
- 新增 `pnpm android:live:lan` 局域网前端热更新入口，并在设置中显示热更新状态和适用范围。

## 1.4.1 (24) — 2026-08-13

- 空白流程进入 Notebook 时不再生成或恢复任何旧单元格；新建流程继续同步清除单元格、metadata 与错误。
- 工作流和节点中的历史 Python 字面量参数支持安全兼容解析；JSON 格式错误改为节点内可读错误，不再令桌面 IPC 直接失败。
- 逻辑控制结构补齐亮色主题的标题、分区、边框与 True/False/循环体颜色。
- 本节点结果支持双击打开可编辑副本并一键复制，表格结果以结构化 JSON 展开。
- 整理完成后自动将当前层级节点适配回可见画布，避免布局原点变化令节点跑出当前视区。
- 打印输出支持 DataFrame、Series、ndarray、列表、元组、集合、字典、bytes、图表和标量；纯标量流程也可成功返回结果。
- 连线按照 table、plot、CSV、number、text、boolean、list、object 和 any 类型分别着色。
- 新增转文本、转数字、转布尔、转表格、表格转记录、表格转 CSV、解析 JSON、生成 JSON 八个可复用转换节点及等价 Jupyter 导出。

## 1.4.0 (23) — 2026-08-13

- 历史记录图标移至底部状态栏最右侧。
- Android CSV 入口精简为“选择文件（可多选）”“选择文件夹”和“内置 SMB”；移除能力不确定且重复的第三方文件/文件夹入口。
- 新增内置 SMB 2/3 浏览器，可连接服务器共享、进入子目录、勾选多个 CSV 或导入当前文件夹全部 CSV；凭据只驻留当前弹窗内存。
- 修复 Notebook 文本框在滚动时因 ref 回调反复收缩/扩张而回弹到顶部；改为基于内容稳定计算行数。
- 新建流程会同步清空 Notebook 单元格、元数据与错误状态，不再保留上个流程代码。
- 亮色模式的“收起”操作改为更深蓝色；包管理的标题、包名、版本、说明、依赖输入及控制台补齐一致字号和前景色。
- 新增“生成周期震荡脉冲”默认节点及等价 Python/Jupyter 导出；`周期震荡脉冲.ipynb` 可转换为该节点和打印节点，不再生成代码块。
- 新增 `logic-control-demo.workflow.json`，串联 For 数值范围、If 结构、分支合流、While 子流程、For 子流程和打印节点，并由 Python 测试真实执行。

## 1.3.9 (22) — 2026-08-13

- 参数栏与设置抽屉统一为一致的正文、控件和辅助字号，修复同一区域文字大小跳变。
- 底部状态栏新增纯图标历史入口；历史面板支持查看最近 50 个画布状态、恢复指定状态、撤销、重做和清空，恢复后仍可重做回到恢复前。
- 支持从系统文件管理器直接拖入一个或多个 CSV、工作流 JSON 和 Jupyter `.ipynb`；CSV 载入与按钮选择共用同一读取逻辑。
- 修复桌面端缺失 `pydroid:analyze-notebook` 主进程处理器导致 ipynb 导入失败，并将 Notebook 分析和 Electron 全进程内存加入桌面冒烟测试。
- 桌面实时内存改为汇总 Electron 主进程和渲染/辅助进程的工作集；移除 Windows 默认 File/Edit/View/Window 菜单。
- 修复收起节点栏后“显示节点”按钮遮挡画布工具栏；移除批量 CSV 下方常驻 SMB DocumentsProvider 说明。
- 纵向节点缩窄并增高，增加标题、类型和元信息行距，放大输出端口类型；Notebook 文本区按真实换行和内容高度自动伸展。

## 1.3.8 (21) — 2026-08-13

- 桌面端和网页端在鼠标精确指针模式下支持框选后右键批量菜单，可组合、断开或删除所选节点；新增 `Delete`/`Backspace` 删除、`Ctrl+A` 全选当前画布和 `Esc` 取消选择等键盘操作。
- 修复亮色主题右键菜单悬停、危险项、禁用项及文字选择颜色对比度不足的问题。
- 节点从资源栏拖入画布时以鼠标或手指位置作为节点中心，消除落点与释放位置的固定偏差。
- 节点使用 `ResizeObserver` 同步真实尺寸和端口，整理布局、方向变化、字体加载与节点大小调整后均主动刷新 React Flow 内部几何信息，修复必须切换方向才能恢复连线的问题。
- 统一参数控件的字体、字号与行高；设置中的配置文件详情移入可滚动内容区，不再被悬浮卡片遮挡。
- 设置新增节点大小和连线粗细，并支持设置 JSON 导入导出；导出不会包含 AI API Key，密钥继续保存在设备加密存储中。

## 1.3.7 (20) — 2026-08-13

- 修复纵向节点中心存在少量偏差时，`smoothstep` 连线生成短横线和直角折返的问题；已有流程和新连线统一改用连续贝塞尔路由，拖拽预览与完成后的边保持一致。
- 连线路径使用圆角端点和转角，使线条在节点端口边缘连续贴合，避免视觉上像断线。
- 修复 Node.js 24 在 Windows 上直接启动 `pnpm.cmd` 返回 `spawn EINVAL`、导致 `desktop:dev` 无法运行的问题。

## 1.3.6 (19) — 2026-08-13

- 按 OPPO/金标联盟文件 Picker 指南，将标准 CSV 单选/多选切换为 `ACTION_OPEN_DOCUMENT`，配置 MIME 过滤、多选、URI 读取与持久化授权，单次最多选择 100 个文件。
- 新增“第三方 / SMB 文件”入口，使用显式 Chooser 调用支持 `ACTION_GET_CONTENT` 的第三方文件管理器，避免 ColorOS 直接锁定默认系统文件 Picker。
- 批量读取同时提供“系统文件夹”和“第三方文件夹”入口；SMB 应用实现 Android `DocumentsProvider` 时可直接授权整个目录，不支持树 URI 时给出明确说明并引导改用第三方文件多选。
- Android Manifest 增加 `OPEN_DOCUMENT`、`GET_CONTENT`、`OPEN_DOCUMENT_TREE` 的包可见性查询声明；取消选择仍返回空结果，可再次打开选择器。
- 修复部分 Windows 设备或虚拟环境中 Electron 仅显示纯色背景的问题：桌面端禁用不必要的 GPU 合成，增加渲染进程诊断日志和启动失败恢复页；桌面冒烟测试现在必须确认顶部栏、画布和应用根 UI 均已挂载。
- 修复 OneDrive 本地存储联接导致 `dist-desktop` 未写入 `app.asar`、便携版启动报 `ERR_FILE_NOT_FOUND` 的根因；打包前将渲染产物复制到真实暂存目录，并在生成后直接启动成品验证 UI、IPC 与内置 Python，失败时不再交付空白包。
- 桌面 CSV 文件夹入口同步识别新版系统/第三方模式，保持与 Android 参数接口兼容。

## 1.3.5 (18) — 2026-08-13

- 重构弹窗提示节点为执行前的阻塞式交互节点，不再依赖执行结果是否生成来决定显示，因此弹窗会一直等待用户操作，不会遗漏或自动消失。
- 新增可编辑的 True、False、None 三类按钮，默认显示“确认”“退出”“取消”；任一按钮文字留空即可隐藏，三者全部隐藏时提供安全的“关闭”按钮。
- 用户选择会作为节点输出传给后续节点，并在节点最后结果中记录；多个弹窗输入/提示节点按拓扑执行顺序逐个等待，不再跳过后续交互节点。
- Jupyter 导出使用纯 Python `input()` 实现同等的三值选择逻辑。

## 1.3.4 (17) — 2026-08-13

- 完整适配亮色模式下的 Notebook 代码页、顶部主/次按钮、参数输入控件、节点组织区和辅助文字，补足明确的前景色、背景色、边框与禁用状态。
- 弹窗提示节点在成功执行后真正显示主题化提示框；多个提示节点按工作流顺序逐条显示，并继续在节点结果中保留内容。
- 画布连线改为适合纵向排布的平滑折线路由，提高默认、拖拽中和选中连线的对比度，避免贝塞尔曲线侧向绕行造成误读。
- 参数栏中的节点标签与分组控件改为单列布局，避免窄侧栏下“加入”按钮和输入框被挤压。

## 1.3.3 (16) — 2026-08-13

- 局域网网页在完成配对后首次采用 Android 的主题、侧栏尺寸、缩略图和 AI 设置；用户在网页端主动修改后才保存为该浏览器的独立偏好。
- Android AI API 密钥改用 Android Keystore 的 AES-GCM 加密保存，不进入设置、工作流或用户文件夹；已配对网页会在内存中获得同一密钥，应用更新后无需重新配置。
- 修复横屏/旋转后的侧栏调节：节点栏保持列宽拖拽，底部参数栏改为纵向高度拖拽，并可在设置中精确调整；资源栏的标题、节点/组合/流程标签和搜索固定，只有资源内容滚动。
- 扩大亮色主题的图标和按钮前景色覆盖范围，避免工具栏、React Flow 控件和设置按钮出现不可见图形。
- 新增无代码块的 Pulse 核心节点：生成读出/写入脉冲波形、Vd/Vs/Vg 三通道按时间对齐、连续电流记录按脉冲窗口分段平均；附带“脉冲测量分析”内置组合。Jupyter 导出为等价 NumPy/pandas Python 实现。

## 1.3.2 (15) — 2026-08-12

- 修复旋转后两侧宽度调节边缘被移动端样式隐藏的问题；保留固定命中区，并进一步统一亮色主题下的图标、设置文字、控件和抽屉配色。
- 设置抽屉改为较小圆角，设置与 AI 入口统一细线图标。
- “组合”资源改为真正的子流程模板：内置组合和用户从画布保存的组合使用同一格式；长按菜单可保存当前节点或组合，保存内容位于用户配置目录的 `nodes/`、`workflows/`。
- 共享 Python 核心支持展开 `workflow.group` 公开端口，确保 Android、桌面与直接执行同一组合工作流；新增透视表节点，重制默认组合为多节点、带连线的可编辑子流程。
- 参数栏在选中任意节点时展示该节点（组合显示公开输出内部节点）的最后结果，支持表格、图像和标量；DataFrame 显示列、行与尺寸摘要。
- AI 规划器明确限制为目录节点与连线，禁止生成代码块、函数体、lambda 或 `custom.python_function` 承载逻辑。
- `examples/ter-matrix.workflow.json` 改为无 Notebook/自定义代码节点的 TER 子流程组合，并以批量 CSV → TER → 透视矩阵 → 热图/双 CSV 导出回归验证。

## 1.3.1 (14) — 2026-08-12

- 审计并批量转换用户工作区的 186 个 `.ipynb`：只生成默认可执行节点，不再生成 Jupyter 代码块/自定义函数承载节点；输出含完整未映射语句报告。
- 新增行列切片、重置索引、按索引排序、周期窗口抽取、周期末段均值节点，并可无损导出为 Python。
- 从历史 Notebook 提炼 CSV 清洗导出、实验曲线预览、分组统计矩阵三套内置组合。
- 设置入口更换为细线滑杆图标。

## 1.3.0 (13) — 2026-08-12

- 重制流程输入与重命名弹窗：使用主题化层级、焦点状态和移动端安全尺寸，亮/暗主题均完整适配。
- “流程”资源卡支持长按（桌面端右键）管理：重命名、删除、锁定/解除锁定，以及跳转至 Android 已选文件夹；外部文件会调用 SAF 原生改名和删除。
- 顶部设置入口改为更清晰的三滑杆图标。
- `python.print` 成为默认可见输出：每一个 print 节点分别保留打印结果，启用“显示节点运行结果”时内嵌显示，并汇总至结果面板，互不覆盖。

## 1.2.9 (12) — 2026-08-12

- 修复设置图标显示，补全亮色主题的滚动条、参数控件、弹窗和画布控件。
- AI Agent 增加 OpenAI、Anthropic Claude、DeepSeek、Moonshot Kimi、智谱 GLM、通义千问及自定义接口预设，支持连接测试。
- 新增弹窗提示、文本/数值/下拉选择输入节点，并支持 Jupyter `print`/`input` 导出语义。
- 节点侧栏改为“节点 / 组合 / 流程”，隐藏 Notebook 专用承载节点。
- Android 使用用户选择的 Storage Access Framework 文件夹扫描流程 JSON；设置中显示该位置。

## 1.2.8 (11) — 2026-08-12

- 修复 React Flow 选中回调导致的最大更新深度异常和启动纯色背景。
- 新增渲染错误恢复页，可清除画布缓存重试。

## 1.2.7 (10) — 2026-08-12

- 建立 AI Agent 结构化计划、权限、确认预览和审计基础设施。

## 1.2.6 (9) — 2026-08-12

- 增加顶部设置入口、暗色/亮色/跟随系统主题、左右栏宽度和结果区高度设置。
- 修复 Android 系统栏前景色，状态栏时间、电量等元素在深色主题下可读。
- 增加底部统一状态栏：实时内存、最近计算耗时、节点数、连线数与状态消息。
- 增加 Android 用户配置目录结构：`settings/`、`user-code/`、`workflows/`、`logs/`；保存应用设置、模板和日志。
- 局域网网页增加可选随机四位 PIN、会话配对与运行时内存接口。

## 1.2.5 (8) — 2026-08-11

- 局域网网页与 Android 使用同一工作流 UI；电脑浏览器可选择本机 CSV 或文件夹，Android 负责 Python 计算并回传结果。
- 增加局域网 AirDrop 风格入口，将运行按钮调整到顶部最右侧。
- 增加 `print` 节点及节点级标量结果显示。
- 修复连线校验回调异常导致的画布空白风险，强化端口、类型和环路保护。

## 1.2.4 (7) — 2026-08-11

- 默认改为纵向整理、合适缩放、默认隐藏缩略图。
- 侧栏拖拽边缘固定于侧栏、不随列表滚动，并改善拖拽命中与可见性。
- 结果、缩略图工具栏改为状态按钮，不再显示“开/关”文字。
- 隐藏 React Flow 水印；左侧节点栏与右侧参数栏均支持收起和宽度调整。
- 批量读取统一文件与目录选择的 IO 路径。

## 1.2.3 (6) — 2026-08-11

- 整理布局按当前方向自动对齐；切换方向后立即执行整理。
- 改善节点列表滚动与网页端滚动条配色。
- 增加桌面端鼠标框选；移动端组合模式不再用框选替代缩放手势。
- 调整节点拖拽预览位置和动画，避免被手指遮挡。

## 1.2.2 (5) — 2026-08-10

- 区分双击、右键与长按：双击/右键打开节点菜单；长按进入多选并显示勾选框、删除按钮和组合操作。
- 修复组合模式单选与长按冲突；节点菜单靠近底部时自动向上避让。
- 增加节点分组、子流程画布、公开输入输出端口和解除组合。
- 支持 `if`、`for`、`while` 结构节点及结构容器内放置节点。

## 1.2.1 (4) — 2026-08-10

- 改善节点从列表拖入画布的进入动画与触摸拖拽竞争处理。
- 修复主流程工具栏遮挡和语义不清问题，明确整理、结果和缩略图操作。
- 修复 CSV 单选、多选、目录选择、取消后重新选择和原生文件管理器兼容性。
- 增加批量 CSV 读取、文件名元数据提取及多文件执行链路。

## 1.2.0 (3) — 2026-08-09

- 扩展节点目录、参数面板、Pandas/绘图节点和 `plot.heatmap` 参数。
- 增加自定义 Python 函数、函数签名解析、模板、输入输出端口和个人模板导入导出。
- 增加 Notebook/Jupyter 与工作流互转、`.ipynb` 导入导出、代码视图和 AST 识别基础。
- 增加工作流自动保存、恢复、撤销/重做、结果预览、图表放大与 CSV 导出。

- 1.4.9l UI: rebalance DataGrid action widths and use responsive multi-column controls when the Parameters panel is docked at the bottom.
- Build: add an explicit build-script revision/path marker and regression guards so stale local scripts are immediately visible; preserve Node >=24.19 and MSI-independent CPython NuGet fallback behavior.
