# Python / JavaScript Runtime Parity

PyDroid Node treats JavaScript runtime support as a semantic contract, not merely the existence of a second implementation. A workflow may run in JavaScript only when both the node type and the active parameter combination have a proven portable contract.

## Source of truth

Runtime eligibility comes from `NodeSpec.runtimeSupport`, normalized by `src/nodeContract.ts`. `NodeContract.parityClass` records the strength of that promise:

- **A — strict workflow semantics**: Python and JavaScript must agree on workflow-visible values, table shape/order, errors and state transitions within the contract.
- **B — presentation/artifact semantics**: the workflow meaning is portable, but the rendered artifact is intentionally runtime-specific. Current examples are Plot nodes (Python PNG vs JavaScript ECharts) and injected UI interactions.
- **C — not JavaScript-portable**: Python-only/custom-code nodes or definitions that are not executable in both runtimes.

The contract validator rejects a JavaScript-capable catalog node marked C and rejects a Python-only catalog node marked A/B.

## Parameter-level runtime gate

A JavaScript-capable node type is not automatically safe for every pandas/Python-specific option. `canWorkflowRunInRuntime()` also evaluates the current parameters. Auto runtime selection therefore chooses Python when a parameter combination has not been proven equivalent.

Examples currently gated to Python include pandas-specific `read_csv` options such as index-column materialization, date parsing/dtype overrides, non-C CSV engines and unsupported bad-line policies; non-default `describe` percentiles/include/exclude; and horizontal concat while duplicate column labels cannot be represented by the current JavaScript Table model.

This is a correctness gate, not a fallback bridge: common semantics that can be implemented exactly should be fixed in the JavaScript runtime and covered by parity fixtures rather than permanently blocked.

## Golden workflow harness

Fixtures live under:

```text
tests/runtime-parity/golden/*.json
```

Run:

```text
pnpm test:parity
```

The harness compiles the bundled TypeScript/JavaScript engine, executes the same workflow through Python 3.13 and JavaScript, validates expected results, then compares normalized workflow semantics. Temporary compiled output is removed afterward.

The comparator checks success/error status, execution order, table columns/rows, scalar/object values, export metadata/content and error identity/message semantics. Floating-point values use a small tolerance and non-finite values are normalized to JSON-safe semantics. Python `0` and JavaScript `0.0` are numerically equivalent.

Plot transport is intentionally B-class: Python produces a raster artifact while JavaScript produces an interactive ECharts object. Golden plot cases compare the surrounding workflow/spec semantics rather than PNG pixels.

## 1.5.10 checkpoint

Current strict corpus: **102/102 golden workflows**. Every JavaScript-capable NodeContract is represented: **82/82**.

The semantic-boundary corpus includes, among other cases:

- `read_csv(header="infer", names=[...])` preserving the first data row;
- `nRows` applied after header extraction;
- pandas-compatible whitespace, duplicate-header mangling, boolean inference and mixed text/numeric object columns;
- `usecols` preserving source-file column order and deduplicating repeated selections;
- negative `head`, `tail`, slice bounds and reverse slicing;
- boolean `abs` / `diff`, banker (half-even) rounding;
- groupby missing-key behavior and numeric-only aggregation;
- `sort_index(axis=1)` sorting labels rather than values;
- pivot numeric axis ordering, missing-key handling and text-compatible `first` aggregation;
- native nodes ignoring hidden `notebookSource` payloads rather than executing an undocumented source-code bridge.

A separate `test:runtime-parameter-parity` gate checks representative parameter-level decisions, so future changes cannot silently re-enable JavaScript for currently unproven combinations.

## Rules for future nodes

When a node declares:

```ts
runtimeSupport: ["python", "javascript"]
```

it must receive an A or B parity classification and golden coverage in the same change. Prefer narrow, semantic fixtures over one giant scenario. Stateful, side-effecting and stochastic nodes require explicit contracts; seeded random/table sampling currently use the locked `portable-v1` deterministic sequence in both runtimes.

A parity failure is a runtime correctness regression. Do not make it green by loosening the comparator unless the documented NodeContract explicitly permits the difference.

## Coverage gate

The parity harness enumerates every contract whose `runtimes.javascript === true` and fails if any node type lacks a golden case. `workflow.group` is a current native workflow contract and is covered normally. Removed compatibility aliases are not kept alive merely to satisfy old parity fixtures.
