# Current development handoff — 1.6.35 Release Validation Candidate

Branch: `feature/release-validation`
Version: **1.6.35**
Android versionCode: **175**
Build revision: `1.6.35-dev-r127-release-validation`

## Current phase

PyDroid Node is in release validation. Do not start another architecture/SDK expansion phase before the exit criteria below are met. 1.6.35 keeps the 1.6.34 freeze: only release-validation changes and reproduced defect fixes are allowed.

## Non-negotiable continuation rules

1. Work from the supplied local project ZIP, not an older remote copy.
2. JavaScript portability remains a golden rule. A node may advertise JavaScript only when its active parameter combination has proven Python/JavaScript semantic parity.
3. Do not reintroduce removed Notebook/runtime bridges, DataFrame-specific control structures, edge-order port guessing, readiness/recovery state machines, firewall/UAC automation, build retries, or post-failure tool switching.
4. Keep persistent workflow/resource migrations and future-version rejection. Those protect user data and are not optional defensive code.
5. Keep the accepted Remote Web/LAN production path unchanged unless a reproduced defect directly requires a fix.
6. Public SDK surfaces are not dead code merely because the first-party application has no internal caller. `src/nodePluginSdk.ts`, NodeSpec registration and Runtime Provider authoring APIs are third-party entry points.
7. Do not add user-facing explanatory UI copy without explicit approval.

## Current architecture checkpoint

- Dynamic NodeSpec/Node Contract: parameter sockets, repeated inputs, variants, loop/if zones, series/legend metadata and scientific column pipelines.
- NodeSpec SDK: **v7**.
- Plugin path: JSON Manifest or `.plugin.zip` -> NodeSpec + JavaScript/Python Runtime Providers + persisted read-only resources -> enable/disable/uninstall/restore.
- Declarative plugin UI: host-rendered parameter groups, conditions, linked options, numeric constraints, read-only/disabled states, validation hints and bounded result/output-port status.
- MCP: Desktop/Android Streamable HTTP host on port 8766 with renderer-side Core adapter; no second workflow state owner.
- Runtime parity revalidated in 1.6.34: **134/134** golden workflows; JavaScript-capable NodeContract coverage **96/96**.
- Python suite revalidated in 1.6.34: **188 passed, 1 skipped**.
- Built-in Demo smoke revalidated in 1.6.34: **38/38**.


## 1.6.35 release-validation changes

- Removed Python package management and Node Plugin Manager from the desktop top toolbar and mobile overflow menu.
- Added one aligned Settings → Extensions section with equal-width Python package and Node plugin actions. The existing managers remain the single implementation; Settings only owns navigation.
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

For **1.6.35 Release Validation**, run the full pinned Node 24 / pnpm 11.21 build matrix:

1. `pnpm check` including TypeScript/Vitest, Python, Runtime parity, NodeContract, Workflow compatibility, Plugin/SDK, MCP, Remote/LAN and architecture gates.
2. Windows Desktop package build.
3. Android package build.
4. One final physical acceptance pass covering a normal dynamic workflow, one installed `.plugin.zip` workflow, MCP, and Remote Web/LAN.

If those pass without a structural defect, freeze the 1.6.x line as the stable release and stop the current development cycle.
