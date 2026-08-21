# Phase 11 — Workflow Compatibility & Migration

Phase 11 starts from the user-accepted `1.4.76 (99)` Phase 10 freeze candidate and establishes long-lived compatibility rules for workflow documents, reusable functions, NodeSpec evolution, editor resources and autosave data. It does **not** redesign UI or modify the accepted Remote Web/LAN path.

## Frozen compatibility versions

- Workflow document schema: **v3** (`CURRENT_WORKFLOW_SCHEMA_VERSION = 3`).
- Editor resource envelope schema: **v2** (`EDITOR_RESOURCE_SCHEMA_VERSION = 2`).
- Node contract versions remain owned by NodeSpec/NodeContract. Existing production nodes are currently v1 unless their contract explicitly says otherwise.

A version number is not enough by itself. Every old-to-new step must have an explicit registered migration. Missing steps fail closed.

## Workflow migration pipeline

The load path is intentionally ordered:

```text
JSON parse
  -> historical envelope validation
  -> schema version detection
  -> schema migration chain (vN -> ... -> v3)
  -> normalize legacy missing nodeVersion to v1
  -> NodeSpec / node-version migration
  -> edge + group/function handle reconciliation
  -> reusable function-call version/signature reconciliation
  -> current semantic validation
  -> canonical current WorkflowDocument
```

`parseWorkflowWithReport()` returns both the current document and a compatibility report. `parseWorkflow()` uses the same pipeline and only omits the report.

### Schema migration rules

1. Migrations are registered by their **source version**.
2. Registration is immutable: a registered historical step cannot be overwritten later in the same runtime.
3. A step must advance to exactly the expected next schema version.
4. Missing or malformed steps are compatibility errors rather than best-effort guesses.
5. A future schema version is rejected before current-shape interpretation. Current software must not reinterpret a future document as a damaged old document.
6. Migration operates on clones and must not mutate the source payload supplied by the caller.

Current built-in chain:

- **v1 -> v2**: introduces the document-level reusable `functions` collection.
- **v2 -> v3**: canonicalizes `functions` and `requirements` as owned document arrays.

## NodeSpec evolution

`src/workflow-core/node-migrations.ts` owns per-node-type migration chains. A migration may:

- rename parameters;
- remove deprecated parameters;
- add migration-time defaults;
- replace a node type;
- advance node version;
- rename input handles;
- rename output handles.

Handle renames are propagated to graph edges and to group/function boundary bindings. Multi-step handle renames are composed across the chain.

Hard invariants:

- node `id` is stable and may never be changed by a migration;
- a node newer than the current NodeContract fails as `future-node-version`;
- an older node with a missing migration step fails as `missing-node-migration`;
- a replacement type must exist and use a supported version;
- current NodeSpec defaults are hydrated only after version migration;
- unknown nodes remain the responsibility of current semantic validation rather than being silently rewritten.

When a future NodeSpec changes from v1 to v2, the required sequence is:

1. bump that NodeSpec/NodeContract version;
2. register `nodeType v1 -> v2` migration;
3. add old-node fixture/test covering parameters and handles that changed;
4. run `test:workflow-compatibility` and full `pnpm check` before release.

## Reusable function compatibility

A saved `function.call` is reconciled against its document-level definition only when compatibility is provable.

- call version newer than the definition: reject as future;
- same version: keep it;
- older call with saved input/output signature exactly compatible with the newer definition: advance the call version and refresh the saved signature;
- older call with changed or missing signature evidence: reject as `incompatible-function-signature`.

The migration layer deliberately does not guess whether a changed reusable function is semantically compatible.

## Editor resources

Saved Node, Group and Flow resources have a separate v2 resource envelope because their lifecycle differs from a standalone WorkflowDocument.

- Saved Node: migrate its NodeSpec/defaults.
- Group: migrate its graph fragment, edge handles and group boundaries without requiring document-level context the fragment does not own.
- Flow: run through the real Workflow parser/migration pipeline and persist the canonical current document when safe.

Compatibility states are `current`, `migrated`, `future`, and `invalid`.

