import { describe, expect, it } from "vitest";
import { createRemoteSessionClient, isRemoteBrowserSession, type RemoteSessionEnvironment } from "./remote-session";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

function environment(fetchImpl: RemoteSessionEnvironment["fetch"]): RemoteSessionEnvironment {
  return {
    location: { search: "", protocol: "http:", hostname: "192.168.1.20" },
    storage: memoryStorage(),
    fetch: fetchImpl,
  };
}

describe("remote session transport", () => {
  it("detects only HTTP(S) remote browser sessions", () => {
    const fetchImpl = async () => new Response("{}");
    expect(isRemoteBrowserSession(environment(fetchImpl))).toBe(true);
    expect(isRemoteBrowserSession({ ...environment(fetchImpl), location: { search: "", protocol: "http:", hostname: "localhost" } })).toBe(false);
    expect(isRemoteBrowserSession({ ...environment(fetchImpl), location: { search: "", protocol: "file:", hostname: "192.168.1.20" } })).toBe(false);
  });

  it("stores the paired token and attaches it to later requests", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const env = environment(async (input, init) => {
      const path = String(input);
      calls.push({ input: path, init });
      if (path === "/api/pair") return new Response(JSON.stringify({ token: "session-token" }), { status: 200 });
      return new Response(JSON.stringify({ memoryBytes: 1234 }), { status: 200 });
    });
    const client = createRemoteSessionClient(
      { missingToken: "missing", healthFailed: "health", pairFailed: "pair" },
      () => env,
    );

    await client.pair("1234");
    const result = await client.request<{ memoryBytes: number }>("/api/runtime-stats");

    expect(result.memoryBytes).toBe(1234);
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ pin: "1234" }));
    expect(new Headers(calls[1]?.init?.headers).get("X-PyDroid-Token")).toBe("session-token");
  });

  it("clears an expired session token after a 401 response", async () => {
    const env = environment(async (input) => {
      if (String(input) === "/api/pair") return new Response(JSON.stringify({ token: "expired-token" }), { status: 200 });
      return new Response(JSON.stringify({ error: "配对会话无效或已过期，请重新配对" }), { status: 401 });
    });
    const client = createRemoteSessionClient(
      { missingToken: "pair first", healthFailed: "health", pairFailed: "pair" },
      () => env,
    );
    await client.pair("1234");
    await expect(client.request("/api/runtime-stats")).rejects.toThrow("配对会话无效或已过期");
    await expect(client.request("/api/runtime-stats")).rejects.toThrow("pair first");
  });

  it("rejects authenticated requests before pairing", async () => {
    const env = environment(async () => new Response("{}", { status: 200 }));
    const client = createRemoteSessionClient(
      { missingToken: "pair first", healthFailed: "health", pairFailed: "pair" },
      () => env,
    );
    await expect(client.request("/api/runtime-stats")).rejects.toThrow("pair first");
  });
});
