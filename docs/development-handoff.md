# Current development handoff — 1.4.97 Notebook context links + node-scoped execution

Branch: `feature/1.4.97-node-context-run`
Version: **1.4.97**
Android versionCode: **120**
Build revision: `1.4.97-dev-r75-node-context-run`

## Authoritative baseline

Read `docs/BASELINE.md` first. The architecture baseline remains 1.4.92, the physically accepted Remote/LAN anchor remains 1.4.91, and the 1.4.94 read-only local tool discovery correction remains retained. 1.4.97 does not change the accepted Remote Web startup path, LAN discovery ownership or build-tool selection policy.

## 1.4.97 Notebook/editor state

- Jupyter import remains lossless: every executable operation is either promoted to an equivalent workflow node or retained as executable Notebook Python.
- Pure-comment Python cells do **not** generate executable nodes. They are stored as round-trip Notebook content so comments such as `# Python` do not expose meaningless endpoints.
- Import AST analysis records the names actually introduced into Python scope. Aliases from `import` and `from ... import ...` therefore participate in variable/provenance dependency tracking.
- Imported workflows distinguish real executable data edges from visual-only Notebook context edges: namespace-variable, dynamic-parameter, function provenance and execution order. Both runtimes ignore these visual-only edges as data inputs.
- Execution-order edges use hidden, non-connectable handles, so imports/constants/definitions can visibly belong to the Notebook sequence without adding user-facing ports.
- Visual Notebook dependency/order edges do not create group public ports. Cross-group visual context may be summarized at parent level without changing group runtime inputs/outputs.
- Node/group UI dimensions are driven by endpoint count and endpoint-label length. Horizontal nodes primarily grow vertically; vertical nodes primarily grow horizontally.
- Every canvas node and `workflow.group` exposes a compact top-right `▶` scoped-run action.
- `nodeExecutionSubgraph(...)` computes the minimal upstream execution slice. Ordinary flows trace executable data dependencies; Notebook order context is also traced so imports/definitions/constants needed by later code can be reconstructed.
- Group-scoped execution expands group members plus required upstream context. A downstream consumer of a group output expands the group's implementation as part of its upstream slice. Running an individual child inside a group does not automatically execute unrelated siblings.
- Scoped execution updates only nodes inside the execution slice and keeps interactive-node continuation associated with the scoped target.
- Existing native helper lowering remains in place. Real-corpus direct `function.call` count remains **3**; arbitrary Python semantics remain executable code instead of being falsely structured.

## Real corpus evidence

External regression corpus (not copied into the product tree):

- 186 `.ipynb` files
- 1,593 cells: 1,443 code + 150 Markdown
- 63 code cells contain comments only and intentionally do not become workflow nodes
- 5,418 top-level Python operations
- 5,418/5,418 classified or losslessly carried; 0 analyzer failures
- 6,150 dependency/provenance relations found
- 5,242/5,418 operations have at least one traceable dependency/provenance relation; 176 are independent definitions/imports/constants/expressions
- 266 top-level function definitions; 262 safely promotable; 110 have at least one proven output type
- direct `function.call`: **3**
- `function.map`: 18, including 11 strict map + `concat(axis=1)` loops
- Windows-specific path cells: 194
- Android review dependencies: `scipy` (19 notebooks), local `Tools` (4), `import_ipynb` (2), `PIL` (1)

Run the corpus audit with:

`pnpm audit:notebooks -- <notebook-directory> --json`

## Validation completed in this environment

- Python suite: **137 passed, 1 skipped**.
- Runtime parity golden corpus: **73/73**.
- JavaScript-capable NodeContract parity coverage: **80/80**.
- UI regression, Workflow Core, Editor Core, Runtime Engine, Node Contract and version sync pass.
- Baseline consolidation, Host Contract, Remote Web, real HTTP 8765 Remote Host E2E, LAN boundary/selection, workflow history and Phase 11 compatibility smokes pass.
- Strict Phase 11 TypeScript check passes.
- Full project `pnpm build` / Vitest is not claimed in this container because the clean project ZIP intentionally has no `node_modules` and the available environment is Node 22 / TypeScript 5.8 rather than the pinned Node 24.19 / TypeScript 7 toolchain.

## Next development step

First physically validate 1.4.97 node/context execution and adaptive UI. Then continue native Notebook lowering and begin first-class Map / Reduce / Accumulator semantics. State / Delay / Feedback should follow only after those semantics are stable; feedback must represent previous-iteration state (`n -> n+1`) rather than an ordinary current-iteration cycle.
