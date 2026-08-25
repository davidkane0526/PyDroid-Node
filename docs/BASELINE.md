# Remote/Host consolidated architectural baseline — 1.4.92

Date: 2026-08-21
Branch: `baseline/1.4.92-consolidated`
Android versionCode: `115`

This document is the **authoritative baseline** for Remote Web / Host / build-path architecture, not the current product version. Current release state is tracked in `docs/development-handoff.md`. If an older Remote/Host roadmap, phase note, or Git commit conflicts with this file, this file describes the retained production constraints.

## 1. Evidence hierarchy

Use this order when deciding whether a subsystem is working:

1. User physical-device acceptance.
2. Packaged application runtime evidence.
3. Real process/socket/HTTP/JVM integration tests.
4. Contract/unit/static tests.
5. Historical design intent.

Tests do not replace physical LAN acceptance.

### Accepted Remote Web evidence

`1.4.91` is the current physical LAN acceptance anchor:

- Windows Desktop bound `0.0.0.0:8765`.
- Host-local `curl --noproxy "*" http://192.168.3.185:8765/health` returned HTTP 200 `OK`.
- Host-local `curl --noproxy "*" http://192.168.3.185:8765/` returned the packaged HTML shell.
- The runtime log recorded other LAN clients reaching `/upnp/device.xml`.
- An Android tablet successfully opened the Windows-hosted Remote Web UI over the LAN.

Git tag `baseline-remote-lan-1.4.91` points to that accepted code. Git tag `historical-remote-lan-1.4.73` preserves the earlier accepted Remote/LAN implementation for comparison only.

## 2. Remote Web production contract

Desktop Remote Web has one control path:

`user start -> bind 0.0.0.0:8765 -> return RemoteServerInfo -> run discovery best-effort`

Stop has one control path:

`user stop -> cancel remote executions -> stop discovery -> close HTTP server`

Required behavior:

- TCP port is fixed at `8765`.
- HTTP bind success is the definition of Host startup success.
- SSDP/UPnP/mDNS are discovery helpers only. Their failure must not stop HTTP.
- Desktop runtime must not launch PowerShell, `route.exe`, `netsh`, or another external network process.
- Desktop runtime must not request UAC, inspect/modify Windows Firewall, classify network profiles, run active route probes, or auto-recover the Host.
- Diagnostics may observe Remote Web but must not start, stop, repair, or reconcile it.
- Runtime logs are observational only and live at `<exe-dir>/logs/desktop.log` in packaged Desktop builds.

LAN interface selection is a deterministic **preferred interface heuristic**, not an asserted Windows default route. It uses Node's current `os.networkInterfaces()` information and favors private, physical Wi-Fi/Ethernet interfaces. The serialized discovery field is `preferred`, not `defaultRoute`.

## 3. Remote API correctness

The minimal accepted authentication model is session-scoped PIN/token pairing:

- `GET /api/health` is public.
- `POST /api/pair` is public and validates the current PIN when PIN is enabled.
- Authenticated `/api/*` application endpoints are `POST` only.
- Wrong methods return HTTP 405.
- Desktop `/api/agent-proxy` explicitly returns 409 because Desktop does not expose a host-stored Agent secret to Remote Web; Android may provide its platform-specific secure proxy.
- Tokens are cleared when the Host stops/restarts.

Historical Phase 10 security features such as PIN cooldown, token TTL, token/IP binding and API rate limiting were functional security features, not fictitious code. They are **not part of the consolidated 1.4.92 baseline** because they were coupled to a broader reliability/security experiment that obscured the Host path. They may be reconsidered later only as isolated policy modules with dedicated tests and no influence on bind/start/stop/discovery.

## 4. Build baseline

The builder separates **local discovery** from **automatic recovery**:

- A path explicitly entered by the user is a strict override. If it is invalid, fail clearly.
- If a tool path is left blank, the builder may read-only discover already-installed Node, pnpm, JDK, Android SDK and full Python from environment variables, known local installation locations, registry/PATH/launcher metadata where appropriate, and the shared/work tool roots.
- Every discovered candidate must satisfy the project version/completeness contract before it can be selected.
- Discovery ends before package/build execution starts. A later build failure must not switch to another tool candidate.
- Local discovery is **not** fallback/recovery. It must never download, install, repair, overlay, relocate or mutate a toolchain.
- No Corepack bootstrap, automatic JDK/Python/SDK installation, or SDK component installation.
- No automatic proxy discovery.
- No package/build retries or mode switching.
- Desktop current output is always `PyDroid-Flow-Desktop`.
- Optional versioned Desktop output is archive-only.
- Current Desktop output is updated by one `robocopy /MIR` operation.
- Build workspace tree cleanup uses one .NET recursive delete with Windows extended-length paths; normal build cleanup must not use PowerShell `Remove-Item -Recurse`.
- Gradle process exit status decides Android build success.

## 5. Retained architecture and data-safety work

The following are retained because they represent product structure or user-data correctness rather than defensive infrastructure:

- PlatformAdapter and Desktop/Android host contract.
- ExecutionController and multi-workspace execution semantics.
- Unified NodeSpec / Node Contract.
- Python/JavaScript runtime parity and Runtime Engine modularization.
- Phase 8 workflow language/state/function system.
- Phase 9 Editor Core / Workspace Session ownership.
- Phase 11 Workflow Compatibility & Migration, including workflow schema v3 migration, resource schema v2 future-version protection, migration corpus, and post-migration runtime validation.

Do not delete migration or forward-compatibility safeguards under the label "defensive programming". They protect persistent user data.

## 6. Explicitly retired experiments

Do not restore these without a new user requirement and a demonstrated failure they directly solve:

- Host lifecycle generations/futures/barriers.
- readiness self-probes as startup gates.
- periodic UI/Host reconciliation.
- network-change watchers and automatic Host recovery.
- discovery recovery counters.
- firewall/profile automation and UAC elevation.
- Remote production freeze hashes.
- automatic tool installation/repair, post-failure tool switching, or fallback packaging modes. Read-only discovery of already-installed local tools is explicitly allowed.

Historical implementation details remain available in Git and `docs/history/`.

## 7. Validation gates

Remote/LAN changes must run at least:

- `node scripts/remote-host-e2e-smoke.mjs`
- `node scripts/android-remote-host-jvm-smoke.mjs`
- `node scripts/lan-runtime-boundary-smoke.mjs`
- `node scripts/lan-network-selection-smoke.mjs`
- `node scripts/host-contract-smoke.mjs`

A release claiming physical LAN acceptance still requires a real second device. Local loopback/LAN-IP tests are necessary but not equivalent.

Build changes must run the build-tool smoke/architecture checks. Workflow/runtime changes must run compatibility, parity, NodeContract and Python tests relevant to the change.

## 8. Development rule

When a failure occurs, identify the failing operation and fix that operation. Do not add a parallel path, health state machine, automatic recovery loop, or fallback merely to make tests green.
