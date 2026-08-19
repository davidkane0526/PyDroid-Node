# Unified NodeSpec / Node Contract

Phase 4 source-of-truth rules for adding or changing nodes.

## 1. Purpose

A node must not have separate capability truth in the palette, Agent, Python runtime, JavaScript runtime and validation code. `NodeSpec` is the authoring metadata source; `src/nodeContract.ts` normalizes NodeSpec into the complete execution contract consumed by the application.

Current contract dimensions:

- `runtimeSupport`: Python / JavaScript support declared by NodeSpec;
- `executionModel`: `standard`, `control-flow`, `custom-code`, reserved `function`, `ui`, or `workflow`;
- `deterministic`: whether identical inputs/configuration/state are expected to reproduce the same output;
- `sideEffect`: whether execution changes external/UI/runtime state;
- `cachePolicy`: whether the node may be reused by a future workflow cache;
- `stateScope`: `none`, `temporary`, or reserved `global`;
- `stateAccess`: `none`, `read`, `write`, or `read-write`;
- `functionRole`: reserved `none`, `definition`, or `call`.

`validateNodeContracts()` enforces basic invariants. A stateful, side-effecting or non-deterministic node must not silently become cacheable.

## 2. Runtime support

New catalog nodes default to Python-only unless `runtimeSupport` is explicitly declared. Nodes implemented by both engines must use:

```ts
runtimeSupport: ["python", "javascript"]
```

Do not create another `JAVASCRIPT_SUPPORTED_NODE_TYPES`-style independent list. `src/runtime/javascript/support.ts` derives support from NodeContract.

Legacy node types which are intentionally accepted for backwards compatibility but no longer appear in the visible catalog belong in the compatibility-contract section of `nodeContract.ts`, with an explicit note.

## 3. Function nodes — reserved architecture

Future reusable function support should be modeled as real nodes/contracts rather than hiding more behavior inside notebook code cells.

Planned roles:

```text
function definition
  executionModel = function
  functionRole = definition

function call
  executionModel = function
  functionRole = call
```

A function definition must have a stable identifier/version/signature. A call node must refer to that identifier and derive typed input/output ports from the signature. Workflow serialization/migration must preserve the definition before function nodes are enabled in production.

`custom.python_function` remains an inline Python custom-code transform. It is not a substitute for the future reusable definition/call model.

## 4. Variable nodes — reserved architecture

State must always be explicitly scoped.

### Temporary variables

Temporary variables are execution-scoped and reset for a new workflow run:

```text
stateScope = temporary
get -> stateAccess = read
set -> stateAccess = write
```

The existing `variable.get` / `variable.set` nodes are described this way by NodeSpec/NodeContract.

### Global variables

`stateScope = global` is reserved, but global variable nodes must not be implemented until persistence and isolation are specified.

Important rule: **global must never silently mean process-global across all tabs, remote clients, or users.** The intended default is workspace-global. Before implementation decide explicitly whether a value is:

- declaration/default stored in the workflow document;
- runtime value retained only for the current workspace session;
- persist-across-run value stored by an explicit persistence policy.

Global state also requires workflow migration, copy/export semantics, Remote Web behavior and concurrent-workspace isolation tests.

## 5. Side effects and caching

Examples of side effects include UI dialogs, exports, mutable variable writes and printing/logging intended as an observable action.

Rules:

- side-effecting nodes default to `uncacheable`;
- non-deterministic nodes default to `uncacheable`;
- state-reading/writing nodes default to `uncacheable` until a state-version-aware cache exists;
- graph pre-execution (for example `ui.alert` preview dependencies) must inspect NodeContract before assuming an upstream subgraph is safe to execute twice.

## 6. Checklist for every new node

1. Add one `NodeSpec` with stable `nodeType`, parameters and typed ports.
2. Declare `runtimeSupport` explicitly if JavaScript is implemented; Python-only is the safe default.
3. Declare non-default execution/state/side-effect/cache metadata.
4. Add Python and/or JavaScript implementation.
5. Add node-contract tests and runtime tests.
6. If both runtimes are supported, add a Phase 5 golden parity case before relying on Auto runtime selection.
7. If workflow serialization changes, add schema migration before shipping.
8. Do not add a new parallel capability list in UI, Agent or runtime code.


## 5. Runtime auto / validation / pre-execution

Node Contract is no longer limited to catalog inspection. It now also owns several previously scattered runtime decisions:

- **Runtime auto-selection**: the preferred runtime checks should use Node Contract runtime support rather than a separate hand-maintained capability table.
- **Workflow import validation**: workflow documents should reject unknown node types by looking up a Node Contract, not by assuming every stringly-typed node is valid.
- **Side-effect-aware preview execution**: any helper execution used only to preview UI content (for example alert preview preparation) must consult Node Contract first and skip slices containing stateful or side-effecting nodes.

Rule of thumb: if a decision depends on whether a node is portable, stateful, safe to re-run, or eligible for speculative execution, that decision belongs to Node Contract or a helper derived from it.
