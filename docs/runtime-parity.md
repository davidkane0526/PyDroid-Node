# Python / JavaScript Runtime Parity

Phase 5 verifies that a node marked as supporting both runtimes is not merely implemented twice, but produces equivalent workflow semantics.

## 1. Source of truth

Runtime eligibility comes from `NodeSpec.runtimeSupport` normalized by `src/nodeContract.ts`.

A node must not be added to parity tests by maintaining another runtime-support list. If a node is declared as Python + JavaScript, its implementation should eventually receive parity coverage appropriate to its semantics.

## 2. Golden workflow harness

The first golden fixtures live in:

```text
tests/runtime-parity/golden-workflows.json
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
- scalar value text;
- export metadata/content when present;
- error node ID and node type;
- expected error-message semantic fragments.

Python integer/float representation differences such as `0` versus `0.0` are treated as numerically equivalent.

## 4. Initial golden workflows

Phase 5 starts with four workflows:

- `csv_filter_head` — CSV parsing, column selection, range filtering and `head`;
- `difference_fillna` — difference/NaN generation followed by missing-value filling;
- `scalar_len` — a table-to-scalar output path;
- `invalid_column_error` — both runtimes must fail at the same node/type for an invalid column selection.

Initial covered node types:

```text
io.read_csv
pandas.fillna
pandas.head
python.len
table.difference
table.filter_range
table.select_columns
```

This is a starting coverage set, not a claim that every dual-runtime node is already proven equivalent.

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
