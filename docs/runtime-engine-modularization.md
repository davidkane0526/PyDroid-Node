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

As of 1.4.40, `node_dispatch.py` is no longer a transitional implementation file: it is a routing-only facade. Concrete Python node families live under `engine_parts/nodes/` (`io_generate`, `table_pandas`, `control_state`, `analysis_pulse`, `plots`, `conversion_ui`). Architecture smoke caps the dispatcher and every domain module so a new monolith cannot silently reappear.

As of 1.4.41, JavaScript `engine/nodes.ts` follows the same architectural rule: it is a routing facade only. Concrete JS families live in `engine/nodes/`, while reusable helpers are split under `engine/nodes/support/` (`types`, `common`, `io`, `table_ops`, `control`, `analysis`, `pulse`, `serialization`). This is intentionally not a requirement for file-name symmetry with Python; the invariant is that domain logic is isolated and parity-protected.

As of 1.4.42, JavaScript workflow orchestration is also modularized. `engine/engine.ts` is a compatibility facade; concrete workflow responsibilities live under `engine/workflow/`:

```text
workflow/
├─ input.ts       # compatible JSON/Python-literal decoding, safety limits, input validation
├─ graph.ts       # DAG ordering, upstream resolution, loop/group topology
├─ structures.ts  # visual if/for/while and loop-subflow execution
├─ execute.ts     # workflow orchestration and node-result accumulation
├─ result.ts      # semantic values, preview/error/environment serialization
└─ types.ts       # workflow/execution transport types
```

## JavaScript

The JavaScript runtime now has stable facade/routing boundaries for both node dispatch and workflow execution. Do not force file-by-file symmetry with Python. Behavior symmetry is enforced by NodeContract plus the Phase 5 golden parity gate. `engine.ts` and `nodes.ts` must remain small compatibility/routing facades; new workflow responsibilities belong under `engine/workflow/`, and new node algorithms belong under `engine/nodes/`.

## Non-negotiable behavior locks

Every runtime-engine refactor must keep these passing before delivery:

- Python unit/regression tests;
- `scripts/runtime-parity-smoke.mjs` (all JS-capable NodeContracts); 
- execution/process/scheduler smoke tests;
- NodeContract and Workflow Core architecture checks;
- `scripts/runtime-engine-architecture-smoke.mjs`.

Do not combine engine modularization with algorithm rewrites unless a failing test proves an existing defect and the behavior change is documented separately.

## Phase 6 completion

Phase 6 is complete/frozen as of 1.4.42 (65). Python and JavaScript both have protected facade/routing boundaries, focused workflow/node modules and full Phase 5 parity protection. Future changes may extend these modules, but must not collapse them back into monolithic `engine.py`, `engine.ts`, `node_dispatch.py` or `nodes.ts` files. The next architecture stage is Phase 7 Host modularization.
