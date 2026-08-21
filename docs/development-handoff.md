# Current development handoff — 1.4.93 buildPython path fix

Branch: `fix/1.4.93-buildpython-path`
Version: **1.4.93**
Android versionCode: **116**
Build revision: `1.4.93-dev-r70-buildpython-path`

## Authoritative baseline

Read `docs/BASELINE.md` first. It supersedes older Phase 10/1.4.83 reliability notes as an active architecture specification.

The important physical acceptance fact is: **1.4.91 Windows Remote Web was successfully opened from an Android tablet over the LAN.** Do not alter the Remote Host start/stop path without a concrete regression.

## Current build-only correction

- 1.4.93 leaves the 1.4.92 architecture baseline unchanged.
- Android full buildPython defaults to `D:\\PyDroidTemp\\tools\\pydroid-flow\\Python\\3.13\\python.exe`, the path confirmed by earlier successful Android builds.
- The exact stale 1.4.92 GUI-generated value `D:\\Code\\Python\\3.13\\python.exe` is migrated to the WorkRoot buildPython path. Other explicit user paths are preserved.
- No PATH/registry probing, Python download/install, or alternate fallback path is restored.

## What the 1.4.92 consolidation changed

- Keeps the accepted 1.4.91 direct Remote Web Host path.
- Restores Desktop HTTP method correctness lost during the over-design cleanup: `/api/health` GET-only, `/api/pair` POST-only, authenticated `/api/*` POST-only; wrong methods return 405, matching Android behavior.
- Renames the Desktop LAN interface hint from the inaccurate `defaultRoute` concept to `preferred`; no route probe is added.
- Consolidates stale roadmap/progress/handoff documentation around one current baseline.
- Preserves Phase 11 Workflow Compatibility & Migration.
- Keeps historical Phase 10 security/readiness material under `docs/history/` instead of presenting it as active guidance.

## What is intentionally not restored

No PowerShell/UAC/firewall management, readiness gate, host lifecycle generation, periodic reconciliation, network watcher, automatic recovery, retry/fallback build path, PIN cooldown, token TTL/IP binding or API rate limiting is introduced by this consolidation.

The last four are acknowledged as legitimate optional security policies, but they are not required for the accepted LAN baseline and must not be coupled to Host startup if reconsidered later.

## Build contract

Windows current output: `D:\\PyDroidTemp\\PyDroid-Flow-Desktop` by default.
Packaged runtime log: `<exe-dir>\\logs\\desktop.log`.
Repeat builds mirror the new `win-unpacked` output into the stable current directory.
Long-path workspace cleanup uses the single .NET implementation documented in `BUILD_TOOLCHAIN.md`.

## Next development step

Resume post-Phase-11 work from this baseline. Treat Remote Web as accepted infrastructure, not an active refactor target. Changes to Remote Web should be bug-driven and narrow.
