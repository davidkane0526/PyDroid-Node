# Temporary Automated Diagnostics

Version introduced: 1.4.57
Current behavior: 1.4.62

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
2. Editor Command transaction: group creation must atomically update graph, selection and history; undo/redo and group dissolve must restore the correct snapshots.
3. Editor lifecycle autosave: write/read must preserve workflow state and corrupt autosaves must be quarantined/deleted rather than crashing restore.
4. Editor node mutations: node insertion/duplication, parameter updates, continuous-edit history coalescing and canvas layout must execute through Session transactions.
5. Workspace document lifecycle: save/open/close dirty decisions and explicit autosave restore must preserve the saved baseline correctly.
6. Gesture-policy contract: desktop/mobile and node/group semantics must remain intentionally distinct, including mobile canvas pan/marquee behavior.
7. JavaScript workspace variable write -> second-run read.
8. JavaScript reusable function signature/handles + absolute-value execution.
9. Python workspace variable write -> second-run read when a Python host exists.
10. Python reusable function signature/handles + absolute-value execution when a Python host exists.

A plain local browser has no Python host, so its Python cases are reported as skipped. The six Editor Core cases remain host-independent. Desktop, Android and paired Remote Web should execute both runtimes; a fully capable local host therefore reports **10/10**.

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
