import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type NodeChange } from "@xyflow/react";
import type { WorkflowEnvironment, WorkflowFunctionDefinition, WorkflowNode, WorkflowParameterDefinition } from "../workflow";
import type { WorkspaceRuntimeInputState } from "../workflow-core";
import type { EditorWorkspaceSession } from "./session";

function resolveState<T>(next: SetStateAction<T>, current: T): T {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

export function useEditorWorkspaceSession(session: EditorWorkspaceSession) {
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const snapshot = state.runtime.snapshot;
  const input = state.runtime.input;

  const setNodes: Dispatch<SetStateAction<WorkflowNode[]>> = useCallback((next) => {
    session.updateSnapshot((current) => ({ ...current, nodes: resolveState(next, current.nodes) }));
  }, [session]);
  const setEdges: Dispatch<SetStateAction<Edge[]>> = useCallback((next) => {
    session.updateSnapshot((current) => ({ ...current, edges: resolveState(next, current.edges) }));
  }, [session]);
  const setFunctions: Dispatch<SetStateAction<WorkflowFunctionDefinition[]>> = useCallback((next) => {
    session.updateSnapshot((current) => ({ ...current, functions: resolveState(next, current.functions ?? []) }));
  }, [session]);
  const setRequirements: Dispatch<SetStateAction<string[]>> = useCallback((next) => {
    session.updateSnapshot((current) => ({ ...current, requirements: resolveState(next, current.requirements ?? []) }));
  }, [session]);
  const setEnvironment: Dispatch<SetStateAction<WorkflowEnvironment>> = useCallback((next) => {
    session.updateSnapshot((current) => ({ ...current, environment: resolveState(next, current.environment ?? { pythonImports: [], pythonDefinitions: [] }) }));
  }, [session]);
  const setWorkflowParameters: Dispatch<SetStateAction<WorkflowParameterDefinition[]>> = useCallback((next) => {
    session.updateSnapshot((current) => ({ ...current, parameters: resolveState(next, current.parameters ?? []) }));
  }, [session]);
  const setInput: Dispatch<SetStateAction<WorkspaceRuntimeInputState | undefined>> = useCallback((next) => {
    session.replaceInput(resolveState(next, session.getRuntimeState().input));
  }, [session]);
  const normalizedInput: WorkspaceRuntimeInputState = input ?? { fileName: null, csvText: "", csvBytes: null, csvFiles: [] };
  const updateInputField = useCallback(<K extends keyof WorkspaceRuntimeInputState>(key: K, next: SetStateAction<WorkspaceRuntimeInputState[K]>) => {
    setInput((current) => {
      const base = current ?? { fileName: null, csvText: "", csvBytes: null, csvFiles: [] };
      return { ...base, [key]: resolveState(next, base[key]) };
    });
  }, [setInput]);

  const setFileName = useCallback((next: SetStateAction<string | null>) => updateInputField("fileName", next), [updateInputField]);
  const setCsvText = useCallback((next: SetStateAction<string>) => updateInputField("csvText", next), [updateInputField]);
  const setCsvBytes = useCallback((next: SetStateAction<Uint8Array | null>) => updateInputField("csvBytes", next), [updateInputField]);
  const setCsvFiles = useCallback((next: SetStateAction<Array<{ name: string; bytes: Uint8Array }>>) => updateInputField("csvFiles", next), [updateInputField]);

  const onNodesChange = useCallback((changes: NodeChange<WorkflowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, [setNodes]);
  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, [setEdges]);

  const setPrimaryNodeId: Dispatch<SetStateAction<string | null>> = useCallback((next) => {
    const current = session.getViewState().primaryNodeId;
    session.patchViewState({ primaryNodeId: resolveState(next, current) });
  }, [session]);
  const setSelectedNodeIds: Dispatch<SetStateAction<string[]>> = useCallback((next) => {
    const current = session.getViewState().selectedNodeIds;
    session.patchViewState({ selectedNodeIds: resolveState(next, current) });
  }, [session]);
  const setCurrentCanvasId: Dispatch<SetStateAction<string | null>> = useCallback((next) => {
    const current = session.getViewState().currentCanvasId;
    session.patchViewState({ currentCanvasId: resolveState(next, current) });
  }, [session]);
  const setSelectionMode: Dispatch<SetStateAction<boolean>> = useCallback((next) => {
    const current = session.getViewState().selectionMode;
    session.patchViewState({ selectionMode: resolveState(next, current) });
  }, [session]);

  return {
    runtimeState: state.runtime,
    viewState: state.view,
    primaryNodeId: state.view.primaryNodeId,
    selectedNodeIds: state.view.selectedNodeIds,
    currentCanvasId: state.view.currentCanvasId,
    selectionMode: state.view.selectionMode,
    setPrimaryNodeId,
    setSelectedNodeIds,
    setCurrentCanvasId,
    setSelectionMode,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    functions: snapshot.functions ?? [],
    requirements: snapshot.requirements ?? [],
    environment: snapshot.environment ?? { pythonImports: [], pythonDefinitions: [] },
    workflowParameters: snapshot.parameters ?? [],
    input: normalizedInput,
    setFileName,
    setCsvText,
    setCsvBytes,
    setCsvFiles,
    setNodes,
    setEdges,
    setFunctions,
    setRequirements,
    setEnvironment,
    setWorkflowParameters,
    setInput,
    onNodesChange,
    onEdgesChange,
  };
}
