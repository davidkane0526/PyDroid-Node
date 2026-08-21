# Current progress — 1.4.97 Notebook context links + node-scoped execution

Date: 2026-08-22

## Current accepted baseline

- Architecture baseline: **1.4.92 Baseline Consolidation**.
- Windows Remote Web/LAN: **physically verified from an Android tablet on 1.4.91**.
- Build-tool policy: **1.4.94 Local Tool Discovery Correction** retained unchanged.
- Current product version: **1.4.97**, Android versionCode **120**.

## Notebook / Python → Workflow progress

- Jupyter conversion remains lossless; unsupported/unsafe transformations stay executable Python rather than being dropped or falsely structured.
- Pure-comment Python cells no longer generate canvas nodes or fake endpoints; they are retained for Notebook round-trip.
- Import bindings now declare real aliases (`import pandas as pd` defines `pd`, etc.), so later alias use participates in dependency/provenance analysis.
- Imported workflows distinguish executable data edges from visual namespace/parameter/provenance/order edges. The latter are visible context only and are ignored as runtime data by both Python and JavaScript.
- Notebook setup steps with no ordinary data output can still appear in an explicit execution chain through hidden order anchors, avoiding visually disconnected import/definition nodes without inventing user ports.
- Common user helpers continue to lower into reusable built-ins by AST semantics rather than function name. Direct `function.call` remains at **3** in the real corpus.
- Node/group cards now auto-size from endpoint count and label length so dense port sets do not overlap.
- Every canvas node/group has a compact scoped-run action. A scoped run automatically constructs the target's upstream context; Notebook order context is included and group implementations are expanded when required.

## External real-workspace regression

- 186 notebooks / 1,593 cells
- 1,443 code cells / 150 Markdown cells
- 63 pure-comment code cells intentionally do not become nodes
- 5,418 top-level operations; 5,418 losslessly classified; 0 failures
- 6,150 dependency/provenance relations
- 5,242 linked operations / 176 genuinely independent operations
- 266 top-level functions; 262 safely promotable; 110 with proven output type information
- 3 direct `function.call`
- 18 `function.map`, including 11 strict map + column-concat loops
- 194 Windows-path cells
- Android review dependencies: scipy 19 / Tools 4 / import_ipynb 2 / PIL 1

## Validation

- Python: **137 passed, 1 skipped**
- Runtime parity: **73/73**
- JS-capable NodeContract coverage: **80/80**
- UI regression, Workflow Core, Editor Core, Runtime Engine, Node Contract and version-sync gates pass.
- Baseline, Host Contract, Remote Web, real HTTP 8765 Host E2E, LAN boundary/selection and Phase 11 compatibility gates pass.

## Next

Continue improving native Notebook structure and scoped execution ergonomics. After this layer is physically accepted, build first-class Map / Reduce / Accumulator semantics, followed by explicit State / Delay / Feedback. Do not permit arbitrary ordinary data cycles; feedback must carry prior-iteration state and preserve deterministic execution.
