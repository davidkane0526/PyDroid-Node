# PyDroid Node development rules

These rules apply to every developer and coding agent on every device.

## Start every new development session here

1. Read `docs/development-handoff.md` for the current branch, validation state and immediate next tasks.
2. Read `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md` before architecture/refactor/reliability work.
3. Read `docs/runtime-architecture.md` before changing execution/runtime boundaries.
4. Read `docs/node-contract.md` before adding/changing node types, runtime support, functions or variables.
5. Read `docs/runtime-parity.md` before changing any node implemented by both Python and JavaScript.
6. Read `docs/progress.md` and `CHANGELOG.md` before changing user-visible behavior.
7. Read `docs/host-contract.md` before adding, renaming, or rerouting Desktop/Android host operations.
8. Read `BUILD_TOOLCHAIN.md` before changing build, packaging, dependency-download, or GUI build-tool behavior.

This repository is the **only project copy**. Do not create or maintain separate `dev`, `js`, `dev-node`, Android or desktop source folders. Git branches are history/integration tools; platform/runtime differences belong inside the source architecture.

## Product and platform rules

- Keep Windows desktop and Android behavior equivalent for shared workflows, nodes, parameters, validation, previews, plots, and CSV export.
- Reuse the versioned workflow schema and shared execution contracts. A workflow exported on one platform must import and execute on the other.
- Do not modify or delete the existing `android/` implementation when working on the desktop application. Platform-specific host code belongs under its platform adapter/host implementation.
- Record platform progress and known gaps in `README.md` and `docs/progress.md` when behavior changes.
- Python and JavaScript are execution runtimes, not separate applications. Do not recreate a long-lived JS UI branch.

## Architecture direction

- One Shared UI for Android / Windows / Web.
- One Workflow Core / document model.
- `RuntimeAdapter` selects Python or JavaScript execution.
- Planned `PlatformAdapter` owns SMB, file picking, profile storage, Electron/Capacitor host services.
- Platform host services must not change node semantics.

## Git and delivery policy

- Long-lived branches: `main` and `dev` only. Refactor/feature/fix branches are temporary.
- Do not merge a refactor candidate to `main` without the user's local compile/runtime verification.
- Never replace `.git`, flatten history, or hand the user multiple branch folders.
- Deliver one clean repository directory with `.git` intact and `git status` clean.
- The user primarily performs local dependency installation, Windows build, Android Gradle build, emulator/device and manual interaction verification. The coding agent should still run every static/unit/build check available in its environment and clearly distinguish those checks from local full builds.

## Environment and cleanup rules

- Use repository-relative paths in committed files. Never commit machine SDK, JDK, Python, Node, or workspace paths.
- Prefer project-local package dependencies, but reuse the documented shared machine toolchain (`DK_TOOL_ROOT`) read-only for Node/JDK/Android SDK/Python. Never install or update tools inside `DK_TOOL_ROOT`; missing tools and writable build helpers belong under `WorkRoot`, while downloads/caches use `DK_CACHE_ROOT` or the WorkRoot cache.
- Before installing software, add its purpose, version, location, installation method, and removal command to `docs/environment.md`.
- Never commit `android/local.properties`, `node_modules`, `.tools`, Gradle output, Python virtual environments, build output, or downloaded toolchains.
- Do not install development tools to C: unless the user explicitly approves it.
- Before handing off a repository ZIP, remove build caches, generated output, temp files and accidental local Git index copies while preserving `.git`.

## Build-mode defaults

- Unless the user explicitly asks for a formal portable package, do not run the full `pnpm desktop:package` compression pipeline.
- For ordinary Windows UI and shared-logic development, prefer `pnpm desktop:dev` with Vite hot reload. Use `pnpm desktop` for an immediately operable quick test window that reuses the local Python runtime.
- Build the self-contained portable EXE only for an explicit formal portable package/release request.
- For Android Web UI changes, prefer `pnpm android:live` and Capacitor/Vite live reload. Rebuild/reinstall the APK when Python, Java, Android resources, manifest, Gradle configuration, or native bridge code changes.

## Validation

When the environment is provisioned, run the portable validation suite with:

```bash
bash scripts/cloud-check.sh
```

