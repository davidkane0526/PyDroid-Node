# Phase 9 — Editor Core & Workspace Session

Version started: **1.4.60 (83)**  
Current branch: `phase9/resource-remote-agent-session`

## Goal

Phase 9 removes editor-state ownership and interaction semantics from the React application shell without changing the accepted Desktop/Android UI. The target dependency direction is:

```text
Mouse / touch / pen events
        ↓
Input profile + Gesture Policy
        ↓
Editor intent / Editor Command
        ↓
EditorWorkspaceSession
        ↓
Workflow Core / Execution / Persistence
        ↓
React subscription and rendering
```

`App.tsx` is not allowed to become the semantic owner of workflow graph state again. Splitting JSX into more files alone is not considered completion.

## Editor Workspace Session

`src/editor-core/session.ts` introduces one `EditorWorkspaceSession` per tab/workspace. It owns:

- workflow snapshot (`nodes`, `edges`, reusable `functions`, `requirements`);
- selected input files/content retained by the workspace;
- workflow history and dirty/saved signature;
- session-only editor view state such as selection, primary node and current subcanvas;
- an observable revision used by the React adapter.

`EditorSessionStore` maps tab IDs to sessions and is the only application-level session registry. `src/editor-core/react.ts` uses `useSyncExternalStore` to expose session state to React Flow; `App.tsx` no longer owns a parallel `useNodesState` / `useEdgesState` graph.

## Editor Command boundary

`src/editor-core/commands.ts` now owns graph deletion/disconnection plus structural editor transactions: node insertion/duplication/parameter edits/layout, group creation/dissolution, group-to-function save/update, function call insertion/materialization/deletion and resource insertion. The command result carries selection metadata so the UI does not have to recreate post-transaction state.

`EditorWorkspaceSession.applyGraphCommand()` captures history and applies the new workflow snapshot atomically. Continuous edits may provide a Session-owned history group/window so several slider/text updates become one undo transaction. Undo/redo/history restore are also Session operations rather than a React-side `WorkflowHistory` mirror.

## Gesture architecture

Desktop and mobile interactions are intentionally **not equivalent**, and node/group targets are intentionally **not interchangeable**. `src/editor-core/gesture-policy.ts` is the source of truth for timing, movement thresholds and semantic actions.

| Target | Desktop | Mobile / coarse pointer |
| --- | --- | --- |
| Node | click select; double-click/right-click node actions; drag move | tap select; stationary long-press enters multi-select; drag movement cancels hold |
| Group | click select; double-click enters group/subflow; right-click group actions | tap select; stationary long-press retains multi-select; double-tap enters group; drag movement cancels hold |
| Canvas | mouse pan/selection according to desktop React Flow mode | quick one-finger drag pans; stationary hold activates marquee; two-finger gesture remains pinch zoom |
| Resource | desktop context menu/drag | hold opens resource actions; movement threshold yields to drag/scroll |
| Tab | desktop context menu/double-click rename/drag reorder | hold opens tab actions; movement threshold yields to tab drag/scroll |

The policy currently preserves accepted interaction behavior while making future changes local to the relevant `(input profile, target kind)` pair. A change to Android group long-press must not implicitly change desktop nodes.

## Diagnostics

The removable automated-diagnostics feature now adds eleven Phase 9 cases:

1. per-workspace Editor Session isolation across graph/input/history/dirty/view state;
2. Editor Command transaction ownership, including history/undo/redo for group create/dissolve;
3. node insertion/duplication/parameter history coalescing/layout transactions;
4. connection/reconnect, node replacement and metadata/template transactions;
5. one-history-entry drag transactions including structure containment;
6. lifecycle autosave read/write/corruption quarantine;
7. save/open/close/autosave-restore lifecycle;
8. unified Resource Contract capabilities for node/function/group/flow resources;
9. Local/Remote workspace-session identity isolation by workspace + client + source;
10. atomic AI Agent batch graph surgery with one undo baseline and no partial writes;
11. gesture-policy contract separation for desktop/mobile, node/group and mobile canvas.

