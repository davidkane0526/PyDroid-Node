export type WorkflowMigration = (document: Record<string, unknown>) => Record<string, unknown>;

const migrations = new Map<number, WorkflowMigration>();

export function registerWorkflowMigration(fromVersion: number, migration: WorkflowMigration): void {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) throw new Error("Workflow migration version must be a non-negative integer");
  migrations.set(fromVersion, migration);
}

export function migrateWorkflowDocument(value: unknown, currentVersion: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作流文件必须是JSON对象");
  let document = { ...(value as Record<string, unknown>) };
  let version = Number(document.schemaVersion);
  if (!Number.isInteger(version) || version < 0) throw new Error(`不支持的工作流版本：${String(document.schemaVersion)}`);
  if (version > currentVersion) throw new Error(`不支持的工作流版本：${version}`);

  while (version < currentVersion) {
    const migration = migrations.get(version);
    if (!migration) throw new Error(`工作流缺少 v${version} → v${version + 1} 的迁移器`);
    document = migration(document);
    const next = Number(document.schemaVersion);
    if (next !== version + 1) throw new Error(`工作流迁移器 v${version} 未生成 v${version + 1}`);
    version = next;
  }
  return document;
}

export function normalizeWorkflowNodeVersions(document: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(document.nodes)) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!node || typeof node !== "object") return node;
      const record = node as Record<string, unknown>;
      const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
      return { ...record, data: { ...data, nodeVersion: Number.isInteger(Number(data.nodeVersion)) ? Number(data.nodeVersion) : 1 } };
    }),
  };
}
