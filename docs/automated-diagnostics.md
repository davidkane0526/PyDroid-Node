# Temporary Automated Diagnostics

Version introduced: 1.4.57
Current behavior: 1.4.92

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

The in-app runner contains **20 application/editor/runtime cases**. It intentionally does **not** start, stop, reconcile, or certify Remote Web. Remote-host availability is tested by separate live HTTP/JVM/package smokes so diagnostics cannot influence the production network path.

1. Editor Workspace Session isolation.
2. Editor Command group/function transaction and undo/redo.
3. Editor node mutation ownership and history coalescing.
4. Editor connection/reconnect and metadata transaction.
5. Editor drag-history transaction.
6. Editor lifecycle autosave persistence/quarantine.
7. Workspace document save/open/close/restore lifecycle, including schema migration and future-version rejection.
8. Unified Resource Contract.
9. Resource Service persistence, including legacy migration and opaque future-resource preservation.
10. Workspace Session identity isolation.
11. Session/Execution lifecycle isolation.
12. AI Agent batch transaction atomicity.
13. Workflow requirement ownership.
14. Runtime interaction isolation for `ui.input_dialog` / `ui.alert`.
15. Remote Agent proxy boundary.
16. Desktop/mobile gesture-policy contract.
17. JavaScript workspace-variable write -> second-run read, including migrated-v1 execution.
18. JavaScript reusable function signature/handles + execution.
19. Python workspace-variable write -> second-run read when a Python host exists, including migrated-v1 execution.
20. Python reusable function signature/handles + execution when a Python host exists.

A plain local browser has no Python host, so cases 19-20 are skipped there. No result from this runner should be interpreted as proof that TCP 8765 is reachable. Remote Web is instead covered by `test:remote-host-e2e`, the Android JVM host E2E, and the packaged Desktop live-HTTP smoke.

Repository gate `scripts/automated-diagnostics-contract-smoke.mjs` pins the **20-case** contract and also checks that `App.tsx` does not start or stop Remote Web as part of diagnostics.

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
