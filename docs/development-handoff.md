# Current development handoff — 1.6.43 Node Layout Balance

Branch: `feature/node-layout-balance`
Version: **1.6.43**
Android versionCode: **183**
Build revision: `1.6.43-dev-r138-node-layout-balance`

## Current phase

PyDroid Node remains in release convergence. The requested **unified plugin/theme Design SDK with material + motion + deterministic node layout** is now implemented and source-validated. The remaining release work is pinned-toolchain Windows/Android packaging plus final physical acceptance; do not add a new runtime, recovery path or unrelated product feature.

## Non-negotiable continuation rules

1. Work from the supplied local project ZIP, not an older remote copy.
2. JavaScript portability remains a golden rule. A node may advertise JavaScript only when its active parameter combination has proven Python/JavaScript semantic parity.
3. Do not reintroduce removed Notebook/runtime bridges, DataFrame-specific control structures, edge-order port guessing, readiness/recovery state machines, firewall/UAC automation, build retries, or post-failure tool switching.
4. Keep persistent workflow/resource migrations and future-version rejection. Those protect user data and are not optional defensive code.
5. Keep the accepted Remote Web/LAN production path unchanged unless a reproduced defect directly requires a fix.
6. Public SDK surfaces are not dead code merely because the first-party application has no internal caller. `sdk/index.ts`, NodeSpec registration and Runtime Provider authoring APIs are third-party entry points.
7. Do not add user-facing explanatory UI copy without explicit approval.

## Current architecture checkpoint

- Dynamic NodeSpec/Node Contract: parameter sockets, repeated inputs, variants, loop/if zones, series/legend metadata and scientific column pipelines.
- NodeSpec SDK: **v7**; combined Plugin SDK: **v4**; UI Theme SDK: **v2**; Unified Design SDK: **v1**.
- Plugin path: JSON Manifest or `.plugin.zip` -> NodeSpec + JavaScript/Python Runtime Providers + persisted read-only resources and/or token-only UI themes -> enable/disable/uninstall/restore.
- Theme/design boundary: semantic color + material + motion tokens only. Core owns selectors, component rendering, spacing, dimensions, typography metrics, responsive geometry and all node layout.
- Node layout: `src/nodes/layout.ts` is the single measurement contract. Horizontal dynamic nodes use deterministic side rails/fixed rows; vertical dynamic nodes preserve top-to-bottom sockets and render editable socket defaults/inline controls as compact aligned form rows.
- Declarative plugin UI: host-rendered parameter groups, conditions, linked options, numeric constraints, read-only/disabled states, validation hints and bounded result/output-port status.
- MCP: Desktop/Android Streamable HTTP host on port 8766 with renderer-side Core adapter; no second workflow state owner.
- Runtime parity revalidated in 1.6.43: **134/134** golden workflows; JavaScript-capable NodeContract coverage **96/96**.
- Python suite revalidated in 1.6.43: **188 passed, 1 skipped**.
- Built-in Demo smoke revalidated in 1.6.43: **38/38**.




## 1.6.43 horizontal node balance

- Complex horizontal nodes are Rail-driven rather than title+Rail additive, eliminating large unused center/right space.
- Header label and metadata use the full node-card center axis.
- Inline parameters share the exact label/control columns used by Socket defaults; `table.pivot` exposes `聚合`, heatmap exposes `配色`.
- Simple horizontal nodes use a tighter content-fit budget; the node-scoped run action is smaller/lighter.
- Runtime, vertical form, Theme/Design SDK, MCP and Remote/LAN behavior are unchanged.

## 1.6.42 node-layout refinement

- Horizontal complex nodes now share one measured control column between socket-default rows and hidden-label inline controls such as aggregate/color-map selectors.
- Simple horizontal nodes use compact content-fit width instead of the structured dynamic-node width budget.
- Dynamic side-rail titles/descriptions compensate for asymmetric rail widths and align to the visual center of the full card.
- Added shared Core `NumericInput`; node inline number controls and Inspector number fields no longer expose Chromium's oversized native spinner.
- Port-label CSS is scoped to the explicit `.node-port-label` element so nested control spans remain normal component content.
- No runtime, Theme/Design default, vertical form, Remote/LAN or MCP production behavior changed.


## 1.6.41 horizontal dynamic-node correction

- Fixed the wide-screen `@media (min-width: 1200px)` rule that replaced measured dynamic-node height with a fixed 62 px minimum and caused Rows/Min/Max socket rows to render below the card border.
- Horizontal dynamic nodes now expose an explicit side-rail layout class and directly preserve `--node-min-height`.
- Input and output rails are centered independently by their own port counts; a single output is vertically centered even when the node has many inputs.
- Added a real `plot.heatmap`-shaped layout regression asserting that all horizontal socket rows remain inside the card.
- Vertical form layout and the protected `core.default` visual baseline are unchanged.

