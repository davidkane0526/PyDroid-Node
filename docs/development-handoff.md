# Current development handoff — 1.5.13 canvas visual alignment + shared guides

Branch: `fix/1.5.13-canvas-visual-alignment`
Version: **1.5.13**
Android versionCode: **136**
Build revision: `1.5.13-dev-r92-canvas-visual-alignment`

## Non-negotiable continuation rules

1. Work from the supplied local project ZIP, not GitHub.
2. JavaScript portability is a golden rule: native JS-capable nodes require Python/JavaScript semantic parity, including relevant parameter combinations.
3. Notebook conversion is correctness-first. Unproven code remains executable Python instead of being force-lowered.
4. Do not restore removed `logic.*_subflow`, retired `notebook.*_block`, hidden source-execution bridges, name-triggered scientific helper lowering or edge-order port guessing.
5. Do not delete persistent workflow schema migrations/future-version protection; these protect user data and are distinct from obsolete runtime bridges.
6. Remote Web/LAN production paths are accepted baselines. Unrelated UI/compiler/runtime work must not redesign them.

## Canvas theme state

`Soft` still uses the user-approved **PyDroid Canvas Theme Lab 1.6.7 · Flat Run Control** material language, but from 1.5.12 canvas themes are explicitly **appearance-only**. `Classic` and `Soft` share the exact production geometry from `styles.css`: node bounds, body layout, typography metrics, port positions, result-preview placement and run-control placement. Theme switching therefore must not move nodes or edge anchors.

Shared visual-geometry refinements retained from 1.5.12:

- endpoint sockets are 16 px at 100% endpoint scale;
- port labels use 10.5 px shared text, with 11 px vertical labels;
- dynamic port-label width budgeting is slightly wider for readability;
- node run action uses one shared 24×24 control in both themes; 1.5.13 replaces the old CSS mark with an exact-centroid SVG play glyph;
- desktop hover / native selected visibility behavior remains unchanged and motion-free.

Canvas settings layout is now intentional: Canvas theme + Mini map share one row, while Result height + Show node results share one row. Theme selectors use compact label-to-dropdown spacing.

1.5.13 visual alignment additions:

- Node run control now uses an SVG whose triangle centroid is exactly the center of its viewBox; Classic and Soft share the same geometry and glyph.
- `canvas-themes.css` no longer styles `.canvas-panel`, the base `.react-flow` background, or `.react-flow__background`; grid/marks/masks therefore remain equally visible when switching themes.
- The floating Environment icon uses a lighter 1.10 stroke without changing the button dimensions.

## Notebook/Jupyter state

Both `.ipynb` entry points use the same parse → analyze → compile → install path. Managed imports are deduplicated. Pure comments, bare-string annotations and triple-quoted explanation-only code cells are classified as `AnnotationOnly` and do not create executable canvas nodes; original Notebook cells remain in environment metadata for round-trip preservation.

Top-level and portable-function lowering currently covers proven native chains plus Map / Reduce / Accumulator and strict If / For / finite numeric While structures. Unsupported/dynamic/free-global/side-effecting cases retain Python.

## Python / JavaScript parity

NodeContract has A/B/C parity classes and a parameter-level runtime compatibility gate. Auto mode chooses JavaScript only when the node and current parameters are portable.

Latest accepted checkpoint before this UI-only change:

- Runtime parity: **102/102** golden workflows.
- JavaScript-capable NodeContract coverage: **82/82**.
- Runtime parameter-selection smoke: **6/6**.
- Python suite: **153 passed, 1 skipped**.

## Validation expected before delivery

Run Canvas Theme/UI regression plus the existing Notebook, Workflow Compatibility/Core, Runtime Engine, NodeContract, parity, Editor/ownership, Plot/Demo, Host/Remote/LAN and Execution architecture gates. Finish with `git diff --check`, clean `git status` and `git fsck`.

The development ZIP intentionally excludes `node_modules`; a complete pinned `pnpm` renderer/desktop package build remains the responsibility of a dependency-installed Node 24 build environment. Do not report that build as passing when it was not executed.

## Recommended next step

1.5.13 further freezes shared canvas guides/background across themes and corrects the run/environment icon optics. After user visual acceptance, proceed to the 1.6.0 release-candidate stabilization matrix instead of adding more architecture.
