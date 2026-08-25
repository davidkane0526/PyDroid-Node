# Current progress — 1.6.36 Theme / Node Layout Contract

Date: 2026-08-25

## Current release state

- Product version: **1.6.36**, Android versionCode **176**.
- Build revision: `1.6.36-dev-r131-theme-node-layout-contract`.

- 1.6.36 release-contract validation: Demo **38/38**; Runtime parity **134/134**; JavaScript-capable NodeContract **96/96**; Python **188 passed, 1 skipped**; MCP/Remote/LAN and plugin/theme/layout smoke gates pass. Formal Windows/Android packaging remains a local Node 24 / pnpm 11.21 release gate.
- Phase: release convergence; Theme Plugin / node-layout source contract is closed. Pinned-toolchain Windows/Android packaging and final physical acceptance remain.
- Remote Web/LAN production behavior is unchanged from the accepted baseline.

## Completed before this audit

- Dynamic NodeSpec and Blender-style conditional/loop structures.
- Generic parameter sockets, repeated inputs and multi-series workflows.
- Node variants, Series/Legend registry and scientific column pipelines.
- NodeSpec SDK v7 and dual-runtime Runtime Provider SDK.
- JSON Manifest and `.plugin.zip` plugin lifecycle with persisted read-only resources.
- Host-rendered declarative plugin Inspector, conditions, edit constraints, validation and output-port status.
- MCP Core bridge on Desktop and Android.
- Built-in workflow demos through Demo 38.

1.6.34 source revalidation: Runtime parity **134/134** with JavaScript-capable NodeContract coverage **96/96**, Python **188 passed / 1 skipped**, demos **38/38**. MCP HTTP/Desktop E2E, Remote Host E2E, LAN, Workflow Migration, Plugin/SDK and ownership/architecture smokes also pass. Full pinned `pnpm check` plus Windows/Android packaging remain 1.6.35 release gates because this source ZIP does not include `node_modules` and the current shell is not the pinned Windows Node 24 build environment.

## 1.6.36 theme / node-layout contract

- Plugin SDK v2 now exports UI Theme SDK v1; packages can be node-only, theme-only or combined.
- UI theme plugins can only override a semantic appearance whitelist. Layout, typography metrics and node geometry remain Core-owned.
- `ui-theme-contract.css` unifies the final appearance layer for shared UI surfaces and canvas styling.
- Settings → Appearance lists installed themes; removing the active theme deterministically returns to `core.default`.
- `nodeLayout.ts` centralizes node measurement and moves complex dynamic nodes to deterministic side rails/fixed rows, preventing port/default-control overlap.
- Added theme-only JSON/ZIP examples and dedicated SDK/UI-layout regression gates.

## 1.6.35 release-validation work

- Node Plugin Manager redesigned as a compact responsive multi-column dashboard with live plugin/runtime statistics, search, status filtering and runtime filtering.
- Official Demo plugin/node labels are localized to Chinese at the UI presentation layer while IDs/nodeType/runtime contracts remain unchanged.
- Main-toolbar and mobile-overflow Python package/plugin entries removed.
- Settings → Extensions owns both management entry points as one normal two-column-grid card; its actions now use the same compact metrics as the other settings-card buttons instead of full-width secondary controls.
- Current plugin demos remain SDK/regression examples rather than built-in product plugins, avoiding duplicate user-facing node semantics.
- Source revalidation remains green: demos **38/38**, Runtime parity **134/134**, JS-capable coverage **96/96**, Python **188 passed / 1 skipped**, plus Plugin/SDK, MCP, Remote/LAN, Workflow Migration and architecture gates.
- Full project TypeScript/Vitest and Windows Desktop/Android packaging remain the release gates on the pinned Node 24 / pnpm 11.21 environment.

## 1.6.34 work

- Remove only demonstrably unreachable post-1.5.16 code and obsolete runtime compatibility branches.
- Keep public plugin SDK entry points even when first-party code does not call them.
- Synchronize product version, Android version, build-script revision and active documentation.
- Do not add fallback, recovery, retries, new UI features or new runtime semantics.

## Next

**1.6.36 Release Validation**: full `pnpm check`, Windows Desktop package, Android package, then one final physical acceptance pass. If no structural defect is found, freeze and stop the current development cycle.
