# Current progress — 1.4.95 lossless Notebook compiler foundation

Date: 2026-08-21

## Current accepted baseline

- Architecture baseline: **1.4.92 Baseline Consolidation**.
- Windows Remote Web/LAN: **physically verified from an Android tablet on 1.4.91**.
- Build-tool policy: **1.4.94 Local Tool Discovery Correction** retained unchanged.
- Current product version: **1.4.95**, Android versionCode **118**.

## Notebook / Python → Workflow progress

- Jupyter import no longer discards unsupported Python. Mixed conversion always retains an executable code/Markdown carrier for non-promoted content.
- Standard workflow nodes can consume variables from the shared Notebook namespace and publish outputs back to it.
- Safe top-level Python functions can be represented as reusable document workflow functions; direct calls can become `function.call` nodes.
- Safe single-generator list comprehensions and strict map + `pd.concat(axis=1)` loops can become Python-only `function.map` nodes without emulating unsupported Python semantics.
- Jupyter import now produces a conversion-quality report: structural coverage, retained carriers, function promotion, imported modules, Android dependency warnings and Windows-path cells.
- Function types default to `Any` rather than unreliable table/scalar guesses.
- Generic Python `if`/`for`/`while` remains code because the existing visual subflows have table-specific semantics; only dedicated equivalence rules are promoted.
- Multi-cell analysis indexing and control-child node-index collisions are fixed.
- Corpus audit is now a repeatable compiler validation tool.

## External real-workspace regression

- 186 notebooks
- 1,593 total cells / 1,443 code cells
- 5,418 top-level operations
- 0 analyzer failures
- 266 top-level function definitions; 262 safely promotable
- 105 of 108 direct calls to previously defined user functions promoted; the remaining 3 use `open()` and remain lossless Python
- 18 safe user-function mappings promoted to `function.map`, including 11 strict loop + column-concat aggregations
- 194 Windows-path code cells detected
- Android dependency review: `scipy` in 19 notebooks, local `Tools` in 4, `import_ipynb` in 2, `PIL` in 1
- all non-promoted operations remain explicit lossless carriers

## Retained completed architecture

- PlatformAdapter / Host Contract.
- ExecutionController and multi-workspace execution.
- Unified NodeSpec / Node Contract.
- Python/JavaScript parity and modular Runtime Engine.
- Phase 8 workflow language/state/functions.
- Phase 9 Editor Core / Workspace Session.
- Phase 11 Workflow Compatibility & Migration.

## Next

Improve promotion coverage from real scientific Notebook patterns while keeping the lossless-carrier invariant. Remote Web remains accepted infrastructure and is not an active refactor target.
