# Current progress — 1.4.96 Notebook dataflow + native lowering

Date: 2026-08-21

## Current accepted baseline

- Architecture baseline: **1.4.92 Baseline Consolidation**.
- Windows Remote Web/LAN: **physically verified from an Android tablet on 1.4.91**.
- Build-tool policy: **1.4.94 Local Tool Discovery Correction** retained unchanged.
- Current product version: **1.4.96**, Android versionCode **119**.

## Notebook / Python → Workflow progress

- Jupyter conversion remains lossless; unsupported/unsafe transformations stay executable Python rather than being dropped or falsely structured.
- Auto-connect now exposes native dataflow plus Notebook variable, parameter and provenance dependencies.
- Visual dependency edges are explicitly non-executable in both Python and JavaScript graph topology, so they cannot alter inputs, ordering or cycle detection.
- Dynamic Notebook expressions can bind native node data/parameters through the shared namespace.
- Common user helpers are lowered by AST semantics into reusable built-ins rather than recognized by function name.
- New native cross-runtime nodes: periodic group mean, row chunks to columns, column-group row CV, consecutive integer segments and short-segment filtering.
- Direct user-function black boxes in the real corpus have fallen from 105 to **3**; the remaining functions represent filesystem I/O, domain analysis and image I/O and are intentionally not disguised as generic table nodes.
- General Python loops and conditions remain code unless an equivalence rule is proven. Safe list mapping and map + column-concat remain explicit `function.map` patterns.
- Import quality reporting now includes dependency connectivity in addition to semantic promotion, retained carriers, platform dependencies and Windows paths.

## External real-workspace regression

- 186 notebooks / 1,593 cells
- 5,418 top-level operations; 5,418 losslessly classified; 0 failures
- 6,150 dependency/provenance links
- 5,242 linked operations / 176 genuinely isolated operations
- 266 top-level functions; 262 safely promotable; 110 with proven output type information
- 3 direct `function.call`
- 18 `function.map`, including 11 strict map + column-concat loops
- 194 Windows-path cells
- Android review dependencies: scipy 19 / Tools 4 / import_ipynb 2 / PIL 1

## Validation

- Python: **136 passed, 1 skipped**
- Runtime parity: **73/73**
- JS-capable NodeContract coverage: **80/80**
- Remote 8765/LAN, Phase 11 compatibility, Workflow Core, Editor Core, Runtime Engine, Node Contract and version-sync gates pass.

## Next

Build first-class Map / Reduce / Accumulator semantics, followed by explicit State / Delay / Feedback. Do not permit arbitrary ordinary data cycles; feedback must carry prior-iteration state and preserve deterministic execution.
