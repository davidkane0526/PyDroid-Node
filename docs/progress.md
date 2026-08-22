# Current progress — 1.5.1 Notebook loop lowering + JS parity

Date: 2026-08-22

## Accepted baseline

- Product version: **1.5.1**, Android versionCode **124**.
- Build revision: `1.5.1-dev-r79-notebook-loop-lowering`.
- Remote Web/LAN production paths were not changed in this milestone.
- Retired DataFrame control nodes remain deleted with no compatibility bridge.

## Completed in this milestone

- Strict Python loop classification to native Map / Reduce / Accumulator.
- Conservative static literal context across Notebook cells.
- Statically proven finite single-state numeric While → `logic.while_number`.
- `logic.while_number`: trace + final state + iteration count outputs.
- `sequence.accumulate`: running list + final state output, including empty sum/product identities.
- Deterministic JavaScript guarded-expression parser with Python-compatible `//`, `%`, `**` and short-circuit boolean evaluation.
- Python exporter correctly routes side ports for native nodes with `output` plus additional outputs.
- Notebook audit reports control scopes, native lowerings and retained control carriers.

## Validation

- Python: **149 passed, 1 skipped**.
- Runtime parity: **81/81**.
- JS-capable NodeContract coverage: **84/84**.
- Runtime Engine / NodeContract / Workflow Core / strict workflow-compatibility architecture gates: pass.
- Version sync: pass.

## External corpus

The prior 186-Notebook corpus is not bundled in this source ZIP, so no new corpus conversion percentage is claimed. Run the enhanced audit when that corpus is available.

## Next

Use the corpus to identify remaining real control-flow carriers, then promote reusable Python function bodies only when their complete internal graph is portable. Do not add compatibility layers or generic graph cycles merely to increase visual conversion coverage.
