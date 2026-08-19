# Android Host Architecture

Phase 7 rule: Capacitor plugins are transport/binding façades. Native host behavior belongs to focused Java services.

## Composition

`PythonExecutorPlugin` creates one `AndroidHostServices` instance in `load()` and closes it in `handleOnDestroy()`. `AndroidHostServices` owns the shared worker executors and the single `PythonExecutionController`, then composes:

- `AndroidPythonService` — Chaquopy warm-up, workflow submit/cancel/status, environment and analysis calls.
- `AndroidSmbService` — jcifs-ng negotiation, share listing, server discovery and SMB file reads.
- `AndroidFileService` — Android Storage Access Framework data-file/folder picker and bounded reads.
- `AndroidProfileService` — app profile directories plus persisted workflow-library tree/document operations.
- `AndroidSecretService` — bindings around Android-keystore-backed `AgentSecretStore`.
- `AndroidRemoteService` — `RemoteWorkflowServer` lifecycle.

Existing lower-level primitives such as `PythonExecutionController`, `RemoteWorkflowServer`, `LanDiscoveryService`, `MdnsService`, `SsdpService` and `AgentSecretStore` remain specialized implementations behind these services.

## Stable boundary

Do not rename/remove Capacitor methods in `PythonExecutorPlugin` merely because internal services move. TypeScript `src/platform/android-plugin.ts` is the public renderer boundary. Activity callbacks for file/folder picking are also part of the binding contract.

## Growth rule

Do not add SMB, Python, SAF, HTTP, profile filesystem or secret implementation code directly to `PythonExecutorPlugin`. Add/extend the relevant service. If one Android host service grows beyond a focused domain, split it again rather than moving logic back to the plugin.

`pnpm test:android-host-architecture` enforces these invariants.