Future or invalid resources are **opaque protected payloads**:

- the original raw object is retained;
- ordinary persistence writes the original raw object back rather than a derived compatibility view;
- rename/remove/lock mutation is disabled for protected resources;
- protected resources are excluded from the interactive resource palette;
- current software does not add new UI messages for this protection path.

A deliberate explicit save with the same resource id replaces the protected payload with a current resource and clears the opaque protection entry.

## Autosave and future documents

Autosave distinguishes three states:

1. current/migratable document — readable and writable;
2. malformed JSON — corrupt and removable/quarantinable;
3. syntactically valid but incompatible/future document — preserved verbatim and protected from overwrite.

Opening a future workflow is atomic: parsing/migration must succeed before the active Editor Session is changed. A failed future-version open therefore cannot dirty or replace the current workspace.

## Historical corpus gate

`tests/workflow-compatibility/fixtures/` is not a synthetic-only sample set. `scripts/workflow-history-corpus-audit.mjs` scans the complete local `.git` history through the accepted 1.4.76 boundary and hashes every committed `.workflow.json` document.

At the Phase 11 freeze boundary, Git history contains **8 unique historical workflow documents** using schema versions **1 and 2**, and all 8 are present in the corpus. A separate future-v99 fixture exercises forward-version protection.

This gate fails if a historical workflow exists in Git but is absent from the compatibility corpus.

## Compatibility execution gate

`scripts/workflow-compatibility-smoke.mjs` uses the real production migration/parser code. It verifies:

```text
historical file
  -> current parser/migration
  -> current semantic validation
  -> canonical save
  -> reopen/idempotency
```

It also executes a migrated real schema-v1 workflow through both current JavaScript and Python runtimes and requires equal results. Node migration guards, function signature reconciliation, resource opaque preservation and failure paths are included in the same dependency-light gate.

## Strict TypeScript gate

`scripts/workflow-compatibility-typecheck-smoke.mjs` performs a strict no-emit TypeScript compile of the Phase 11 production compatibility modules. It uses the repository TypeScript compiler when dependencies are installed and a minimal `@xyflow/react` type shim only for the dependency-light environment.

This does not replace the real production `tsc --noEmit -p tsconfig.json` in `pnpm build`; it exists to catch strict-null/inference regressions before the final user-host build even when the cloud environment has no installed frontend dependencies.

## Freeze audit

`scripts/phase11-freeze-audit.mjs` protects Phase 11 scope. It asserts that:

- Workflow schema remains v3;
- Editor resource schema remains v2;
- the full history corpus, real migration smoke, strict TypeScript smoke and freeze audit itself are part of `test:workflow-compatibility`;
- migration registration does not leak into `App.tsx`;
- future/invalid resources are filtered from interactive UI;
- no new `setMessage()` call was added to `App.tsx` relative to the accepted 1.4.76 baseline;
- frozen Desktop/Android Remote Web/LAN implementation files are unchanged from the accepted 1.4.76 baseline.

## In-app diagnostics

The visible full-host diagnostic contract remains **22 cases**. Phase 11 deliberately does not add new visible rows or labels.

Compatibility coverage is embedded into existing cases:

- Editor document lifecycle: historical schema migration, future autosave preservation and atomic future-open rejection;
- Resource persistence: legacy resource migration and exact future-resource preservation;
- JavaScript/Python workspace cases: migration and execution of a real v1 workflow.

This strengthens the final real-host report without changing UI copy.

## Phase 11 freeze criteria

Phase 11 is complete only when all of the following hold:

- all historical Git workflow documents are represented in the corpus;
- historical v1/v2 -> v3 migration succeeds through the real parser;
- canonical save/reopen is idempotent;
- Python/JavaScript execution parity holds after migration;
- future workflow/resource/autosave payloads are preserved non-destructively;
- NodeSpec/function unsafe upgrades fail closed;
- strict compatibility TypeScript smoke passes;
- Phase 1-10 architecture/runtime/host/UI regression gates still pass;
- Remote Web/LAN frozen files and current UI copy remain unchanged;
- final user-host dependency-backed build is the last production build gate.
