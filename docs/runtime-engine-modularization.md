# Runtime Engine Modularization

Phase 6 architecture rules for Python and JavaScript runtimes.

## Python

`python/pydroid_flow/engine.py` is a compatibility facade, not an implementation bucket. External callers may continue importing `execute_workflow`, `analyze_signature_json`, environment/cache helpers and the historical custom-import policy facade from this module.

Implementation lives under `python/pydroid_flow/engine_parts/`:

```text
engine_parts/
├─ workflow_execution.py   # workflow orchestration, loops/structures, cancellation, errors
├─ node_dispatch.py        # transitional node-family dispatcher
├─ notebook_execution.py   # raw notebook cell execution
├─ graph.py                # ordering, edges, upstream resolution, container discovery
├─ cache.py                # node-result cache persistence/digests
├─ values.py               # column/value/parameter coercion helpers
├─ random_portable.py      # locked portable-v1 RNG/sample semantics
├─ io_readers.py           # CSV/batch CSV parsing
├─ custom_function.py      # signature analysis, sandbox/import policy, custom function execution
├─ analysis_nodes.py       # grouping/filter expressions/TER analysis helpers
├─ pulse_nodes.py          # pulse waveform/segment helpers
└─ presentation.py         # printable/preview/semantic serialization
```

The current `node_dispatch.py` remains a transitional dispatcher. Future Phase 6 work should split coherent families (table/pandas, plot, control/state, conversion/UI) into handlers instead of growing this file. `scripts/runtime-engine-architecture-smoke.mjs` keeps `engine.py` as a small facade and caps dispatcher growth.

## JavaScript

The JavaScript runtime already has domain-level modules under `src/runtime/javascript/engine/` (`nodes`, `table`, `plots`, `csv`, `notebook`, `random`). Do not force file-by-file symmetry with Python. Behavior symmetry is enforced by NodeContract plus the Phase 5 golden parity gate.

## Non-negotiable behavior locks

Every runtime-engine refactor must keep these passing before delivery:

- Python unit/regression tests;
- `scripts/runtime-parity-smoke.mjs` (all JS-capable NodeContracts); 
- execution/process/scheduler smoke tests;
- NodeContract and Workflow Core architecture checks;
- `scripts/runtime-engine-architecture-smoke.mjs`.

Do not combine engine modularization with algorithm rewrites unless a failing test proves an existing defect and the behavior change is documented separately.
