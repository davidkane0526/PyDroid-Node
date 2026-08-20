# Temporary Automated Diagnostics

Version introduced: 1.4.57
Current behavior: 1.4.70

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
15. Remote Web security policy: PIN lock/cooldown, token TTL and normal/expensive API limits match the Phase 10 contract.
16. Remote Agent proxy boundary: Agent transport can run without a browser-held raw API key.
17. Gesture-policy contract: desktop/mobile and node/group semantics remain intentionally distinct, including mobile canvas pan/marquee behavior.
18. JavaScript workspace variable write -> second-run read.
19. JavaScript reusable function signature/handles + absolute-value execution.
20. Python workspace variable write -> second-run read when a Python host exists.
21. Python reusable function signature/handles + absolute-value execution when a Python host exists.

A plain local browser has no Python host, so its two Python cases are reported as skipped. The fifteen Phase 9 Editor Core/session cases plus the two Phase 10 Remote security/Agent-proxy boundary cases remain host-independent. Desktop, Android and paired Remote Web should execute both runtimes; a fully capable local host therefore reports **21/21**.

Repository gate `scripts/automated-diagnostics-contract-smoke.mjs` pins this 21-case full-host contract so the diagnostic runner and documentation cannot silently drift apart.

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
