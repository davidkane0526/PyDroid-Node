import { describe, expect, it } from "vitest";
import { clearWorkspaceVariableState, getWorkspaceVariableState, listWorkspaceVariableNames, setWorkspaceVariableState } from "./execution-workspace";

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
});