On Windows, run `pnpm check`. Desktop packaging additionally uses `pnpm desktop:package`. Android packaging requires JDK 21, Python 3.13, and an Android SDK with platform 36. Set `PYDROID_PYTHON_EXECUTABLE` only when Python 3.13 is not discoverable as `py -3.13` on Windows or `python3.13` on Linux.

Before delivery, at minimum:

- update `CHANGELOG.md`, `README.md`, `docs/progress.md`, and `docs/development-handoff.md`;
- keep Android/package version records consistent for user-visible releases/candidates;
- run TypeScript syntax/static checks available locally;
- run `git diff --check`, `git status`, and `git fsck`;
- report any check that could not run because dependencies/toolchains are unavailable.

## Immediate architecture plan

The UI is now treated as a stable layer. Do not start another broad UI redesign unless the user reports a concrete interaction defect. Follow `docs/ARCHITECTURE_RELIABILITY_ROADMAP.md`.

1. **Phase 1 PlatformAdapter is implemented and user-validated.** Treat its public contract as frozen unless a concrete bug is reported.
2. **Phase 2 ExecutionController is user-validated and frozen.** Preserve executionId/timeout/cancel semantics and host-release barriers.
3. **Phase 3 Workflow Core is complete/frozen on `dev` 1.4.31.** Workflow snapshot/session/history/input-state/persistence/migration ownership belongs in `src/workflow-core/`, not back in `App.tsx`.
4. **Phase 3.5 Multi-Workspace Execution is user-validated/frozen.** Preserve `executionId + workspaceId + workspaceLabel + clientId + source`, Desktop 1–4 process scheduling, Android 1-running + FIFO queue, host-priority queued/running tab state, and proactive paired-browser host polling.
5. **Phase 4 Unified NodeSpec / Node Contract is complete/frozen on `dev` 1.4.36.** Every visible node explicitly declares runtime support; Runtime Auto, JS compatibility, workflow validation and speculative pre-execution consume NodeContract. Future function/global-variable nodes must extend this contract rather than adding parallel metadata.
6. **Phase 5 Python/JavaScript parity is complete/frozen on `dev` 1.4.38.** Run `pnpm test:parity` whenever changing a dual-runtime node. Every JavaScript-capable NodeContract must stay covered by the golden corpus.
7. **Phase 6 Runtime Engine modularization is complete/frozen on `dev` 1.4.42.** Preserve the Python/JavaScript façade, domain-handler and workflow-orchestration module boundaries.
8. **Phase 7 Host/Build is user-validated and frozen.** Preserve the Desktop/Android host-binding contract and build-tool composition-root rules.
9. **Phase 8 Workflow Language / State & Function System is user-validated and frozen at 1.4.59.** Preserve workspace-variable isolation, reusable functions and dual-runtime parity.
10. **Phase 9 Editor Core & Workspace Session is user-validated and frozen at 1.4.67.** `EditorWorkspaceSession` owns per-tab graph/input/history/view state; editing operations stay behind Editor Commands. Gesture semantics remain policy-driven by input profile and target kind.
11. **Phase 10 Remote Access Security & Host Reliability is frozen at 1.4.76.** Preserve the user-accepted 1.4.73 network behavior: fixed TCP 8765, current UI copy, PIN/token semantics, LAN HTTP readiness and SSDP/UPnP/mDNS. Do not add UI text without explicit user approval.
12. **Phase 11 Workflow Compatibility & Migration is implemented in 1.4.79 and awaiting one final real-host verification. 1.4.77 was rejected by the real Windows TypeScript build; 1.4.78 then exposed a separate Desktop LAN false-positive boundary on 192.168.3.185.** Preserve Workflow schema v3 migration ownership in Workflow Core, resource schema v2 opaque future-version protection, complete Git-history corpus coverage and fail-closed NodeSpec/function migration rules. For Desktop LAN, keep fixed TCP 8765 and existing UI/SSDP/mDNS semantics; only `desktop/lan/firewall.cjs` and `desktop/services/remote-server.cjs` are evidence-backed Phase 11 hotfix exceptions. Diagnostics may report full Remote Host success only after Windows boundary readiness and a real external LAN client observation. Do not add UI copy or ask for intermediate Phase 11 tests.
