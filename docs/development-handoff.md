# Current development handoff — 1.4.95 lossless Notebook compiler foundation

Branch: `feature/1.4.95-notebook-compiler`
Version: **1.4.95**
Android versionCode: **118**
Build revision: `1.4.95-dev-r73-notebook-compiler`

## Authoritative baseline

Read `docs/BASELINE.md` first. The architecture baseline remains 1.4.92, the physically accepted Remote/LAN anchor remains 1.4.91, and the 1.4.94 read-only local tool discovery correction remains retained. 1.4.95 does not alter Remote Web, LAN discovery, build tool selection or packaging behavior.

## 1.4.95 Notebook compiler state

- Jupyter import is now hybrid and lossless: every executable statement is either represented by an equivalent workflow node or retained as an executable `notebook.code_cell` fragment.
- Native workflow nodes and code carriers share one Notebook namespace through explicit input/output variable bindings.
- Top-level `def` statements remain in that namespace. Safe definitions additionally become document-level workflow functions; direct call sites can become `function.call` nodes.
- Generated function ports use `Any` unless the structure is certain. The compiler no longer guesses unannotated scalar/table types.
- Function defaults, literal arguments, safe expressions and free-global dependencies are explicit call bindings.
- Functions requiring unsupported custom-node semantics (`open`, generators, `global/nonlocal`, decorators or `*args/**kwargs`) remain lossless code instead of being falsely promoted.
- Ordinary Python `if`/`for`/`while` stays Python because the current visual control nodes are table-oriented, not general Python control-flow equivalents. Only dedicated patterns with proven equivalence are promoted.
- The first dedicated loop pattern is `function.map` with `collectMode=concat_columns`, covering strict `for item in items` + user-function + `pd.concat(..., axis=1)` aggregation while preserving the initial accumulator and optional final temporary value.
- Notebook cell index and statement/child operation indexes are now independent and deterministic.

## Real corpus evidence

The uploaded scientific workspace was used only as an external regression corpus, not copied into the product tree:

- 186 `.ipynb` files
- 1,443 code cells + 150 Markdown cells
- 5,418 top-level operations
- 0 analysis failures
- 266 top-level user-function definitions
- 262 safe function definitions promotable
- 105 of 108 direct calls to previously defined user functions promoted to `function.call`; the remaining 3 use `open()` and remain lossless Python
- 18 Python-only `function.map` operations promoted: 7 strict list-comprehension mappings plus 11 strict map + column-concat loops
- 194 code cells contain Windows-specific paths
- Android dependency review set from the corpus: `scipy` (19 notebooks), local `Tools` (4), `import_ipynb` (2), `PIL` (1)
- all remaining operations have an explicit lossless code/Markdown carrier

Run an equivalent corpus audit with:

`pnpm audit:notebooks -- <notebook-directory> --json`

## Validation completed in this environment

- Python suite: **125 passed, 1 skipped** after the loop-aggregation/correctness pass.
- Real-workspace compiler audit: **186/186 notebooks, 5,418/5,418 operations classified, 0 failures**.
- Baseline consolidation, Workflow Core, Node Contract and Runtime Engine architecture smokes pass.
- Runtime parity golden corpus remains **68/68** with JS-capable NodeContract coverage **75/75**.
- Version sync passes at **1.4.95 / Android 118**.
- Global TypeScript 5.8 syntax parsing reports no syntax diagnostics for the modified Notebook compiler files, but the full project TypeScript/Vitest build cannot run in this container because the ZIP intentionally contains no `node_modules` and the project requires its pinned Node 24 / TypeScript 7 toolchain.

## Next development step

Continue improving **semantic promotion coverage**, not by adding lossy heuristics. The next useful targets are nested function calls and iterator-index transforms that can be represented explicitly without changing Python evaluation order. Platform dependency reporting is implemented and should remain diagnostic rather than a runtime gate. Preserve the invariant: 100% source semantics first, visual-node coverage second.
