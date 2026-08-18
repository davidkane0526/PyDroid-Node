# PyDroid Node runtime architecture

## Goal

PyDroid Node keeps one application, one UI and one workflow document model. Python and JavaScript are execution backends, not separate product branches.

```text
                         PyDroid Node
                              │
                 ┌────────────┴────────────┐
                 │                         │
             Shared UI               Workflow Core
                 │                         │
      TopBar / Tabs / Inspector      Node / Edge / Save
      Dialog / DataGrid / Touch      History / Serialization
                 │                         │
                 └───────────┬─────────────┘
                             │
                       Runtime API
                    /                 \
                   /                   \
          Python Runtime          JavaScript Runtime
        native / desktop / LAN       renderer-local
```

The current refactor intentionally introduces the runtime boundary before moving all UI and workflow files into new directories. This keeps the 149p behavior stable while removing the architectural reason for maintaining a separate `js` application branch.

## Runtime API

Shared contracts live in `src/runtime/types.ts`.

A runtime implements `RuntimeAdapter`:

- metadata and capabilities;
- warm-up;
- environment information;
- workflow compatibility detection;
- workflow execution.

`src/runtime/registry.ts` owns runtime registration and selection. `auto` currently prefers JavaScript only when the complete workflow is supported. Otherwise it falls back to Python. An explicit JavaScript selection never silently falls back; it reports unsupported node types so behavior is predictable.

## Python runtime

`src/runtime/python.ts` adapts the existing Python execution backend without changing its host-specific transport.

`src/execution.ts` and `desktop/renderer/execution.ts` now contain only execution/runtime concerns. Phase 1 of the platform refactor moved file picking, SMB, profile storage, secret persistence, remote-access hosting and system statistics behind a `PlatformAdapter`.

Shared contracts live in `src/platform/types.ts`. Android/Web select an adapter through `src/platform/index.ts`; the Windows renderer uses `desktop/renderer/platform.ts`, mapped by the desktop Vite configuration. Runtime code may use the platform remote transport when a paired browser delegates execution to the host, but UI host capabilities no longer live in the execution facade.

## JavaScript runtime

The useful engine from the former `feature/js-runtime` branch is recovered under:

`src/runtime/javascript/engine/`

It is a pure TypeScript data-flow engine and does not replace Python. Its main advantages are:

- no Python process startup for compatible workflows;
- execution in the renderer/WebView;
- interactive ECharts plot output;
- a second implementation for common table/data-flow nodes, including current group-by aggregation and workflow-scoped variables.

`src/runtime/javascript/adapter.ts` contains an explicit compatibility set. Python-source nodes such as custom Python functions and Python Notebook cells are deliberately excluded from automatic JavaScript execution.

## Plot presentation

Both runtimes now share one plot presentation contract:

- Python may return a raster PNG;
- JavaScript may return an interactive ECharts configuration.

`src/ui/PlotPreview.tsx` and `src/ui/PlotView.tsx` hide that difference from the rest of the UI.

## Runtime preference

Settings expose three modes:

- **Auto**: prefer JavaScript for a fully compatible workflow, otherwise use Python;
- **Python**: always use Python;
- **JavaScript**: always request JavaScript and report unsupported nodes instead of silently changing semantics.

The preference is an application setting in this phase. It is intentionally not yet written into the workflow schema, so existing workflow files remain compatible. In a paired LAN browser session, **Auto** preserves the existing host-execution contract and routes to the host Python runtime; JavaScript is used there only when the user selects it explicitly.

## Branch policy

Long-lived application branches should be limited to `main` and `dev`.

Feature/refactor branches are temporary. The current architecture/reliability line is the long-lived local `dev` branch:

```text
main
  ↑
dev   ← architecture / reliability development
  └── temporary refactor/fix branches only when isolation is useful
```

The former JavaScript branch is a migration source, not a second application to keep synchronized. The useful engine now lives in the unified source tree; do not recreate a second JS application branch.

## Next phases

1. Validate the new PlatformAdapter boundary on Windows and Android without changing UI behavior.
2. Add an `ExecutionController` with execution IDs, timeout, cancellation and deterministic cleanup on Windows and Android.
3. Extract workflow session/history/serialization/migrations from the large application component into a `workflow-core` module.
4. Add typed runtime capability metadata to node definitions so the palette can show runtime support before execution.
5. Build Python/JavaScript golden-workflow parity tests and expand JavaScript support only where semantics can be matched.
6. After these boundaries are stable, modularize the Python engine and platform host implementations.

The authoritative architecture/reliability roadmap is `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md`.

The project should not return to separate Python-UI and JavaScript-UI branches.
