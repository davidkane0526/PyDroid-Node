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

For compatibility, `src/execution.ts` and `desktop/renderer/execution.ts` remain host facades in this phase. They register the Python adapter and the shared JavaScript adapter, while existing file picking, SMB, remote-access and profile APIs continue to work unchanged.

A later platform refactor can move those host APIs into `src/platform/*` without changing `RuntimeAdapter`.

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

Feature/refactor branches are temporary:

```text
main
  ↑
dev
  └── refactor/runtime-architecture   ← current work
```

The former JavaScript branch is a migration source, not a second application to keep synchronized. Once this refactor is locally validated and merged, its remaining branch can be archived or deleted because the useful engine now lives in the unified source tree.

## Next phases

1. Validate Python/JavaScript parity for the supported node set and expand it only where semantics can be matched.
2. Move SMB, file dialogs, profile storage and host-specific services from compatibility facades into a `PlatformAdapter` layer.
3. Extract workflow session/history/serialization responsibilities from the large application component into a `workflow-core` module.
4. Add typed runtime capability metadata to node definitions so the palette can show runtime support before execution.
5. Consider per-node or segmented mixed-runtime execution only after data transfer semantics and debugging behavior are well defined.

The project should not return to separate Python-UI and JavaScript-UI branches.
