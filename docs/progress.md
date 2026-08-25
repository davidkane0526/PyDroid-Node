# Current progress — 1.6.34 Final Freeze Audit

Date: 2026-08-25

## Current release state

- Product version: **1.6.34**, Android versionCode **174**.
- Build revision: `1.6.34-dev-r126-final-freeze-audit`.
- Phase: release convergence; feature expansion is frozen.
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

## 1.6.34 work

- Remove only demonstrably unreachable post-1.5.16 code and obsolete runtime compatibility branches.
- Keep public plugin SDK entry points even when first-party code does not call them.
- Synchronize product version, Android version, build-script revision and active documentation.
- Do not add fallback, recovery, retries, new UI features or new runtime semantics.

## Next

**1.6.35 Release Validation**: full `pnpm check`, Windows Desktop package, Android package, then one final physical acceptance pass. If no structural defect is found, freeze and stop the current development cycle.
