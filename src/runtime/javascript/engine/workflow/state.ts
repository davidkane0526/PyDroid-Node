import { Table } from "../table";

const STATE_TYPE = "__pydroid_state_type__";

type EncodedState = Record<string, unknown>;

function encodeScalar(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  return undefined;
}

export function encodeStateValue(value: unknown): unknown {
  if (value instanceof Table) {
    return { [STATE_TYPE]: "table", columns: [...value.columns], rows: value.rows().map((row) => row.map(encodeStateValue)) };
  }
  if (value instanceof Uint8Array) {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return { [STATE_TYPE]: "bytes", base64: btoa(binary) };
  }
  if (Array.isArray(value)) return value.map(encodeStateValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeStateValue(item)]));
  }
  const scalar = encodeScalar(value);
  if (scalar !== undefined) return scalar;
  throw new Error(`Workspace state does not support value type ${typeof value}`);
}

export function decodeStateValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeStateValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const kind = record[STATE_TYPE];
  if (kind === "table") {
    const columns = Array.isArray(record.columns) ? record.columns.map(String) : null;
    const rows = Array.isArray(record.rows) ? record.rows : null;
    if (!columns || !rows) throw new Error("Invalid workspace table state");
    return new Table(columns, rows.map((row) => {
      if (!Array.isArray(row)) throw new Error("Invalid workspace table row");
      return row.map(decodeStateValue) as Array<string | number | boolean | null>;
    }));
  }
  if (kind === "bytes") {
    if (typeof record.base64 !== "string") throw new Error("Invalid workspace bytes state");
    const binary = atob(record.base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decodeStateValue(item)]));
}

export function decodeWorkspaceState(raw: unknown): Map<string, unknown> {
  if (raw === undefined || raw === null) return new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Workspace state must be an object");
  const entries = Object.entries(raw as EncodedState);
  if (entries.length > 1_000) throw new Error("Workspace state is limited to 1000 variables");
  return new Map(entries.map(([name, value]) => [name, decodeStateValue(value)]));
}

export function encodeWorkspaceState(state: Map<string, unknown>): EncodedState {
  if (state.size > 1_000) throw new Error("Workspace state is limited to 1000 variables");
  return Object.fromEntries([...state.entries()].map(([name, value]) => [name, encodeStateValue(value)]));
}