## 1.6.40 vertical dynamic-node correction

- Dynamic nodes now respect the requested canvas direction instead of forcing horizontal orientation whenever dynamic UI is present.
- Vertical mode uses top input sockets, bottom output sockets and a bounded-width internal form for socket defaults/inline controls; node height grows deterministically with form rows.
- Horizontal mode keeps the existing side-rail contract, including endpoint-scale-aware row spacing.
- `core.default` visual compatibility remains protected; no Theme/Material/Motion default was changed.
- Revalidated in 1.6.40: Node Layout, Visual Baseline, UI regression, Canvas 22/22, Plugin/Theme/Design gates, Demo 38/38, Runtime parity 134/134 with JS NodeContract 96/96, Python 188 passed / 1 skipped, Workflow Compatibility.

## 1.6.39 visual compatibility correction

- `core.default` is now a protected visual compatibility baseline. The application keeps the accepted pre-Design-SDK button, dialog, node, Canvas and interaction effects by default.
- `src/styles/theme-contract.css` remains the Theme/Material/Motion mapping layer but explicitly excludes `core.default`; it activates only for an installed non-default theme.
- Plugin SDK v4, Theme SDK v2, Design SDK v1, the root `sdk/` layout, plugin host split and dynamic-node layout engine remain unchanged.
- Dynamic-node anti-overlap/ellipsis and endpoint-aware geometry remain active; this release restores appearance, not architecture.
- Revalidated in 1.6.39: Visual Baseline, UI regression, Canvas 22/22, Node Layout, Theme/Design/Plugin SDK gates, Demo 38/38, Runtime parity 134/134 with JS NodeContract 96/96, Python 188 passed / 1 skipped.

## 1.6.38 SDK and repository cleanup

- Moved the public plugin-development surface out of the application implementation tree into root `sdk/`. `sdk/index.ts` is now the single public entry and Plugin SDK version is v4.
- Split public declarations from host implementation: package/archive/resource/theme/design authoring contracts are in `sdk/`; install/activate/persist/ZIP parsing and manager UI are owned by `src/plugins/`.
- Grouped dynamic-node layout/declarative UI under `src/nodes/` and global visual layers under `src/styles/`; no runtime semantics or node geometry rules changed.
- Added `scripts/sdk-layout-smoke.mjs` to prevent SDK files from drifting back into `src/` or host implementation from leaking into the public SDK barrel.
- Repository cleanup is non-destructive: merged local feature refs are removed and normal Git GC is used; commit history is not rewritten.
- 1.6.38 source revalidation: Demo **38/38**, Runtime parity **134/134**, JavaScript-capable NodeContract **96/96**, Python **188 passed / 1 skipped**, plus NodeSpec/Runtime Provider/Plugin package/archive/manager/declarative UI/Theme/Design/SDK-layout/node-layout/UI contract gates.

## 1.6.37 unified design contract

- Added `sdk/design.ts`; `sdk/index.ts` now exposes NodeSpec, Runtime/package/resource, Theme and Design contracts through one public SDK surface.
- Theme SDK v2 accepts `tokens`, `material` and `motion`. Material covers semantic elevation/blur; motion covers duration/easing and restrained visual transforms.
- `src/styles/theme-contract.css` is the final Core-owned mapping for dialogs, menus, controls, settings, package/plugin managers, cards, canvas controls and node visual states.
- Legacy component CSS may keep structural declarations, but visual elevation/motion is overridden by the final semantic contract.
- Reduced-motion preference neutralizes shared animation centrally.
- Dynamic node geometry remains exclusively in `src/nodes/layout.ts`; theme/design plugins cannot modify node metrics or port placement.

## 1.6.36 theme / node-layout contract

- Added Plugin SDK v2 and UI Theme SDK v1. Plugin packages may now contain nodes, UI themes, or both; theme-only JSON and `.plugin.zip` packages use the same atomic install/enable/disable/uninstall/restore lifecycle.
- Theme plugins are token-only. `UI_THEME_TOKEN_NAMES` whitelists semantic app/canvas appearance; arbitrary CSS, render callbacks and geometry variables are rejected.
- Added `src/styles/theme-contract.css` as the final appearance-only visual contract so Settings, dialogs, toolbars, fields, data grids and canvas/node surfaces consume the same semantic token layer.
- Settings → Appearance now selects installed UI themes independently from light/dark mode. If the active plugin theme disappears, the app returns directly to `core.default`.
- Added `src/nodes/layout.ts` as the single node measurement contract. Dynamic nodes with data ports use horizontal side rails with deterministic row spacing; this includes signature-derived Python/function/group nodes. Label/control/rail widths, endpoint-scale-aware row spacing and minimum height are measured together.
- Dynamic cards suppress the redundant raw nodeType line, keep long labels inside measured rails with ellipsis/tooltips, and reserve endpoint-scale-aware rows so enlarged handles cannot overlap.
- Added a theme-only executable SDK example in JSON and `.plugin.zip`, plus theme/layout/UI-contract smoke gates.
- Full Windows/Android packaging remains the next release gate after source validation.

