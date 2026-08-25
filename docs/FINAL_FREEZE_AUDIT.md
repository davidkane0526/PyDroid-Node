# 1.6.34 Final Freeze Audit

Date: 2026-08-25

## Scope

Audit the post-1.5.16 additions for dead code, duplicate ownership, temporary bridges and version/document drift. This audit is intentionally conservative: it removes only paths whose lack of ownership/callers can be demonstrated. It does not refactor working architecture for aesthetic reasons.

## Removed

1. `src/mcp/host.ts::normalizeMcpRuntime` — no caller in renderer, host, tests or public plugin documentation.
2. `src/mcp/protocol.ts::MCP_PORT` / `MCP_PATH` — duplicate transport constants with no renderer caller. Port/path are host transport concerns and remain defined in the actual Desktop/Android MCP servers.
3. `src/execution-host.ts` legacy single-execution reconstruction — current Desktop scheduler, Desktop Remote API, Android host plugin and Android Remote API all publish the canonical `executions[]` contract.
4. `getNodePluginResourceDataUrl()` and `listInstalledNodePluginPackages()` — undocumented zero-caller package helpers. Existing node-oriented resource access and `listInstalledNodePluginPackageDetails()` own those use cases.

## Retained intentionally

- `sdk/index.ts`: public third-party authoring barrel despite no first-party static import.
- NodeSpec `unregisterNodeSpec()` / `hasRegisteredRuntimeProvider()`: public lifecycle/introspection SDK operations.
- Workflow and resource migrations/future-version rejection: persistent-data correctness.
- JavaScript engine façade: still imported by the active runtime adapter and smoke harnesses.
- Remote Web/LAN discovery and host paths: accepted production infrastructure with active callers.
- Automated diagnostics: explicit product/debug capability with an active UI owner.

## Drift corrected

- Build script revision was stale at `1.6.13-dev-r113-agent-mcp-hard-baseline` while product version was 1.6.33.
- README, progress and development handoff still presented 1.4.x/1.5.x as current development state.
- Runtime parity documentation still presented the 1.5.10 102/102 checkpoint.

## Validation

Revalidated on the 1.6.34 source tree: demos **38/38**, Runtime parity **134/134**, JavaScript-capable NodeContract coverage **96/96**, Python **188 passed / 1 skipped**, plus MCP HTTP/Desktop E2E, Remote Host E2E, LAN, Workflow Compatibility, NodeSpec/Runtime Provider/Plugin/Declarative UI and editor/runtime architecture gates. Full Windows Desktop/Android packaging is intentionally deferred to the pinned 1.6.35 release environment.

## Exit rule

Do not perform another broad cleanup after this audit unless a concrete caller/ownership defect is demonstrated. Proceed to 1.6.35 Release Validation; if the full build/test matrix and final physical acceptance pass, freeze the line.
