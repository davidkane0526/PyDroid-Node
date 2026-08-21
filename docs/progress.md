# Current progress — 1.4.93 buildPython path fix

Date: 2026-08-21

## Current accepted baseline

- Windows Remote Web/LAN: **physically verified from an Android tablet on 1.4.91**.
- Desktop listener: fixed TCP `8765`, direct `0.0.0.0` bind.
- Discovery: SSDP/UPnP/mDNS best-effort and independent of HTTP startup.
- Packaged runtime evidence: `<exe-dir>/logs/desktop.log`.
- Windows current output: stable `PyDroid-Flow-Desktop` directory.
- Repeat-build long-path cleanup: single .NET recursive delete; current output uses one `robocopy /MIR` mirror.

## Baseline Consolidation changes

- Version advanced to **1.4.93**, Android versionCode **116**. Architecture baseline remains 1.4.92.
- Desktop Remote API method contract restored to match Android and the earlier correct contract.
- Misleading Desktop discovery `defaultRoute` label replaced with `preferred`; the implementation remains a deterministic local-interface heuristic and does not probe the OS route table.
- Current documentation consolidated around `docs/BASELINE.md`.
- Historical 1.4.83/Phase 10 reliability documents moved under `docs/history/`.
- Git acceptance anchors added for 1.4.91 and historical 1.4.73 Remote/LAN baselines.

## Retained completed architecture

- PlatformAdapter / Host Contract.
- ExecutionController and multi-workspace execution.
- Unified NodeSpec / Node Contract.
- Python/JavaScript parity and modular Runtime Engine.
- Phase 8 workflow language/state/functions.
- Phase 9 Editor Core / Workspace Session.
- Phase 11 Workflow Compatibility & Migration.

## Explicit non-goals

This consolidation does not redesign UI, Remote Web, discovery, execution or migration. It does not restore Phase 10 lifecycle/readiness/recovery infrastructure. Security features removed during the deterministic-core cleanup are documented as deferred policy choices rather than misclassified as useless code.

## Next

Continue feature development from the 1.4.92 consolidated architecture baseline after applying the 1.4.93 buildPython path correction. Remote Web is considered accepted infrastructure unless a new reproducible defect is reported.
