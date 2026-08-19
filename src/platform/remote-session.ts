import type { RemoteAccessPolicy } from "./types";

const REMOTE_SESSION_TOKEN_KEY = "pydroid-flow.remote-session-token.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type LocationLike = Pick<Location, "search" | "protocol" | "hostname">;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RemoteSessionEnvironment = {
  location: LocationLike | null;
  storage: StorageLike | null;
  fetch: FetchLike;
};

export type RemoteSessionMessages = {
  missingToken: string;
  healthFailed: string;
  pairFailed: string;
};

function defaultEnvironment(): RemoteSessionEnvironment {
  return {
    location: typeof window === "undefined" ? null : window.location,
    storage: typeof sessionStorage === "undefined" ? null : sessionStorage,
    fetch: globalThis.fetch.bind(globalThis),
  };
}

export function isRemoteBrowserSession(environment: RemoteSessionEnvironment = defaultEnvironment()): boolean {
  const location = environment.location;
  if (!location || !/^https?:$/.test(location.protocol)) return false;
  const host = location.hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return Boolean(host && host !== "localhost" && host !== "127.0.0.1" && host !== "::1");
}

export function createRemoteSessionClient(
  messages: RemoteSessionMessages,
  environmentProvider: () => RemoteSessionEnvironment = defaultEnvironment,
) {
  function token(): string {
    const storage = environmentProvider().storage;
    const value = storage?.getItem(REMOTE_SESSION_TOKEN_KEY);
    if (!value) throw new Error(messages.missingToken);
    return value;
  }

  async function getAccessPolicy(): Promise<RemoteAccessPolicy> {
    const response = await environmentProvider().fetch("/api/health");
    if (!response.ok) throw new Error(messages.healthFailed);
    return response.json() as Promise<RemoteAccessPolicy>;
  }

  async function pair(pin = ""): Promise<void> {
    const environment = environmentProvider();
    const response = await environment.fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const text = await response.text();
    let parsed: { token?: string; error?: string } = {};
    try { parsed = JSON.parse(text) as { token?: string; error?: string }; } catch { /* use generic error */ }
    if (!response.ok || !parsed.token) throw new Error(String(parsed.error ?? messages.pairFailed));
    const storage = environment.storage;
    if (!storage) throw new Error(messages.pairFailed);
    storage.setItem(REMOTE_SESSION_TOKEN_KEY, parsed.token);
  }

  async function request<T>(path: string, payload: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}): Promise<T> {
    const response = await environmentProvider().fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PyDroid-Token": token() },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `远程服务请求失败（${response.status}）`;
      try { message = String((JSON.parse(text) as { error?: string }).error ?? message); } catch { /* retain status */ }
      throw new Error(message);
    }
    return JSON.parse(text) as T;
  }

  return {
    isRemoteRuntime: () => isRemoteBrowserSession(environmentProvider()),
    getAccessPolicy,
    pair,
    request,
  };
}
