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

## Execution lifecycle (Phase 2)

Phase 2 established `src/execution-controller.ts` as the renderer-side authority for one workspace execution lifecycle. Phase 3.5 adds an `ExecutionManager` which keeps one controller per workspace and delegates host concurrency to platform schedulers. Every run receives a persistent-for-that-run `executionId`, a normalized timeout and an `AbortSignal`. The controller publishes the explicit lifecycle states `queued`, `running`, `cancelling`, `cancelled`, `success`, `failed` and `timeout`; UI code observes these states instead of maintaining a second independent `isRunning` flag.

Host cancellation is intentionally platform-specific behind the runtime transport:

- **Windows Desktop:** `desktop/execution/PythonProcessController.cjs` owns the `executionId -> child process` registry. Cancellation and timeout terminate the Python child and also use `taskkill /T /F` on Windows to clean descendant processes. Application shutdown cancels all remaining executions.
- **Android:** `PythonExecutionController.java` owns a dedicated workflow executor, timeout scheduler and `Future` registry. Workflow execution is separated from the generic platform worker used by SMB/profile operations. `Future.cancel(true)` interrupts the workflow thread, while the execution registry remains occupied until the worker callable actually exits. Because Chaquopy embeds Python in the app process, this is **best-effort cancellation** for Python/native work; an uninterruptible native C/NumPy call cannot be safely hard-killed without moving Python execution into a separate Android process.
- **LAN Remote Web:** the same `executionId` crosses `/api/execute`. Browser abort additionally calls `/api/cancel`, so cancellation reaches the host instead of merely stopping `fetch`.
- **JavaScript runtime:** the shared controller can classify cancellation/timeout at the orchestration layer, but the current JavaScript engine executes synchronously in the renderer. A CPU-bound synchronous JS node cannot be forcibly interrupted while it blocks the event loop. Hard cancellation for JS requires future worker isolation and is not claimed by Phase 2.

The default workflow timeout is 10 minutes, normalized to the supported 1-second to 24-hour range. In Phase 3.5, Desktop Python permits up to `min(4, available CPU parallelism)` active workflow processes and queues excess jobs; Android keeps one Chaquopy workflow active and queues the rest. Utility/platform tasks remain outside the workflow scheduler.

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

1. **Phase 1 complete and user-accepted:** keep the PlatformAdapter boundary frozen unless a verified host-capability bug requires a compatible extension.
2. **Phase 2 complete and user-accepted:** preserve host-release cancellation semantics and Android native-code limitations.
3. **Phase 3 Workflow Core complete/frozen:** workflow session/history/input-state/persistence/migration semantics live under `src/workflow-core/`.
4. **Phase 3.5 implemented, pending acceptance:** multi-workspace scheduling, Desktop bounded parallelism, Android FIFO queueing, and proactive Remote Web host-status polling.
5. **Next: Phase 4 Unified NodeSpec:** centralize runtime/side-effect/cache/deterministic metadata.
6. Build Phase 5 Python/JavaScript golden-workflow parity tests, then modularize runtime engines and hosts.

The authoritative architecture/reliability roadmap is `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md`.

The project should not return to separate Python-UI and JavaScript-UI branches.

### Phase 2 reliability closure in 1.4.29

- Cancellation handlers are asynchronous barriers: renderer lifecycle stays `cancelling` until the host reports that the matching `executionId` has been released.
- Desktop `PythonProcessController` keeps an execution registered until the OS reports child `close`; cancellation uses `taskkill /T /F` on Windows and confirms closure before publishing idle.
- Android keeps the controller slot until the Chaquopy worker callable exits. `PythonExecutionCancellation` plus Python tracing makes pure-Python/Notebook code cooperative; native C/NumPy remains best-effort.
- `/api/execution-status` and native host `getExecutionStatus` make Remote Web work visible to the host UI. A remote run changes the host button to “停止远程”.

## Workflow Core (Phase 3)

`src/workflow-core/` is now the home for workflow state semantics which previously lived in `App.tsx`: snapshot persistence signatures, history, per-tab session/dirty state, guarded persistence, serialization, migration/validation and reusable graph commands. UI components should invoke these abstractions rather than recreate equivalent arrays/maps/localStorage logic.

`ui.alert` currently uses the core `upstreamSubgraph` command to execute only the graph feeding its `content` port before opening the dialog. This fixes stale previous-run popup data without changing the visual UI.

## Multi-Workspace Execution (Phase 3.5)

Execution identity is now four-dimensional: `executionId` identifies the run, `workspaceId` identifies the tab/workspace, `clientId` identifies the UI/browser session, and `source` records local vs Remote Web origin. Local and remote requests share the same host scheduler.

- **Desktop Python:** `WorkflowExecutionScheduler.cjs` runs up to 1–4 child processes depending on available CPU parallelism and queues excess jobs FIFO. Each process remains independently cancellable.
- **Android Python:** one embedded Chaquopy worker runs at a time and additional requests queue FIFO. Queue waiting is not counted against execution timeout.
- **Workspace UI:** switching tabs does not discard the execution controller, successful result, input selection or undo/redo history of the inactive workspace. The primary run button controls only the active workspace.
- **Remote state:** after pairing, the browser polls host execution state every 400 ms. Host-started runs therefore update the browser controls without requiring interaction.
- **JavaScript:** remains synchronous in the renderer and is effectively single-threaded. A later Web Worker runtime is required for real JS parallelism and hard cancel.
