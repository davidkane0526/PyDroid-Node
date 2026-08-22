# Current development handoff — 1.5.1 Notebook Loop Lowering / JS Parity

Branch: `feature/1.5.1-notebook-loop-lowering`
Version: **1.5.1**
Android versionCode: **124**
Build revision: `1.5.1-dev-r79-notebook-loop-lowering`

## Non-negotiable rules for continuation

1. Work from the supplied local ZIP. Do **not** use GitHub as the development source.
2. JavaScript execution is a golden rule. A new native node/control structure is incomplete until Python and JavaScript implementations both exist and a parity golden workflow passes.
3. Do not reintroduce `logic.if_subflow`, `logic.for_each_subflow`, or `logic.while_subflow`, including aliases, migrations, compatibility shims, hidden bridges, or importer rewrites.
4. Table branching remains data processing (`table.split_condition` / `table.merge_rows`), not language-level control flow.
5. Notebook conversion is correctness-first. If equivalence is not proven, retain executable Python.
6. Remote Web/LAN production paths are accepted baselines and unrelated to this compiler work; do not redesign them.

## Current control-flow model

- `logic.if_value`: generic selected-branch If.
- `logic.for_each_value`: stateless generic iteration with a child body.
- `logic.while_state`: explicit arbitrary state feedback through the body result.
- `logic.for_range`: deterministic numeric range primitive.
- `logic.while_number`: deterministic guarded numeric state loop. It now outputs the trace table, final `last` value and `iterations`.
- `sequence.map_expression`, `sequence.reduce`, `sequence.accumulate`: independent Map / terminal Reduce / running Accumulator semantics.

Ordinary graph cycles remain invalid. Stateful iteration is represented by the explicit While-State contract rather than a special loop-back edge.

## Notebook compiler status

The 1.4.95–1.4.99 lossless Notebook/environment work remains the base: direct `.ipynb` and Notebook-panel import use one compiler path, imports are managed in Workflow Environment, pure comment cells do not pollute the canvas, and unsupported code remains executable Python.

1.5.1 adds strict loop classification:

- `result = []; for item in <proven numeric list>: result.append(<portable numeric expression>)` → `sequence.map_expression`.
- `total = 0; total += item` and `product = 1; product *= item` → `sequence.reduce`.
- the same identity aggregation plus `history.append(total)` → `sequence.accumulate`, binding history to `output` and the scalar final state to `last`.
- single-state numeric `while` → `logic.while_number` only when the initial value is static, the condition/update use only that state and numeric operators, the body is exactly one update, and simulation proves termination within 10,000 iterations.

Known numeric-list literals are retained conservatively across cells. Reassignment invalidates the static literal context. Unknown iterables, external names, non-identity aggregations, side effects, multiple While statements, `while ... else`, non-finite states and non-terminating loops remain Python.

## JavaScript parity

The shared control-expression language no longer uses JavaScript string rewriting / `new Function`. A deterministic parser now implements the same limited language as Python: numbers, `value`, `iteration`, arithmetic, comparisons, `and` / `or` / `not`, Python `//`, Python signed `%`, and right-associative `**`. Boolean operators short-circuit, including inactive unsupported names or division-by-zero branches.

Current runtime parity: **81/81** golden workflows; JS-capable NodeContract coverage: **84/84**. New parity cases cover floor/modulo, exponentiation, short-circuit evaluation and the `logic.while_number.last` side port.

## Validation at this checkpoint

- Python: **149 passed, 1 skipped**.
- Runtime parity: **81/81**.
- JS-capable NodeContract coverage: **84/84**.
- Runtime Engine architecture: pass.
- NodeContract architecture: pass.
- Workflow Core architecture: pass.
- Strict Workflow Compatibility TypeScript gate: pass.
- Version sync: **1.5.1 / Android 124**.

The supplied development ZIP has no `node_modules`, so the full pinned package build / Vitest suite still belongs on the dependency-installed build machine. Runtime parity itself transpiles and executes both Python and JavaScript implementations and is passing.

## Corpus note

The 186-Notebook external corpus used by earlier audits is not included in this ZIP. `scripts/audit-notebooks.py` now reports `controlScopes`, `controlLowerings` and `controlCarriers`; rerun it when the corpus is available rather than inventing coverage numbers.

## Recommended next step

1. Run the 186-Notebook corpus through the enhanced audit and inspect the remaining retained top-level and inside-function control carriers.
2. Promote reusable Python function bodies into Workflow Functions only when every internal operation has a portable NodeContract and the function boundary can preserve inputs/outputs exactly.
3. Add more loop patterns only when they map to existing Map / Reduce / Accumulator / For Each / While semantics without hidden state.
4. Introduce explicit Delay/Feedback only if real workflows require previous-iteration state beyond `logic.while_state`; never relax ordinary DAG cycle validation.