Together with the four Phase 8 runtime cases, a Desktop/Android host with Python available should report **15/15**. These checks prove policy wiring and state boundaries; they do not pretend to synthesize a physical Android touch stream.

## 1.4.61 milestone — lifecycle and structural resources

- `src/editor-core/workflow-structure.ts` is now the source of truth for dynamic node/group interface derivation and group-interface repair.
- `src/editor-core/resources.ts` captures/instantiates saved node/group resources without UI-owned graph surgery.
- `src/editor-core/lifecycle.ts` owns autosave serialization/read/write/corruption quarantine and saved-signature updates.
- import/open/new paths replace the Session snapshot atomically through `replaceSnapshot()` instead of independently mutating nodes/edges/functions/requirements.
- `App.tsx` has dropped from the 1.4.60 baseline of 4679 lines to 4520 lines while preserving the accepted UI. The reduction is a consequence of moving semantics out of React, not a line-count target.

## 1.4.62 milestone — node mutations and document lifecycle

- `insert-node`, `duplicate-node`, `update-node-parameters` and `arrange-canvas` are explicit Editor Commands.
- continuous parameter edits use Session history coalescing instead of a React-owned edit timer;
- `src/editor-core/layout.ts` owns structure-child and canvas arrangement rules;
- `EditorWorkspaceLifecycleService` owns `saveSession`, serialized open/apply, reset, close dirty decisions and explicit autosave restore;
- current-tab save/open/import and multi-tab save-before-close delegate to that lifecycle service;
- explicit autosave restore is available to recovery flows and diagnostics, while normal application startup deliberately remains one empty workflow.
- `App.tsx` is 4464 lines in this milestone, down from 4520 in 1.4.61 and 4679 at the 1.4.60 foundation.

## 1.4.63 milestone — connections, replacement and drag history

- `src/editor-core/connection.ts` centralizes port existence, value-type compatibility, structured loop-back and cycle validation.
- `connect-edge` and `reconnect-edge` now own graph connection mutations; reconnect applies the same one-input/one-handle exclusivity as normal connect.
- `replace-node`, `update-node-label`, `update-node-tags`, `update-group-port-label` and `apply-code-template` move the remaining inspector/replacement graph mutations out of React.
- `beginHistoryTransaction()` / `commitHistoryTransaction()` let React Flow stream live drag positions without polluting history. `commit-node-drag` owns final structure-container and branch assignment.
- Gesture behavior remains profile/target specific and unchanged; this milestone changes ownership, not accepted Desktop/Android interaction meaning.

## 1.4.64 milestone — Resource Contract, Remote identity and AI batch transactions

- `src/editor-core/resource-contract.ts` defines one capability contract for catalog nodes, saved nodes, functions, groups and full workflows without collapsing their distinct primary actions. Built-in and locked resources are protected centrally.
- `src/workspace-session-identity.ts` defines the cross-layer workspace identity as `workspaceId + clientId + source`. Execution results and persistent workspace variables use that identity instead of a bare tab ID.
- Remote Web clients may therefore reuse common local tab IDs such as `default` without sharing state with another browser/client. Host execution matching uses the same workspace/client/source identity.
- `EditorWorkspaceSession.applyGraphCommandBatch()` provides an atomic multi-command boundary. AI plans stage/validate in `src/editor-core/agent-operations.ts` and commit once, producing one undo entry; invalid plans are rejected before any partial graph mutation reaches the Session.
- The gesture matrix remains unchanged and independent. This milestone changes resource/session/agent ownership, not Desktop/Mobile or Node/Group interaction meaning.

## Phase 9 continuation

1. Move remaining resource-library persistence mutations behind explicit resource services while preserving the shared capability contract.
2. Continue converging tab/session lifecycle and host execution presentation on the explicit workspace identity.
3. Reduce remaining UI-owned selection/import convenience mutations and inspect whether Phase 9 can freeze without changing accepted gestures.
4. Continue reducing `App.tsx` by responsibility, not by cosmetic file splitting.

## Non-goals for 1.4.60–1.4.64

- no visual redesign;
- no forced gesture unification between Desktop and Android;
- no forced gesture unification between node and group;
- no workflow schema change;
- no runtime semantic change.
