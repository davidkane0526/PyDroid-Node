# Temporary Automated Diagnostics

Version introduced: 1.4.57
Current behavior: 1.4.74

This module exists only to shorten the developer/user feedback loop while Phase 8 and later host/runtime work is being stabilized.

## Entry point

`Settings -> Debug & hot reload -> Enable temporary automated diagnostics -> Run diagnostics`

The same React UI is used by Windows Desktop and Android. The diagnostic runner itself is isolated in:

- `src/diagnostics/automated-debug.ts`
- `AutomatedDiagnosticsDialog` in `src/dialogs.tsx`
- the small settings/launcher wiring in `src/App.tsx`

## Isolation guarantees

The runner creates unique `diagnostic-*` workspace IDs. It does not replace the current graph, functions, selected files, editor history or active workspace-variable state. Diagnostic workspace state is cleared after the state-persistence cases.

The report records only application/runtime diagnostics and the names/counts of current workspace resources. It does not include CSV contents, SMB passwords, AI keys or other secrets.

## Current automated cases

1. Editor Workspace Session isolation: graph/input/history/view/dirty state from one diagnostic tab must not leak into another.
2. Editor Command transaction: group/function structural changes must atomically update graph, selection and history.
3. Editor node mutations: insertion/duplication, parameter history coalescing and layout execute through Session transactions.
4. Editor connection/metadata transaction: connect/reconnect, node replacement, tags, group labels/ports and code-template application execute through Editor Core.
5. Editor drag history: live pointer movement must collapse to one history transaction, including structure-container/branch assignment and undo restoration.
6. Editor lifecycle autosave: write/read preserves workflow state and corrupt autosaves are quarantined/deleted.
7. Workspace document lifecycle: save/open/close dirty decisions and explicit autosave restore preserve the saved baseline.
8. Unified Resource Contract: node/saved-node/function/group/flow capabilities and built-in/locked protection.
9. Workspace Session identity: same workspace ID remains isolated by client and Local/Remote source; host execution matching uses workspace + client + source.
10. Resource Service persistence: saved-node/group/flow mutation, lock protection and profile mirroring stay behind the Resource Library Service.
11. Session/Execution lifecycle: equal workspace IDs from different client/source identities own independent local execution controllers.
12. AI Agent batch transaction: a valid plan commits once/undoes once and an invalid plan cannot partially mutate the Session.
13. Workflow requirement ownership: add/update/remove executes through Editor Commands and remains undoable.
14. Runtime interaction isolation: `ui.input_dialog` and `ui.alert` responses affect only the current execution and do not mutate/dirty the Editor Session.
15. Remote Web host E2E: a real Desktop/Android host service must start on stable TCP 8765, pass native HTTP `/health` + shell + JS-resource readiness, expose a non-loopback LAN URL, and report live SSDP/mDNS state. Desktop additionally requires every advertised LAN IPv4 to answer `/health` and requires SSDP/mDNS to finish real bind + multicast membership. Firewall/profile traversal from another physical device is intentionally outside this same-process diagnostic.
16. Remote Web security policy: PIN lock/cooldown, token TTL and normal/expensive API limits match the Phase 10 contract.
17. Remote Agent proxy boundary: Agent transport can run without a browser-held raw API key.
18. Gesture-policy contract: desktop/mobile and node/group semantics remain intentionally distinct, including mobile canvas pan/marquee behavior.
19. JavaScript workspace variable write -> second-run read.
20. JavaScript reusable function signature/handles + absolute-value execution.
21. Python workspace variable write -> second-run read when a Python host exists.
22. Python reusable function signature/handles + absolute-value execution when a Python host exists.

A plain local browser has no Python host, so its two Python cases are reported as skipped. The Phase 9 Editor/session contracts and the Phase 10 security/Agent-proxy contracts remain useful independent checks, but they are not evidence that a packaged host is externally reachable. Starting with 1.4.71, Desktop and Android add the host E2E case above; a fully capable local host therefore reports **22/22**. 1.4.73 keeps the stronger fixed-port/LAN-HTTP/multicast readiness from 1.4.72 but removes Windows firewall/profile state from the pass criteria after real 1.4.72 use showed that brittle PowerShell profile detection could block a valid host startup. In 1.4.74, an already-running host is queried again for current HTTP/discovery readiness instead of reusing the renderer's cached startup object, so later recovery or failure is observable. Paired Remote Web cannot itself host another server, so the host-E2E case is skipped there.

Repository gate `scripts/automated-diagnostics-contract-smoke.mjs` pins this 22-case full-host contract so the diagnostic runner and documentation cannot silently drift apart.

## Output

The dialog can copy or export `pydroid-flow.automated-diagnostics` schema v1 JSON. Android also saves the latest report internally at `logs/automated-diagnostics-latest.json` through the existing profile capability.

From 1.4.58, Android export is native rather than a WebView download: **导出 JSON** launches the Android system `ACTION_CREATE_DOCUMENT` file picker, pre-fills the report filename, writes the selected document URI, and reports saved/cancelled/failed state in the diagnostics dialog. Desktop builds use an Electron system save dialog; browser builds retain the normal download behavior.

## Disable or permanently remove

Disabling the setting removes the runnable entry point and has no workflow/runtime side effects.

Permanent removal is intentionally mechanical and schema-neutral:

1. delete `src/diagnostics/automated-debug.ts`;
2. remove `AutomatedDiagnosticsDialog` from `src/dialogs.tsx`;
3. remove the diagnostics state/launcher and settings props from `src/App.tsx`;
4. remove the `automatedDiagnosticsEnabled` settings key and the diagnostics-only CSS block.

No workflow schema, NodeContract, runtime protocol, saved function or workspace-state codec depends on this feature, so removal does not require workflow migration.

### 1.4.59 Desktop export repair

Desktop diagnostics export is now routed through `pydroid:export-text-file`. Electron opens the native save dialog and writes UTF-8 content only after the user chooses a destination. This keeps Desktop and Android on explicit host file-export capabilities while the browser adapter remains download-based.
