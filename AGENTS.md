# PyDroid Node development rules

These rules apply to every developer and coding agent.

## Read first

1. `docs/BASELINE.md` — authoritative current baseline and accepted evidence.
2. `docs/development-handoff.md` — current branch/version and immediate continuation state.
3. `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md` — architecture direction.
4. `docs/host-contract.md`, `docs/node-contract.md`, `docs/runtime-parity.md` — contracts before changing host, node or dual-runtime behavior.
5. `BUILD_TOOLCHAIN.md` — build/packaging rules before touching build scripts.
6. `CHANGELOG.md` — historical behavior, not an architecture source of truth.

If an older phase document conflicts with `docs/BASELINE.md`, the baseline wins. Files under `docs/history/` are historical evidence only.

## Repository policy

- One repository and one shared source tree. Do not create parallel `dev`, `js`, `dev-node`, Android-only or Desktop-only project copies.
- Long-lived branches are `main` and `dev`; feature/fix/baseline branches are temporary integration work.
- Preserve `.git` and full history in deliveries.
- Deliver one clean project directory and keep `git status` clean.
- Do not merge a candidate into `main` without the user's local compile/runtime acceptance.

## Product architecture

- Android and Windows share UI, workflow model, Node Contract and runtime semantics.
- Python and JavaScript are runtimes, not separate products.
- Platform-specific host behavior belongs behind PlatformAdapter/host implementations.
- Workflow migrations and future-version protection are persistent-data correctness features. Do not remove them as "defensive programming".
- Editor state belongs to Editor Core / Workspace Session; execution state belongs to ExecutionController/runtime layers.

## Remote Web baseline

The accepted Remote/LAN anchor is **1.4.91**, physically opened from an Android tablet against the Windows Host. Git tag: `baseline-remote-lan-1.4.91`.

Keep the production path:

`user start -> bind 0.0.0.0:8765 -> return info -> discovery best-effort`

Do not add PowerShell/UAC/firewall management, route probes, readiness gates, lifecycle generations, periodic reconciliation, network watchers or automatic recovery to the Host path. SSDP/UPnP/mDNS never gate HTTP.

Remote API basic correctness must remain aligned across Desktop/Android: health GET-only, pair POST-only, authenticated application APIs POST-only, wrong method 405.

PIN cooldown, token TTL/IP binding and API rate limits are deferred security-policy choices. They were real capabilities, not meaningless code, but they are not part of the consolidated baseline and must not be coupled to Host startup if reconsidered.

## Build rules

- Explicit tools and explicit failure. No PATH/registry/Corepack guessing in the normal builder.
- No automatic tool installation, proxy discovery, build retry/backoff, signing degradation, Gradle-mode switching or fallback packaging.
- Current Windows output is always `PyDroid-Flow-Desktop`; versioned copies are archive-only.
- Current output uses one `robocopy /MIR` mirror operation.
- Build workspace recursive cleanup uses the documented .NET long-path-safe implementation, not PowerShell `Remove-Item -Recurse`.
- Keep source tree free of generated `node_modules`, `dist`, `release`, Gradle output, Python envs and machine-local toolchains.

## Validation

Use the strongest available evidence and report limits explicitly. Physical-device acceptance outranks local smoke tests.

Before delivery, run all relevant checks available in the environment. At minimum for Remote/LAN changes:

- `node scripts/remote-host-e2e-smoke.mjs`
- `node scripts/android-remote-host-jvm-smoke.mjs`
- `node scripts/lan-runtime-boundary-smoke.mjs`
- `node scripts/lan-network-selection-smoke.mjs`
- `node scripts/host-contract-smoke.mjs`

For workflow/runtime changes also run migration, NodeContract, parity and Python tests. For build changes run build-tool smoke/architecture tests. Always run `git diff --check`, `git status`, and `git fsck` before delivery.

## Current phase state

Phases 1–9 foundations remain retained. Phase 11 Workflow Compatibility & Migration remains retained. Phase 10 reliability/security experiments are historical except for ordinary API correctness contracts. Continue post-Phase-11 development from **1.4.92 Baseline Consolidation**; do not start another broad Remote Web refactor without a new reproducible defect.
