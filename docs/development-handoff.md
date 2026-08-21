# Current development handoff — 1.4.98 Workflow Environment + clean computation canvas

Branch: `feature/1.4.98-workflow-context`
Version: **1.4.98**
Android versionCode: **121**
Build revision: `1.4.98-dev-r76-workflow-environment`

## Authoritative baseline

Read `docs/BASELINE.md` first. The architecture baseline remains 1.4.92, the physically accepted Remote/LAN anchor remains 1.4.91, and the 1.4.94 read-only local tool discovery correction remains retained. 1.4.98 does not change the accepted Remote Web startup path, LAN discovery ownership or build-tool selection policy.

## 1.4.98 Workflow Environment

- Notebook import is still lossless, but the compiler now distinguishes **environment/setup semantics** from **computation-canvas semantics**.
- Only the leading static setup prelude is hoisted. Safe top-level imports, leading static parameters and safely promoted function definitions leave the canvas while preserving source order in persistent workflow environment metadata.
- Later imports/assignments/definitions remain executable code at their original position. Visual cleanup must never move Python statements across computation.
- `environment.sourceLanguage = "python"` pins Notebook-derived Auto execution to Python semantics even when every remaining native node also supports JavaScript.
- Notebook interactive execution uses the visible Notebook source as authority. Node-view execution uses Workflow Environment; setup is not silently pre-executed twice.
- The left resource palette is again **Nodes → Functions → Groups → Flows**. Environment is not a resource category.
- Each active editor tab exposes one floating **Environment** control inside its canvas. Imports, workflow parameters, runtime workspace variables and requirements belong there.
- Floating Environment placement is geometry-driven. It measures the actual `.canvas-panel` and avoids visible toolbar, minimap, breadcrumb, group-interface and collapsed-panel overlays. Inspector/result docking reduces the canvas itself and therefore automatically reduces the eligible placement region.
- Tab switching changes the Environment because the active `EditorWorkspaceSession` remains the source of truth; no global shared Environment state is introduced.
- **Functions** are reusable, versioned subflows with explicit input/output contracts. They are for calling the same validated node logic from multiple places. **Groups** remain primarily a canvas organization/subflow boundary. Runtime workspace variables therefore belong to Environment, not Functions.

## Notebook compiler evidence

External regression corpus (not copied into the product tree):

- 186 `.ipynb` files
- 1,593 cells: 1,443 code + 150 Markdown
- 5,418 top-level Python operations
- Safe setup-hoisting snapshot from the current compiler: 238 imports + 310 leading static parameters + 81 leading function definitions = **629 operations** removed from computation canvas
- Remaining canvas/code operations: **4,789**
- 74 setup-only code cells can disappear from the computation canvas entirely
- Arbitrary later Python setup remains lossless code instead of being eagerly hoisted

Run the corpus audit with:

`pnpm audit:notebooks -- <notebook-directory> --json`

## Validation completed in this environment

- Python suite: **138 passed, 1 skipped**.
- Runtime parity golden corpus: **73/73**.
- JavaScript-capable NodeContract parity coverage: **80/80**.
- Real Notebook corpus: **186/186**, 5,418/5,418 operations covered, 629 safe setup operations managed outside the canvas, 0 analyzer failures.
- UI regression, Baseline Consolidation, Workflow Core, Editor Core + Phase 9 ownership, Runtime Engine, Node Contract and version sync pass.
- Host Contract, Remote Web, real HTTP 8765 Remote Host E2E, Android Remote Host JVM E2E, LAN boundary/selection, workflow history and Phase 11 compatibility/typecheck smokes pass.
- Modified TypeScript/TSX production files parse with **0 syntax diagnostics** under the available TypeScript 5.8 parser.
- Full project `pnpm build` / Vitest is not claimed in this container because the clean project has no `node_modules` and the available Node/TypeScript toolchain differs from the pinned project toolchain.

## Next development step

Physically validate the 1.4.98 Environment placement and Notebook-to-clean-canvas behavior first. After acceptance, continue the planned native control/dataflow layer: Map → Reduce → Accumulator, then explicit State / Delay / Feedback. Feedback must carry previous-iteration state (`n → n+1`) rather than create an ambiguous ordinary data edge cycle.
