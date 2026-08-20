# Phase 9 — Editor Core & Workspace Session

Version started: **1.4.60 (83)**  
Branch: `phase9/editor-core-workspace-session`

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

`src/editor-core/commands.ts` starts the command layer with graph deletion and disconnection. New editor mutations should progressively move behind commands instead of embedding Workflow Core rules in pointer/menu handlers. Later Phase 9 revisions should migrate group/function/resource/import/save operations through the same boundary.

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

The removable automated-diagnostics feature now adds two Phase 9 cases:

1. per-workspace Editor Session isolation across graph/input/history/dirty/view state;
2. gesture-policy contract separation for desktop/mobile, node/group and mobile canvas.

Together with the four Phase 8 runtime cases, a Desktop/Android host with Python available should report **6/6**. These checks prove policy wiring and state boundaries; they do not pretend to synthesize a physical Android touch stream.

## Phase 9 continuation

1. Move remaining graph/resource/function mutations behind Editor Commands.
2. Move save/import/new/autosave/restore lifecycle into explicit session services rather than React event handlers.
3. Give Resources (`node/function/group/flow`) a common resource contract while preserving target-specific interaction policy.
4. Route Remote Web workspace selection through the same session identity boundary.
5. Continue reducing `App.tsx` by responsibility, not by cosmetic file splitting.

## Non-goals for 1.4.60

- no visual redesign;
- no forced gesture unification between Desktop and Android;
- no forced gesture unification between node and group;
- no workflow schema change;
- no runtime semantic change.
