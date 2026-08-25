export type HostExecutionSource = "local" | "remote";
export type HostExecutionPhase = "queued" | "running" | "cancelling";

export type HostExecutionEntry = {
  executionId: string;
  workspaceId: string;
  workspaceLabel?: string;
  clientId: string;
  source: HostExecutionSource;
  phase: HostExecutionPhase;
  startedAt?: number | null;
};

export type HostExecutionStatus = {
  active: boolean;
  executionId: string | null;
  source: HostExecutionSource | null;
  executions: HostExecutionEntry[];
  runningCount: number;
  queuedCount: number;
  capacity: number;
};

export function emptyHostExecutionStatus(capacity = 1): HostExecutionStatus {
  return {
    active: false,
    executionId: null,
    source: null,
    executions: [],
    runningCount: 0,
    queuedCount: 0,
    capacity,
  };
}

export function normalizeHostExecutionStatus(value: unknown, fallbackCapacity = 1): HostExecutionStatus {
  if (!value || typeof value !== "object") return emptyHostExecutionStatus(fallbackCapacity);
  const record = value as Partial<HostExecutionStatus>;
  const executions = Array.isArray(record.executions)
    ? record.executions.filter((entry): entry is HostExecutionEntry => Boolean(
        entry && typeof entry.executionId === "string" && typeof entry.workspaceId === "string" && typeof entry.clientId === "string"
          && (entry.source === "local" || entry.source === "remote") && ["queued", "running", "cancelling"].includes(entry.phase),
      ))
    : [];
  const first = executions[0] ?? null;
  return {
    active: executions.length > 0,
    executionId: first?.executionId ?? null,
    source: first?.source ?? null,
    executions,
    runningCount: executions.filter((entry) => entry.phase !== "queued").length,
    queuedCount: executions.filter((entry) => entry.phase === "queued").length,
    capacity: Number.isFinite(Number(record.capacity)) ? Math.max(1, Math.floor(Number(record.capacity))) : Math.max(1, Math.floor(fallbackCapacity)),
  };
}
