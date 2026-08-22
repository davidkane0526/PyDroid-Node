# Current development handoff — 1.4.99 Reliable Notebook import + native sequence flow

Branch: `feature/1.4.99-notebook-import-native-flow`
Version: **1.4.99**
Android versionCode: **122**
Build revision: `1.4.99-dev-r77-notebook-import-native-flow`

## Authoritative baseline

Read `docs/BASELINE.md` first. The architecture baseline remains 1.4.92, the physically accepted Remote/LAN anchor remains 1.4.91, and the 1.4.94 read-only local-tool discovery correction remains retained. 1.4.99 does not modify the accepted Remote Web/LAN production path. Development in this line was performed only from the supplied local ZIP; no GitHub access is required for continuation.

## 1.4.99 Notebook import contract

- Direct `.ipynb` import, Notebook-toolbar import and "Apply to node view" use the same `compileNotebookDocument` path.
- Notebook visual edges (`notebook-order`, `notebook-variable`, `notebook-parameter`, `notebook-provenance`) use hidden ReactFlow anchors and are never validated as ordinary NodeSpec ports. This fixes the former `__notebook_order_out` direct-import failure.
- Import failures populate `executionError`, restoring the clickable bottom-status error-details dialog.
- Before analysis, Notebook cells are normalized conservatively: blank cells disappear; consecutive single-line Markdown headings / Python comments immediately before code are folded into the following code cell. Multi-line Markdown and executable boundaries remain.
- Long code cells are compiled from Python AST top-level statements whenever statement analysis exists. This creates multiple workflow steps without unsafe textual slicing through functions, loops, parentheses or expressions.
- Every top-level static import is stored in per-tab Workflow Environment. Function-local, conditional and dynamic imports remain in executable code scope.
- Notebook-derived Workflow Environment continues to pin Auto execution to Python semantics.

## UI / Android export

- Notebook heading text is compact/two-line so the toolbar buttons have more room.
- Node/group `▶` controls are flat, theme-aware and shadow-free.
- The floating Environment control/panel is theme-consistent and closes on a canvas click while retaining geometry/occlusion-aware placement.
- Resource-palette resize handle now has the same usable hover-highlight hit area as the inspector handle.
- `downloadText` delegates to the platform adapter. Android therefore calls `PythonExecutor.exportTextFile`, which launches Storage Access Framework `ACTION_CREATE_DOCUMENT` and writes through `ContentResolver`; export-node CSV artifacts use "保存" on Android rather than a browser-only Blob link.

## Native Map / Reduce / Accumulator foundation

New cross-runtime native nodes:

- `sequence.map_expression`: safe per-item expression over a numeric list (`value`, `iteration`).
- `sequence.reduce`: sum / mean / min / max / product / count.
- `sequence.accumulate`: running sum / product / min / max.

They have Python and JavaScript handlers, NodeSpec contracts, Workflow→Notebook serialization and parity golden cases. Arbitrary feedback loops are still intentionally absent. State / Delay / Feedback must remain explicit prior-iteration semantics rather than ordinary cyclic data edges.

## Real Notebook corpus evidence

External corpus (not copied into the product tree):

- 186 `.ipynb` files
- Original cells: 1,593
- Normalization: **195 blank cells removed, 146 one-line heading/comment cells folded**
- Normalized cells: **1,252**
- Top-level Python operations: **5,418 / 5,418 covered**, 0 failures
- Managed top-level imports: **288**
- Managed leading static workflow parameters: **310**
- Managed leading reusable function definitions: **81**
- Managed context operations: **679**
- Canvas operations after context extraction: **4,739**
- Semantic/native operations: **1,804**; lossless code carriers: **3,614**
- Direct `function.call`: **3**; `function.map`: **18**
- Dependency/provenance links: **6,150**; linked operations: **5,242**; truly independent operations: **176**
- Windows-path cells: **194**

Run:

`python scripts/audit-notebooks.py <notebook-directory> --json`

## Validation completed in this environment

- Python: **139 passed, 1 skipped**.
- Runtime parity: **76/76**.
- JS-capable NodeContract parity coverage: **83/83**.
- UI regression, Baseline Consolidation, Build Tool Architecture, PlatformAdapter, Host Contract, Remote Web, real HTTP 8765 E2E, Android Remote Host JVM, LAN boundary/selection pass.
- Workflow history, Phase 11 compatibility + strict TypeScript contract, Workflow Core, Editor Core, Execution/Desktop/Android Host, Runtime Engine and Node Contract architecture smokes pass.
- Modified TypeScript/TSX files parse with 0 syntax diagnostics under the available TypeScript 5.8 parser.
- Full project `pnpm build` / Vitest is not claimed in this container because the supplied clean project has no `node_modules` and the available toolchain is Node 22 / TypeScript 5.8 instead of the project's pinned Node 24.19 / TypeScript 7 line.

## Next development step

Physically validate direct `.ipynb` import, Android SAF export and the refreshed Environment/node-run UI. Then continue native compiler lowering onto Map / Reduce / Accumulator, followed by an explicit State / Delay / Feedback layer. Do not reintroduce generic Python `if/for/while` as table-subflow nodes and do not create ordinary cyclic data edges.
