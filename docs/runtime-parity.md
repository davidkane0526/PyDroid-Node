# Python / JavaScript Runtime Parity

Phase 5 verifies that a node marked as supporting both runtimes is not merely implemented twice, but produces equivalent workflow semantics.

## 1. Source of truth

Runtime eligibility comes from `NodeSpec.runtimeSupport` normalized by `src/nodeContract.ts`.

A node must not be added to parity tests by maintaining another runtime-support list. If a node is declared as Python + JavaScript, its implementation should eventually receive parity coverage appropriate to its semantics.

## 2. Golden workflow harness

The first golden fixtures live in:

```text
tests/runtime-parity/golden/*.json
```

They are executed by:

```text
pnpm test:parity
```

The harness:

1. compiles the bundled TypeScript/JavaScript engine into a temporary CommonJS directory;
2. runs the same workflow/input through `python/pydroid_flow/engine.py` using Python 3.13;
3. runs the same workflow/input through the JavaScript engine;
4. validates both engines against fixture expectations;
5. compares normalized Python and JavaScript results.

Temporary compiled output is removed after the test.

## 3. What is compared

The comparator intentionally ignores wall-clock timing and traceback formatting. It compares workflow semantics:

- success/error status;
- execution order;
- final table preview;
- node result kinds and payloads;
- columns and row order;
- numbers with a small floating-point tolerance;
- `NaN`/non-finite values normalized to JSON-compatible null semantics;
- scalar/object semantic values when available;
- export metadata/content when present;
- error node ID and node type;
- expected error-message semantic fragments.

Python integer/float representation differences such as `0` versus `0.0` are treated as numerically equivalent.

## 4. Current golden coverage

As of 1.4.37 the suite contains **49 golden workflows covering 63 dual-runtime node types**. Coverage now includes:

- CSV/table transforms, slicing, sorting, pivoting and periodic windows;
- missing-value, duplicate, describe/query and grouping operations;
- scalar/object conversions plus JSON/CSV round trips;
- control-flow generators and temporary variables;
- generic table/text/JSON, batch CSV and binary image input;
- line/scatter/bar/histogram/box/area/heatmap plot execution;
- pulse generation/combination/segmentation and TER matrix extraction;
- explicit error-node parity.

The suite is intentionally composed of small workflows so a failure identifies a narrow semantic contract instead of one giant scenario. Fixtures are split by semantic domain under `tests/runtime-parity/golden/` (`table-core`, `io-convert`, `control-state`, `plots`, `pulse-analysis`, and `errors`) so future node families can grow without turning one JSON file into a monolith.

Scalar/object result previews now include a JSON-safe `value` field. The comparator prefers that semantic payload over human-readable text such as Python `True` versus JavaScript `true`. Python cases are executed as a batch in one interpreter process to avoid repeated pandas/matplotlib startup overhead.

Plot transport remains runtime-specific: Python returns a PNG while JavaScript returns an interactive ECharts object. Current plot golden cases assert that both valid artifacts are produced and compare the surrounding workflow semantics; deeper chart-data/spec normalization can be added without ever comparing PNG pixels.

## 5. Expansion order

Expand parity coverage by semantic domain rather than adding one giant workflow:

1. deterministic table transforms and converters;
2. sorting/grouping/aggregation and missing-value edge cases;
3. plotting data/spec semantics (compare chart data/spec, not rendered PNG pixels);
4. structured control flow and temporary variables;
5. batch/file-input behavior and encoding edge cases;
6. error-family parity;
7. stochastic nodes after their seed/randomness contract is explicitly standardized.

Stateful, side-effecting and UI nodes require dedicated policies. Do not blindly execute them twice in a golden comparator.

## 6. Rules for future nodes

When adding a new node which declares:

```ts
runtimeSupport: ["python", "javascript"]
```

also decide which parity category applies:

- deterministic pure transform: add exact/tolerant golden coverage;
- plotting: compare plot specification/data;
- stateful: compare state-transition semantics with isolated state;
- side effect: use an injectable/mock side-effect boundary;
- stochastic: define seed behavior before claiming exact parity.

A parity failure should be treated as a runtime correctness regression, not patched by loosening the comparator unless the contract itself explicitly permits the difference.


## 7. Parity defects already caught

The expanded suite has already prevented real cross-runtime divergence:

- `convert.json_stringify(indent=0)`: JavaScript compact JSON differed from Python's zero-indent multiline output; JS now matches Python semantics.
- CSV conversion/export: JavaScript omitted pandas-compatible terminal newlines; conversion/export now preserves the same text result.
- `pandas.describe`: an empty include value was treated as an empty JS include-list and removed all numeric columns; empty now means no include filter.
- `pulse.generate_oscillating_ramp`: JS advanced amplitude asymmetrically; it now matches the Python `+step, -step, +2*step, -2*step, …` sequence.

These are exactly the failures Phase 5 is intended to surface. Do not weaken the comparator to hide a mismatch unless Node Contract explicitly says the runtimes are allowed to differ.
