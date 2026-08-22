# Current development handoff — 1.5.0 Generic Control Flow

Branch: `feature/1.5.0-generic-control-flow`
Version: **1.5.0**
Android versionCode: **123**
Build revision: `1.5.0-dev-r78-generic-control-flow`

## Non-negotiable rules for continuation

1. Work from the supplied local ZIP. Do **not** use GitHub as the development source.
2. JavaScript execution is a golden rule. A new native node/control structure is incomplete until Python and JavaScript implementations both exist and a parity golden workflow passes.
3. Do not reintroduce the retired DataFrame control structures `logic.if_subflow`, `logic.for_each_subflow`, or `logic.while_subflow`, including aliases, migrations, compatibility shims, hidden bridges, or importer rewrites.
4. Table-specific branching remains a data operation (`table.split_condition` / `table.merge_rows`), not a control-flow primitive.
5. Notebook conversion remains correctness-first: if equivalence cannot be proven, retain executable Python rather than generating a misleading visual structure.
6. Remote Web/LAN production paths are accepted baselines and are unrelated to the control-flow work; do not redesign them while continuing this phase.

## 1.5.0 control-flow model

### Generic If

`logic.if_value`

- Inputs: `condition:any`, optional `input:any` context.
- Executes only one child branch (`true` or `false`).
- Outputs: `done`, `true`, `false`.
- Python and JavaScript use aligned cross-runtime truthiness semantics.

### Generic For Each

`logic.for_each_value`

- Input: arbitrary iterable value supported by the runtime (list/tuple-like data, table rows, text, object keys; JSON transport normalizes portable container forms).
- Child branch: `body`.
- Outputs: collected `done:list`, `last`, `lastItem`.
- Notebook lowering is conservative: only stateless loops with a fully structured body are promoted. File-I/O loops and loop-carried state remain Python.

### Generic While State

`logic.while_state`

- Input is explicit state.
- The body result becomes the next iteration state.
- Condition modes: expression / truthy / non-empty.
- Output: `done` final state and `iterations`.
- Maximum iteration bound is mandatory; ordinary cyclic data edges remain forbidden.

### Map / Reduce / Accumulator

Keep these separate from For Each:

- `sequence.map_expression`: independent per-item transformation.
- `sequence.reduce`: terminal aggregation.
- `sequence.accumulate`: running aggregation/state history.

The next compiler work should classify Python loops among Map / Reduce / Accumulator / For Each before considering a more general State/Feedback layer.

## Removed legacy control-flow behavior

The old DataFrame visual structures are deleted rather than migrated:

- `logic.if_subflow`
- `logic.for_each_subflow`
- `logic.while_subflow`

The special graph loop-back handling and `continue` edge exception were removed. Editor connection validation again rejects ordinary cycles uniformly. The former historical logic-control fixture was deleted and is no longer a compatibility requirement.

`logic.for_range` and `logic.while_number` remain because they are deterministic numeric primitives, not the removed DataFrame subflow structures.

## JavaScript parity status

At this checkpoint:

- Runtime parity golden workflows: **77/77**.
- JS-capable NodeContract coverage: **84/84**.
- Generic control golden cases cover selected-branch If, list-collecting For Each, and stateful While.
- `function.map` retained portable modes execute in JavaScript as well as Python; the former Python-only `concat_columns` mode has been removed.

Do not weaken this gate. Do not mark a new node as Python-only merely to make Notebook lowering easier; either build the cross-runtime native contract or retain Python code until a portable native design exists.

## Notebook compiler status

The 1.4.95–1.4.99 lossless Notebook compiler/environment work remains the base:

- blank cells removed;
- one-line heading/comment cells folded conservatively;
- top-level static imports managed in per-tab Environment;
- safe setup parameters/functions extracted from computation canvas;
- native dependency/provenance links retained;
- unsupported semantics remain executable Python carriers.

1.5.0 begins native control-flow lowering. It currently promotes only safe scalar `if` and stateless iterable `for` subsets. Generic `while` promotion remains intentionally conservative until state-update extraction can be proven equivalent.

## Validation at this checkpoint

Completed in the local clean source environment before packaging:

- Python: **141 passed, 1 skipped**.
- Runtime parity: **77/77**.
- JS-capable NodeContract coverage: **84/84**.
- NodeContract architecture and Runtime Engine architecture pass.
- Baseline, Build Tool, UI regression, PlatformAdapter, Host Contract, Remote Web, real HTTP 8765 E2E, Android Remote Host JVM, LAN boundary/selection, diagnostics, execution-controller/scheduler, Desktop/Android host architecture pass.
- General workflow schema/function migration smoke and strict TypeScript compatibility smoke remain available, but the historical all-Git workflow corpus is no longer a gate because retired control nodes are intentionally unsupported.

The supplied ZIP still has no `node_modules`; full pinned Node 24.19 / TypeScript 7 `pnpm build` and platform packaging should be run on the user's build machine.

## Recommended next step

1. Run the 186-Notebook corpus audit and measure how many top-level/inside-function `if`/`for`/`while` constructs can be safely classified.
2. Add native compiler patterns for loop `append` → Map, scalar aggregation → Reduce, and running aggregation → Accumulator.
3. Compile reusable Python function bodies into Workflow Functions when all internal operations have portable NodeContracts.
4. Only then add explicit State / Delay / Feedback semantics. Feedback must mean prior-iteration state, never an ordinary current-iteration cyclic edge.
