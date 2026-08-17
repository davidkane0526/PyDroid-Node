# Development handoff

Updated: 2026-08-17

## Current repository state

This is a **single Git repository**. Do not split it into multiple project folders.

Current development line:

Current branch head includes the RC10 Android PowerShell fix on top of the RC9 unified shared-toolchain baseline and RC8 local-build compatibility fix. Build tooling now combines the previous CMD/GUI/network/native-pnpm fixes with cross-project `DK_TOOL_ROOT` / `DK_CACHE_ROOT` reuse.

```text
main / dev        149p stable UI baseline
      \
       refactor/runtime-architecture
             \
              refactor/settings-smb-ui
                      \
                       fix/build-tooling-gui
                                \
                                 build/shared-toolchain   <- current branch
```

The useful JavaScript engine from the former JS experiment has already been migrated into the unified tree under `src/runtime/javascript/engine/`. There is no second JS application to keep UI-synchronized.

## Current architecture

```text
                         PyDroid Node
                              |
                 +------------+------------+
                 |                         |
             Shared UI               Workflow Core
                 |                         |
      TopBar/Tabs/Inspector         Node/Edge/Save
      Dialog/DataGrid/Touch         History/Serialization
                 |                         |
                 +------------+------------+
                              |
                        Runtime Adapter
                       /               \
              Python Runtime       JavaScript Runtime

Next extraction:
                        Platform Adapter
               Android / Desktop / Web host APIs
```

Implemented runtime boundary:

- `src/runtime/types.ts`
- `src/runtime/registry.ts`
- `src/runtime/python.ts`
- `src/runtime/javascript/adapter.ts`
- `src/runtime/javascript/engine/*`
- shared plot presentation in `src/ui/PlotPreview.tsx` / `PlotView.tsx`

## Changes in the current branch

### Settings

- Adaptive settings dialog uses two columns on suitable desktop/tablet widths and one column on narrow screens.
- Canvas sliders are arranged in a responsive range grid instead of one very tall list.
- Theme-aware custom scrollbar replaces the visually inconsistent native-looking scrollbar.
- Appearance, runtime, SMB, AI, debug and profile settings use consistent card rhythm and spacing.

### SMB

The SMB dialog has been rewritten as a network file manager rather than a vertical setup wizard:

- left navigation tree: network devices -> shares;
- scan/refresh actions integrated into the navigation pane;
- breadcrumb/address toolbar for current server/share/path;
- connection credentials moved into a collapsible configuration panel;
- central file list uses Name / Type / Size columns;
- folders and files use shared SVG icons and selection states;
- footer contains selection status and import actions;
- mobile layout stacks a compact horizontally scrollable network section above the file browser.

The underlying SMB host APIs and security model are intentionally unchanged in this branch.


### Build tooling / GUI

- Added `tools/build-pydroid.ps1` as the compatibility-focused external-workspace builder.
- Added `tools/build-pydroid-gui.ps1` plus root launcher `Build PyDroid GUI.cmd`.
- The GUI exposes project/work/tool/output paths, platform targets, retry count, fallback tool versions and optional Electron mirrors, with live log output and cancellation.
- `scripts/desktop-package.mjs` now honors external Electron caches, reuses the actual pnpm implementation that launched the script, retries transient network failures and can fall back to packaging without Windows executable resource editing when GitHub helper downloads remain unavailable.
- `scripts/android-package.ps1` now reads the compile SDK from `android/variables.gradle` and uses `--no-daemon` for the known Windows Gradle daemon permission issue.
- The standalone builder no longer requires `.git` to recognize a project, derives output names from `package.json`, auto-detects Android compile SDK, supports configurable fallback Node/Python/JDK versions, retries downloads and can preserve the work area for diagnostics.
- The Vite `chunk > 500 kB` message is a warning only; the reported desktop failure was the later `electron-builder` HTTPS timeout.
- RC6 build-GUI hotfix: all WinForms collection/style `.Add()` return values are discarded, so the CMD console no longer prints `0 1 2 3 4`; the CMD redirects launcher diagnostics to `%LOCALAPPDATA%\PyDroidBuild\logs\launcher-last.log`.
- Real build output is both shown live in the GUI and saved to `<OutputRoot>\logs\build-YYYYMMDD-HHMMSS.log`; completion/failure dialogs include the result and log path. Child stdout/stderr is polled through `ReadLineAsync()` from the UI timer rather than background PowerShell event delegates.
- RC7 network fix: build networking defaults to `Auto`, first honoring `HTTPS_PROXY`/`HTTP_PROXY` and then the current user's Windows fixed proxy. The resolved proxy is exported to pnpm and to Electron's `@electron/get` (`ELECTRON_GET_USE_PROXY` + `GLOBAL_AGENT_*`). The GUI also exposes Direct/Manual modes, npm registry override, fetch timeout and pnpm network concurrency.
- `pnpm install` now uses the persistent external store with `--prefer-offline`, explicit request retry/timeout/concurrency configuration, and whole-install retry while preserving partially downloaded store content. Local proxy endpoints are checked before a long build begins; PAC-only configurations produce an actionable warning because pnpm cannot consume a PAC URL directly.
- RC8 local-build fix: `desktop-package.mjs` now distinguishes native `pnpm.exe`, `.cmd/.bat`, and JavaScript package-manager launchers before spawning; `pnpm check` includes a dependency-free build-tool invocation smoke test. The SMB connection `<details>` no longer uses unsupported `defaultOpen`; it opens through a DOM ref when no share is selected.
- RC9/RC10 shared-toolchain baseline: `DK_TOOL_ROOT` and `DK_CACHE_ROOT` centralize reusable Node/JDK/Android SDK/Python installations and pnpm/npm/Corepack/Electron/electron-builder/Gradle/download caches. The builder validates JDK major versions, activates the chosen JDK before `sdkmanager`, patches the legacy `node.exe pnpm.exe` workspace pattern when detected, and logs project-vs-lockfile Electron versions. See `BUILD_TOOLCHAIN.md`.

