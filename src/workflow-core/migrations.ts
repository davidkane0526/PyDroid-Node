export type WorkflowMigration = (document: Record<string, unknown>) => Record<string, unknown>;

export type WorkflowCompatibilityErrorCode =
  | "invalid-document"
  | "invalid-schema-version"
  | "future-schema-version"
  | "missing-schema-migration"
  | "invalid-schema-migration"
  | "future-node-version"
  | "missing-node-migration"
  | "invalid-node-migration"
  | "future-function-version"
  | "incompatible-function-signature";

export class WorkflowCompatibilityError extends Error {
  readonly name = "WorkflowCompatibilityError";
  readonly code: WorkflowCompatibilityErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: WorkflowCompatibilityErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export type WorkflowSchemaMigrationStep = { fromVersion: number; toVersion: number };
export type WorkflowSchemaMigrationResult = {
  document: Record<string, unknown>;
  fromVersion: number;
  toVersion: number;
  steps: WorkflowSchemaMigrationStep[];
};

const migrations = new Map<number, WorkflowMigration>();

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

export function registerWorkflowMigration(fromVersion: number, migration: WorkflowMigration): void {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error("Workflow migration version must be a positive integer");
  if (migrations.has(fromVersion)) throw new Error(`Workflow migration v${fromVersion} is already registered`);
  migrations.set(fromVersion, migration);
}

export function workflowSchemaVersionOf(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowCompatibilityError("invalid-document", "工作流文件必须是JSON对象");
  }
  const raw = (value as Record<string, unknown>).schemaVersion;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new WorkflowCompatibilityError("invalid-schema-version", `不支持的工作流版本：${String(raw)}`, { schemaVersion: raw });
  }
  return raw;
}

export function validateWorkflowMigrationEnvelope(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowCompatibilityError("invalid-document", "工作流文件必须是JSON对象");
  }
  const document = value as Record<string, unknown>;
  if (typeof document.name !== "string" || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new WorkflowCompatibilityError("invalid-document", "工作流缺少name、nodes或edges");
  }
  if (document.requirements !== undefined && (!Array.isArray(document.requirements) || document.requirements.some((item) => typeof item !== "string"))) {
    throw new WorkflowCompatibilityError("invalid-document", "工作流 requirements 必须是字符串数组");
  }
  if (document.functions !== undefined && !Array.isArray(document.functions)) {
    throw new WorkflowCompatibilityError("invalid-document", "工作流 functions 必须是数组");
  }
}

export function migrateWorkflowDocumentWithReport(value: unknown, currentVersion: number): WorkflowSchemaMigrationResult {
  const versionAtOpen = workflowSchemaVersionOf(value);
  if (versionAtOpen > currentVersion) {
    throw new WorkflowCompatibilityError(
      "future-schema-version",
      `工作流版本 v${versionAtOpen} 高于当前支持的 v${currentVersion}`,
      { schemaVersion: versionAtOpen, currentVersion },
    );
  }

  let document = cloneRecord(value as Record<string, unknown>);
  let version = versionAtOpen;
  const steps: WorkflowSchemaMigrationStep[] = [];

  while (version < currentVersion) {
    const migration = migrations.get(version);
    if (!migration) {
      throw new WorkflowCompatibilityError(
        "missing-schema-migration",
        `工作流缺少 v${version} → v${version + 1} 的迁移器`,
        { fromVersion: version, toVersion: version + 1 },
      );
    }
    let nextDocument: Record<string, unknown>;
    try {
      nextDocument = migration(cloneRecord(document));
    } catch (error) {
      if (error instanceof WorkflowCompatibilityError) throw error;
      throw new WorkflowCompatibilityError(
        "invalid-schema-migration",
        `工作流迁移器 v${version} 执行失败：${error instanceof Error ? error.message : String(error)}`,
        { fromVersion: version, cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (!nextDocument || typeof nextDocument !== "object" || Array.isArray(nextDocument)) {
      throw new WorkflowCompatibilityError("invalid-schema-migration", `工作流迁移器 v${version} 返回了无效文档`, { fromVersion: version });
    }
    const next = nextDocument.schemaVersion;
    if (typeof next !== "number" || !Number.isInteger(next) || next !== version + 1) {
      throw new WorkflowCompatibilityError(
        "invalid-schema-migration",
        `工作流迁移器 v${version} 未生成 v${version + 1}`,
        { fromVersion: version, expectedVersion: version + 1, actualVersion: nextDocument.schemaVersion },
      );
    }
    document = cloneRecord(nextDocument);
    steps.push({ fromVersion: version, toVersion: next });
    version = next;
  }

  return { document, fromVersion: versionAtOpen, toVersion: version, steps };
}

export function migrateWorkflowDocument(value: unknown, currentVersion: number): Record<string, unknown> {
  return migrateWorkflowDocumentWithReport(value, currentVersion).document;
}

export function isWorkflowCompatibilityError(error: unknown, code?: WorkflowCompatibilityErrorCode): error is WorkflowCompatibilityError {
  return error instanceof WorkflowCompatibilityError && (code === undefined || error.code === code);
}

export function normalizeWorkflowNodeVersions(document: Record<string, unknown>): Record<string, unknown> {
  const normalizeNodes = (raw: unknown): unknown => !Array.isArray(raw) ? raw : raw.map((node) => {
    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
    return { ...record, data: { ...data, nodeVersion: data.nodeVersion === undefined ? 1 : data.nodeVersion } };
  });
  const normalizedFunctions = Array.isArray(document.functions)
    ? document.functions.map((definition) => {
      if (!definition || typeof definition !== "object") return definition;
      const record = definition as Record<string, unknown>;
      return { ...record, nodes: normalizeNodes(record.nodes) };
    })
    : document.functions;
  return {
    ...document,
    nodes: normalizeNodes(document.nodes),
    ...(normalizedFunctions === undefined ? {} : { functions: normalizedFunctions }),
  };
}
