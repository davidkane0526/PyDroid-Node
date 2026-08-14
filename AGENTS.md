# PyDroid Flow development rules

These rules apply to every developer and coding agent on every device.

## Product and platform rules

- Keep Windows desktop and Android behavior equivalent for shared workflows,
  nodes, parameters, validation, previews, plots, and CSV export.
- Reuse the versioned workflow schema and Python execution core. A workflow
  exported on one platform must import and execute on the other.
- Do not modify or delete the existing `android/` implementation when working
  on the desktop application. Platform-specific code belongs under `desktop/`.
- Record platform progress and known gaps in `README.md` when behavior changes.

## Environment and cleanup rules

- Use repository-relative paths in committed files. Never commit machine SDK,
  JDK, Python, Node, or workspace paths.
- Prefer project-local dependencies. Downloaded tools and caches must live in
  `.tools/` or on an explicitly documented D: or G: path.
- Before installing software, add its purpose, version, location, installation
  method, and removal command to `docs/environment.md`.
- Never commit `android/local.properties`, `node_modules`, `.tools`, Gradle
  output, Python virtual environments, build output, or downloaded toolchains.
- Do not install development tools to C: unless the user explicitly approves it.

## Validation

## Build-mode defaults

- Unless the user explicitly asks for a "正式便携包", do not run the full
  `pnpm desktop:package` compression pipeline.
- For ordinary Windows UI and shared-logic development, prefer
  `pnpm desktop:dev` with Vite hot reload. Use `pnpm desktop` for an immediately
  operable quick test window that reuses the local Python runtime. When the user
  needs a file to test, provide a fast unpacked/test build that reuses that runtime.
- Build the self-contained portable EXE only for an explicit formal portable
  package/release request. A generic request to test the desktop version does
  not authorize the slow portable-package path.
- For Android Web UI changes, prefer `pnpm android:live` and Capacitor/Vite live
  reload. Rebuild/reinstall the APK when Python, Java, Android resources,
  manifest, Gradle configuration, or native bridge code changes.

Run the portable validation suite with:

```bash
bash scripts/cloud-check.sh
```

On Windows, run `pnpm check`. Desktop packaging additionally uses
`pnpm desktop:package`. Android packaging requires JDK 21, Python 3.12, and an
Android SDK with platform 36. Set `PYDROID_PYTHON_EXECUTABLE` only when Python
3.12 is not discoverable as `py -3.12` on Windows or `python3.12` on Linux.

The cloud environment is expected to run unit tests, web builds, and APK builds.
Physical-device validation remains a local final check.