## 1.6.35 release-validation changes

- Rebuilt Node Plugin Manager into a compact responsive multi-column dashboard. It now shows package/node/runtime statistics, search, enabled/disabled filtering and Python/JS filtering while keeping the same install/enable/disable/uninstall lifecycle.
- Official Demo package/node names receive Chinese UI display names without changing package IDs, nodeType values, manifests or Runtime Provider contracts.
- Removed Python package management and Node Plugin Manager from the desktop top toolbar and mobile overflow menu.
- Settings → Extensions owns both managers as a normal compact settings card. It sits after the existing configuration cards and uses the same button metrics as the surrounding settings panels instead of full-width secondary actions. The existing managers remain the single implementation; Settings only owns navigation.
- Refactored Node Plugin Manager into one controlled panel mounted by App instead of a self-owned toolbar button.
- Classified current plugin demos (25–38) as SDK executable specifications/regression fixtures. They are not promoted to built-in product nodes because they duplicate existing Core semantics or exist only to validate Plugin/Provider/UI contracts.
- Added UI regression gates that prevent package/plugin actions from returning to the main toolbar and protect the Settings alignment contract.
- Corrected the Remote/Host baseline heading sentence so the existing baseline-consolidation gate recognizes `docs/BASELINE.md` as the authoritative baseline; no Remote/Host behavior changed.

### 1.6.35 source revalidation

Passed after these changes: version sync; Settings/UI regression; Node Plugin Manager; NodeSpec/Runtime Provider; Manifest/ZIP/Declarative UI; demos **38/38**; Runtime parity **134/134** with JS-capable NodeContract coverage **96/96**; Python **188 passed / 1 skipped**; build-tool/platform/execution/Host architecture; MCP Core/runtime/HTTP/Desktop/Android E2E; Remote Web/Remote Host Desktop+Android; LAN boundary/selection; Workflow Compatibility/Migration; Workflow Core/Editor Core/Runtime Engine/NodeContract; Notebook/portable functions; canvas theme and plot presentation. Changed TSX files also pass standalone TypeScript syntax transpilation.

Full project TypeScript/Vitest and Windows/Android packaging still require the pinned dependency-installed Node 24 / pnpm 11.21 release host.

## 1.6.34 audit changes

- Removed the unused renderer `normalizeMcpRuntime` helper.
- Removed duplicate renderer `MCP_PORT` / `MCP_PATH` declarations; transport address remains owned by the actual Desktop/Android MCP hosts.
- Removed the obsolete single-execution Host-status compatibility reconstruction. Current Desktop and Android hosts both publish canonical `executions[]` status.
- Removed two undocumented zero-caller plugin-package helpers whose use cases are already owned by node-oriented resource access and package-detail listing.
- Corrected the build-script revision, which had remained at the 1.6.13 MCP baseline despite product versions advancing to 1.6.33.
- Updated current-version documentation so README/progress/handoff no longer direct new work from 1.4.x/1.5.x state.
- Retained public plugin SDK barrels and lifecycle APIs even where they have no first-party caller, because they are deliberate external authoring contracts.

## 1.6.34 source validation performed

Passed in the current source environment: version sync; build-tool policy/architecture; Execution architecture; MCP architecture/runtime/HTTP/Desktop E2E; Host contract; Remote Host E2E; LAN boundary/selection; Workflow compatibility and strict migration typecheck; Runtime Engine; NodeContract; runtime-parameter gate; Editor/Workflow Core ownership; Notebook/portable-function gates; UI/theme/plot regressions; NodeSpec/Runtime Provider/Manifest/ZIP/Plugin Manager/Declarative UI; demos **38/38**; Runtime parity **134/134** with JS-capable coverage **96/96**; Python **188 passed / 1 skipped**.

This ZIP intentionally has no `node_modules`, and the current cloud shell is not the pinned Windows Node 24 build host. Therefore full `pnpm check`, Windows Desktop packaging and Android packaging are deliberately left to 1.6.35 Release Validation and must not be reported as completed here.

## Release-validation next step

For **1.6.39 Release Validation**, run the full pinned Node 24 / pnpm 11.21 build matrix:

1. `pnpm check` including TypeScript/Vitest, Python, Runtime parity, NodeContract, Workflow compatibility, Plugin/SDK, MCP, Remote/LAN and architecture gates.
2. Windows Desktop package build.
3. Android package build.
4. One final physical acceptance pass covering a normal dynamic workflow, one installed `.plugin.zip` workflow, MCP, and Remote Web/LAN.

If those pass without a structural defect, freeze the 1.6.x line as the stable release and stop the current development cycle.
