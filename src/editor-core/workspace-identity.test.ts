import { describe, expect, it } from "vitest";
import { createWorkspaceSessionIdentity, matchesHostExecution } from "./workspace-identity";

describe("workspace session identity", () => {
  it("keeps local and remote clients with the same tab id in separate identity namespaces", () => {
    const local = createWorkspaceSessionIdentity("default", "desktop-client", "local");
    const remote = createWorkspaceSessionIdentity("default", "remote-client", "remote");
    expect(local.key).not.toBe(remote.key);
    expect(matchesHostExecution(remote, { workspaceId: "default", clientId: "remote-client", source: "remote" })).toBe(true);
    expect(matchesHostExecution(remote, { workspaceId: "default", clientId: "desktop-client", source: "local" })).toBe(false);
  });
});
