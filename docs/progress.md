# Current progress — 1.6.38 SDK & Repository Cleanup

Date: 2026-08-25

## Current release state

- Product version: **1.6.38**, Android versionCode **178**.
- Build revision: `1.6.38-dev-r133-sdk-repository-cleanup`.

- 1.6.38 source validation: SDK layout, Unified Design/Theme, node layout, plugin package/archive/manager/declarative UI and UI regression gates pass; Demo **38/38**; Runtime parity **134/134**; JavaScript-capable NodeContract **96/96**; Python **188 passed, 1 skipped**. Formal Windows/Android packaging remains a local Node 24 / pnpm 11.21 release gate.
- Phase: release convergence; the visual contract is now unified as Plugin SDK v4 + Theme SDK v2 + Design SDK v1. Pinned-toolchain Windows/Android packaging and final physical acceptance remain.
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



## 1.6.38 SDK / repository cleanup

- Root `sdk/` is now the only public plugin-development surface; `sdk/index.ts` is Plugin SDK v4.
- Plugin host implementation is grouped under `src/plugins/`, dynamic-node layout/declarative UI under `src/nodes/`, and shared visual layers under `src/styles/`.
- Public manifest/archive/resource/theme/design contracts are separated from install/persistence/ZIP/UI host code.
- Added an SDK layout gate so future changes cannot silently scatter public SDK files back through `src/`.
- Git cleanup removes already-merged local feature refs and repacks reachable objects without rewriting history.
- Revalidated: Demo **38/38**, Runtime parity **134/134**, JS NodeContract **96/96**, Python **188 passed / 1 skipped**, plus SDK/Plugin/Theme/Design/Node Layout/UI gates.

## 1.6.37 unified design contract

- Plugin SDK v3 introduced the unified Theme/Design export surface; 1.6.38 relocates and formalizes that surface as root `sdk/` Plugin SDK v4.
- Theme definitions now have separate `tokens`, `material` and `motion` sections. Theme packages remain token-only and cannot inject CSS or layout logic.
- Core material tokens unify panel/card/control/popup/node elevation, overlay/glass blur and surface highlights.
- Core motion tokens unify control/menu/dialog/card/node state timing and easing, with restrained hover/press/enter amplitudes.
- `prefers-reduced-motion` is enforced at the shared contract level.
- Host-rendered declarative plugin UI automatically consumes the same material/motion system; plugins cannot create a parallel visual stack.
- Dynamic-node measurement remains unchanged and Core-owned. Motion never changes node bounds, port rows or edge anchors.

## 1.6.36 theme / node-layout contract

- Plugin SDK v2 now exports UI Theme SDK v1; packages can be node-only, theme-only or combined.
- UI theme plugins can only override a semantic appearance whitelist. Layout, typography metrics and node geometry remain Core-owned.
- `src/styles/theme-contract.css` unifies the final appearance layer for shared UI surfaces and canvas styling.
- Settings → Appearance lists installed themes; removing the active theme deterministically returns to `core.default`.
- `src/nodes/layout.ts` centralizes node measurement and moves complex dynamic nodes to deterministic side rails/fixed rows, preventing port/default-control overlap.
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

**1.6.38 Release Validation**: full `pnpm check`, Windows Desktop package, Android package, then one final physical acceptance pass. If no structural defect is found, freeze and stop the current development cycle.