## Version

Candidate: `1.4.9 (32)`.

This is still a refactor candidate, not yet merged to `dev`/`main`. The build-tooling fixes are isolated on `build/shared-toolchain`, branched from `fix/build-tooling-gui`.

## Validation already done by AI sandbox

- RC8 TypeScript/TSX syntax transpilation across 36 source/build TypeScript files: 0 syntax errors.
- RC8 dependency-free build-tool launcher smoke: passed for native `pnpm.exe`, JavaScript/Corepack launcher, `.cmd`, and fallback invocation.
- Python test suite in the sandbox: 99 passed, 1 skipped, 1 environment-only failure because the sandbox uses Python 3.13.5 while `test_desktop_bridge_reports_python_environment` intentionally requires Python 3.12.x.
- RC10 build-tool static/regression checks: PowerShell lexical balance passed; collection-output/`$args` regressions absent; Node build-tool smoke and all `.mjs`/`.cjs` syntax checks passed; `git diff --check` passed before commit.
- No dependency-backed full `pnpm build` is claimed because the clean delivery intentionally contains no `node_modules` and the sandbox cannot reach npm.

## Local validation requested from user

Run on the extracted repository:

```powershell
pnpm install
pnpm check
pnpm android:sync
cd android
gradlew.bat assembleDebug
```

Manual checks with highest priority:

1. Settings dialog in dark/light mode at desktop, Android portrait and Android landscape sizes.
2. Settings scrolling: thumb/track should match theme and not consume excessive width.
3. SMB device discovery -> server -> share -> nested folder -> multi-file selection -> import.
4. SMB guest/account login, saved password, Chinese/space-containing share names.
5. SMB file manager in dark/light mode and Android portrait/landscape.
6. Runtime Auto/Python/JavaScript smoke after the UI rewrite to confirm no regression.

If local compilation reveals errors, continue on `build/shared-toolchain`; do not merge forward first.

## Next planned development

After local validation of this branch:

1. Validate the new build GUI and both Android/Desktop packaging paths locally.
2. Fix any compile/runtime/UI regressions found locally.
3. Merge this branch back into `refactor/settings-smb-ui` after build validation, then continue the runtime refactor flow.
4. Create a new temporary branch for `PlatformAdapter` extraction.
5. Move SMB/file picker/profile/remote host APIs out of `execution.ts` compatibility facades without changing behavior.
6. Extract Workflow Core from `App.tsx` after Platform Adapter is stable.
7. Add node runtime-capability metadata, transaction history, then debugger/execution trace.

## Rules for the next AI session

- Start by reading `AGENTS.md` and this file.
- Treat the user's local build/test reports as source of truth for platform behavior.
- Do not return multiple branch folders; return one clean repository ZIP with `.git` intact.
- Do not merge to `main` until the user explicitly confirms local validation.
