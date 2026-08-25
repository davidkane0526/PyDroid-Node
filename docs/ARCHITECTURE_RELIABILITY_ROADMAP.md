# Architecture and reliability roadmap

Current release state: **1.6.38 SDK & Repository Cleanup**
Remote/Host architectural baseline: **1.4.92 Baseline Consolidation**
Authoritative current handoff: `docs/development-handoff.md`

## Design principle

Keep production control paths explicit and small. Reliability means correct ownership, deterministic state transitions, clear failures, data compatibility and observable behavior. Reliability does **not** mean adding parallel fallback paths, self-healing state machines or environment guesses around every failure.

## Completed foundations

1. **PlatformAdapter** — shared UI uses platform capabilities instead of platform-specific branches in product logic.
2. **ExecutionController** — execution IDs, timeout/cancel behavior and host release semantics are centralized.
3. **Workflow Core** — workflow document/session/history/persistence/migration ownership is separated from UI rendering.
4. **Multi-workspace execution** — workspace/client/source identity and platform scheduling semantics are established.
5. **Unified NodeSpec / Node Contract** — node runtime support and validation metadata have one source of truth.
6. **Runtime parity** — Python and JavaScript-capable nodes are covered by a shared golden corpus.
7. **Runtime Engine modularization** — runtime façades, domain handlers and workflow orchestration remain separated.
8. **Workflow Language / State & Functions** — reusable function/state semantics are retained.
9. **Editor Core / Workspace Session** — per-tab graph/input/history/view ownership remains behind editor commands.
10. **Workflow Compatibility & Migration** — schema migration, future-version protection and historical corpus validation are retained as user-data safety mechanisms.

## Remote Web baseline

Remote Web is accepted infrastructure, not an active reliability-refactor target. The 1.4.91 Windows Host was opened successfully from an Android tablet.

The active contract is direct bind/stop on TCP 8765 with independent best-effort discovery. See `docs/BASELINE.md` and `docs/lan-discovery.md`.

The Phase 10 lifecycle/readiness/reconciliation/recovery experiment is historical. It must not be reintroduced merely to increase automated test coverage. Historical notes live under `docs/history/` and in Git.

## Build baseline

The builder uses explicit configured tools, a stable current Desktop output path, one mirror operation for current output, one long-path-safe directory deletion implementation for workspace cleanup, and direct failure on missing tools or failed build commands. See `BUILD_TOOLCHAIN.md`.

## Future work rule

New architecture work should satisfy at least one of these conditions:

- it enables a concrete requested product capability;
- it removes duplicated ownership that is causing a demonstrated defect;
- it protects persistent user data or cross-version compatibility;
- it restores Desktop/Android/runtime parity;
- it measurably reduces a confirmed performance bottleneck.

Do not start broad reliability/security/refactor phases based only on hypothetical failures.
