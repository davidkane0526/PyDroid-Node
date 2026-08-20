# Phase 8 — Workflow Language / State & Function System

Version: 1.4.59 (82)
Branch: `phase8/workflow-language-state-functions`

## Goals

Phase 8 turns workflow state and reusable functions into explicit workflow-language concepts owned by Workflow Core / NodeContract / runtimes, rather than renderer-local conventions.

## State model

Two state scopes are intentionally distinct:

- `variable.set` / `variable.get`: execution-local temporary state. It resets for every workflow run.
- `variable.set_workspace` / `variable.get_workspace`: workspace-session state. The renderer owns one JSON-safe state map per `workspaceId` / editor tab, passes it explicitly into a run, and accepts the returned state only from a successful run.

Workspace state is never Python-process-global, JavaScript-process-global or host-global. Closing a tab or creating a new workflow in that tab clears its workspace state. Runtime values are not persisted into workflow JSON/autosave; function definitions are persisted.

The transport codec supports JSON scalars/objects/lists plus typed tables and bytes. Python additionally preserves tuples. Non-finite numeric values are normalized to JSON-safe `null`. State is limited to 1000 named variables.

## Reusable function model

Workflow schema v2 adds `functions[]`. A function definition contains:

- stable `id`;
- human-readable `name` and optional `description`;
- integer `version`;
- typed input/output signatures;
- an internal workflow graph (`nodes` + `edges`);
- interface mappings from each public port to an internal node/handle.

`function.call` is a dynamic NodeContract entry. Its typed ports come from the referenced function signature. A call records `functionId` + exact `functionVersion`; it does not copy an executable function body.

Updating a function from an editable group keeps the stable function ID, increments the version, synchronizes call nodes, and removes call edges whose old port no longer exists. Recursive function-definition cycles are rejected. Runtime call depth is also capped at 32 as a defensive boundary.

Schema v1 workflows migrate to schema v2 by adding an empty function-resource list; existing Phase 7 documents therefore remain readable without semantic rewriting.

## Runtime behavior

Python and JavaScript execute reusable functions from the same persisted graph/signature model. Nested function calls and function calls inside visual structures are supported. Temporary variables and workspace variables share the caller execution context correctly.

Auto runtime selection expands reachable function bodies before choosing a runtime. Therefore a root graph that appears JavaScript-capable will still select Python if a called function contains a Python-only node such as `custom.python_function` or `notebook.code_cell`.

Python notebook code inside a function uses the same notebook namespace for that function execution and nested structure calls. JavaScript continues to execute only NodeContracts that declare JavaScript support.

Current structural constraint: a legacy edge-driven loop subflow inside a reusable function must receive its initial table from an internal function-body edge. A public function input cannot directly replace that special loop-entry edge. Visual `if` / `for` / `while` structures can receive ordinary function inputs.

## UI

The existing Resources sidebar gains a fourth **Functions** tab. It contains:

- current-tab workspace-variable names and a clear action;
- persisted function definitions with version/call count;
- insert-call, expand-as-editable-group and delete actions.

A selected workflow group can be saved as a new function or used to update the function from which it was expanded. A selected function call can be expanded back to an editable group.

No runtime semantics are implemented in `App.tsx`; the renderer invokes helpers from `workflow-functions.ts`, Workflow Core and the runtime/execution layers.

## Validation performed for 1.4.56

Cloud/offline validation completed:

- Python full suite: 111 passed, 1 skipped;
- Phase 8 targeted Python tests cover workspace-state round trip/isolation, temporary-state reset, reusable calls, version mismatch, recursion rejection, and notebook code inside functions;
- runtime parity: 68/68 golden workflows, including workspace state and reusable function call;
- JS-capable NodeContract parity coverage: 75/75;
- JS engine TypeScript compilation: passed with the available compiler;
- App / Workflow main-path TS/TSX syntax compilation: passed;
- build/UI/platform/host/Remote Web/execution/workflow/runtime/NodeContract architecture smoke tests: passed;
- schema-v1 → schema-v2 offline parser migration and all Phase 8 manual workflow fixtures: passed;
- Chromium CSS rendering at the default 176 px palette width in dark/light themes: no horizontal overflow in the four resource tabs, workspace-variable chips or function action buttons after width tuning.

The cloud environment cannot reach npm/Gradle distribution servers and does not contain the project's dependency tree or Android SDK, so a dependency-backed Vite/Electron/Android package build is not claimed here. The repository contains `tests/manual/phase8/` so the remaining validation is limited to real Windows/Android packaging and real-device/client interaction.


## 1.4.57 corrective update

User acceptance exposed two integration gaps in 1.4.56. First, the Windows desktop renderer had a separate execution adapter that had not yet adopted workspace-state transport, reusable-function serialization, or reachable-function runtime selection. Second, the canvas card renderer did not consume `functionInputs` / `functionOutputs` even though the persisted function-call node contained them. Both are corrected in 1.4.57.

The Functions resource view now refreshes explicitly after a successful run. A removable in-app automated diagnostics module was also added so future Desktop/Android acceptance can be reported as one JSON result rather than a multi-file manual procedure. See `docs/automated-diagnostics.md`.
## 1.4.59 build repair

The 1.4.58 Android-native diagnostics export expanded `FilePlatformCapability` with `exportTextFile`, but the Desktop renderer adapter was not updated at the same time. 1.4.59 restores platform parity by adding the Desktop capability, Electron save-file IPC, and a host-contract regression guard. No Phase 8 workflow/runtime semantics changed in this repair.

## 1.4.58 acceptance update

The user-provided 1.4.57 Desktop diagnostics report passed all four automated cases, confirming workspace persistence and reusable-function execution in both JavaScript and Python. Android export UX was then corrected: diagnostics JSON now uses the native Storage Access Framework create-document flow, making the destination explicit instead of depending on WebView download handling. The Resources navigation order is now **节点 → 函数 → 组合 → 流程**, and the palette minimum/default width is 216 px so the four Chinese labels are not compressed.
