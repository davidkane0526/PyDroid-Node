# Current development handoff — 1.4.96 Notebook dataflow + native lowering

Branch: `feature/1.4.96-notebook-dataflow`
Version: **1.4.96**
Android versionCode: **119**
Build revision: `1.4.96-dev-r74-notebook-dataflow`

## Authoritative baseline

Read `docs/BASELINE.md` first. The architecture baseline remains 1.4.92, the physically accepted Remote/LAN anchor remains 1.4.91, and the 1.4.94 read-only local tool discovery correction remains retained. 1.4.96 does not change the accepted Remote Web startup path, LAN discovery ownership or build-tool selection policy.

## 1.4.96 Notebook compiler state

- Jupyter import remains lossless: every executable operation is either promoted to an equivalent workflow node or retained as executable Notebook Python.
- Imported workflows now distinguish executable data edges from Notebook visual dependency edges. Native-to-native dataflow stays a normal edge; namespace-variable, dynamic-parameter and source/provenance relations are visible dashed edges and are ignored by both Python and JavaScript runtime topology.
- Cross-runtime graph semantics are aligned: visual Notebook edges cannot introduce false inputs, false ordering or cycles in either runtime.
- Native nodes can bind data expressions and parameters from the shared Notebook namespace without reverting to `function.call` solely because an argument is dynamic.
- Safe helper functions are lowered by AST implementation pattern, never by function name alone.
- New cross-runtime native helpers: `table.periodic_group_mean`, `table.row_chunks_to_columns`, `stats.column_group_cv`, `sequence.consecutive_segments`, and `sequence.filter_short_segments`.
- `table.row_chunks_to_columns` canonicalizes concatenated chunk columns to deterministic unique names (`name_1`, `name_2`, ...). This is the native cross-runtime table contract; the real Notebook corpus uses the promoted `Splite` outputs positionally, so this normalization does not alter the validated corpus behavior.
- Existing periodic helpers (`table.periodic_window`, `table.periodic_tail_mean`) now accept safe Notebook expression/parameter bindings, allowing more `Pick_*` / `Split_*` helpers to become native nodes instead of function black boxes.
- `function.call` remains for genuinely specialized operations rather than being forced to zero. In the real corpus only directory CSV merge, `VthGet`, and image merge remain direct calls.
- `function.map` remains Python-only for the currently proven list-comprehension and map + column-concat patterns. General Python loops are not falsely mapped to table-oriented control nodes.

## Real corpus evidence

External regression corpus (not copied into the product tree):

- 186 `.ipynb` files
- 1,593 cells: 1,443 code + 150 Markdown
- 5,418 top-level Python operations
- 5,418/5,418 classified or losslessly carried; 0 analyzer failures
- 6,150 dependency/provenance relations found
- 5,242/5,418 operations have at least one traceable dependency/provenance relation; 176 are independent definitions/imports/constants/expressions
- 266 top-level function definitions; 262 safely promotable; 110 have at least one proven output type
- direct `function.call`: **3** (down from 105 before native lowering)
- `function.map`: 18, including 11 strict map + `concat(axis=1)` loops
- native semantic operations: 1,804; lossless code carriers: 3,614
- Windows-specific path cells: 194
- Android review dependencies: `scipy` (19 notebooks), local `Tools` (4), `import_ipynb` (2), `PIL` (1)

Run the corpus audit with:

`pnpm audit:notebooks -- <notebook-directory> --json`

## Validation completed in this environment

- Python suite: **136 passed, 1 skipped**.
- Runtime parity golden corpus: **73/73**.
- JavaScript-capable NodeContract parity coverage: **80/80**.
- Baseline consolidation, build-tool architecture, PlatformAdapter, Host Contract, Remote Web, real HTTP 8765 Remote Host E2E, LAN boundary/selection, workflow history, Phase 11 compatibility, Workflow Core, Editor Core, Runtime Engine and Node Contract smokes pass.
- Strict Phase 11 TypeScript check passes.
- Modified front-end/Notebook files pass TypeScript 5.8 `--noCheck` syntax compilation.
- Version sync passes at **1.4.96 / Android 119**.
- Full project `pnpm build` / Vitest is not claimed in this container because the clean project ZIP intentionally has no `node_modules` and the available environment is Node 22 / TypeScript 5.8 rather than the pinned Node 24.19 / TypeScript 7 toolchain.

## Next development step

The next architecture layer should improve general iterative expressiveness without weakening deterministic execution: first-class Map / Reduce / Accumulator, then explicit State / Delay / Feedback semantics. A feedback edge must represent previous-iteration state (`n -> n+1`), not an ordinary data edge that creates an ambiguous current-iteration cycle. Keep the current priority invariant: native nodes when equivalence is provable, executable Python otherwise.
