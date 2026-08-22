# Current development handoff — 1.5.10 Notebook / JS parity cleanup

Branch: `feature/1.5.10-notebook-parity-cleanup`
Version: **1.5.10**
Android versionCode: **133**
Build revision: `1.5.10-dev-r89-notebook-parity-cleanup`

## Non-negotiable continuation rules

1. Work from the supplied local project ZIP, not GitHub.
2. JavaScript portability is a golden rule: native JS-capable nodes require Python/JavaScript semantic parity, including relevant parameter combinations.
3. Notebook conversion is correctness-first. Unproven code remains executable Python instead of being force-lowered.
4. Do not restore removed `logic.*_subflow`, retired `notebook.*_block`, hidden source-execution bridges, name-triggered scientific helper lowering or edge-order port guessing.
5. Do not delete persistent workflow schema migrations/future-version protection; these protect user data and are distinct from obsolete runtime bridges.
6. Remote Web/LAN production paths are accepted baselines. Unrelated compiler/runtime work must not redesign them.

## Notebook/Jupyter state

Both `.ipynb` entry points use the same parse → analyze → compile → install path. Managed imports are deduplicated. Pure comments, bare-string annotations and triple-quoted explanation-only code cells are classified as `AnnotationOnly` and do not create executable canvas nodes; original Notebook cells remain in environment metadata for round-trip preservation.

Top-level and portable-function lowering currently covers proven native chains plus Map / Reduce / Accumulator and strict If / For / finite numeric While structures. Unsupported/dynamic/free-global/side-effecting cases retain Python.

Removed in 1.5.10:

- generic `notebookSource` execution on arbitrary native nodes;
- `notebook.if_block`, `notebook.for_block`, `notebook.while_block`;
- `table.group_mean` compatibility alias;
- over-specialized `table.periodic_group_mean`;
- function-name-triggered lowering for project-specific helpers;
- multi-input `left/right` guessing from edge insertion order.

## Python / JavaScript parity

NodeContract now has A/B/C parity classes and a parameter-level runtime compatibility gate. Auto mode chooses JavaScript only when the node and current parameters are portable.

Checkpoint results:

- Runtime parity: **102/102** golden workflows.
- JavaScript-capable NodeContract coverage: **82/82**.
- Runtime parameter-selection smoke: **6/6**.
- Python suite: **153 passed, 1 skipped**.

1.5.10 specifically tightened CSV/Table semantics including pandas `header="infer" + names`, `nRows`, whitespace, duplicate headers, boolean/mixed inference, usecols ordering, negative slicing/head/tail, bool abs/diff, half-even round, groupby missing keys, column-label sort-index and pivot ordering/text aggregation.

## Validation expected before delivery

In addition to Python/parity tests, run Notebook canonical import, Workflow Compatibility/Core, Runtime Engine, NodeContract, Editor/ownership, UI/Plot/Theme/Demo, Host/Remote/LAN and Execution architecture gates. Finish with `git diff --check`, clean `git status` and `git fsck`.

The development ZIP intentionally excludes `node_modules`; a complete pinned `pnpm` renderer/desktop package build remains the responsibility of a dependency-installed Node 24 build environment. Do not report that build as passing when it was not executed.

## Recommended next step

Do not expand the architecture immediately. Use real Notebook/scientific workflows to identify remaining high-value conversion or parity failures. Fix common exact semantics in native runtimes; gate genuinely pandas/Python-specific parameter combinations to Python. Continue deleting only obsolete execution paths, never user-data migration protection.
