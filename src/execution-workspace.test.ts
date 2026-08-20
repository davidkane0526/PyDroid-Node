import { describe, expect, it } from "vitest";
import { clearWorkspaceVariableState, getWorkspaceVariableState, listWorkspaceVariableNames, setWorkspaceVariableState } from "./execution-workspace";
import { createWorkspaceSessionIdentity } from "./workspace-session-identity";

describe("workspace variable isolation", () => {
  it("isolates state by workspace id and returns defensive clones", () => {
    clearWorkspaceVariableState("phase8-a");
    clearWorkspaceVariableState("phase8-b");
    setWorkspaceVariableState("phase8-a", { rows: 3, nested: { value: 1 } });
    expect(getWorkspaceVariableState("phase8-b")).toEqual({});
    const copy = getWorkspaceVariableState("phase8-a") as { rows: number; nested: { value: number } };
    copy.nested.value = 99;
    expect(getWorkspaceVariableState("phase8-a")).toEqual({ rows: 3, nested: { value: 1 } });
    expect(listWorkspaceVariableNames("phase8-a")).toEqual(["nested", "rows"]);
    clearWorkspaceVariableState("phase8-a");
  });

  it("isolates same workspace id by client and local/remote session identity", () => {
    const local = createWorkspaceSessionIdentity("default", "desktop-a", "local");
    const remoteA = createWorkspaceSessionIdentity("default", "browser-a", "remote");
    const remoteB = createWorkspaceSessionIdentity("default", "browser-b", "remote");
    setWorkspaceVariableState(local, { owner: "local" });
    setWorkspaceVariableState(remoteA, { owner: "remote-a" });
    setWorkspaceVariableState(remoteB, { owner: "remote-b" });
    expect(getWorkspaceVariableState(local)).toEqual({ owner: "local" });
    expect(getWorkspaceVariableState(remoteA)).toEqual({ owner: "remote-a" });
    expect(getWorkspaceVariableState(remoteB)).toEqual({ owner: "remote-b" });
    clearWorkspaceVariableState(local);
    clearWorkspaceVariableState(remoteA);
    clearWorkspaceVariableState(remoteB);
  });
});
