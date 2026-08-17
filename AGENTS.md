# PyDroid Node development rules

These rules apply to every developer and coding agent on every device.

## Start every new development session here

1. Read `docs/development-handoff.md` for the current branch, validation state and immediate next tasks.
2. Read `docs/runtime-architecture.md` before changing execution/runtime boundaries.
3. Read `docs/progress.md` and `CHANGELOG.md` before changing user-visible behavior.
4. Read `BUILD_TOOLCHAIN.md` before changing build, packaging, dependency-download, or GUI build-tool behavior.

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
- Prefer project-local package dependencies, but reuse the documented shared machine toolchain/cache (`DK_TOOL_ROOT` / `DK_CACHE_ROOT`) for Node/JDK/Android SDK/Python and downloads. Do not reintroduce per-project copies of those machine tools unless isolation is explicitly required.
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

After the current settings/SMB UI is locally verified:

1. Extract host-specific file/SMB/profile/remote APIs into `src/platform/*` behind a `PlatformAdapter`.
2. Extract workflow document/session/dirty-state/history/serialization from the large `App.tsx` into `src/workflow/*`.
3. Move runtime compatibility declarations into node metadata so unsupported runtimes are visible before execution.
4. Expand JavaScript parity only where semantics can match Python reliably.
5. Add transaction-based undo/redo and then a node debugger/execution trace.
