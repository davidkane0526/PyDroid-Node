import { describe, expect, it } from "vitest";
import { canSafelyPreExecuteNodes, canWorkflowRunInRuntime, getNodeContract, supportsNodeRuntime, validateNodeContracts } from "./nodeContract";

describe("node contracts", () => {
  it("marks portable nodes as python+javascript", () => {
    const contract = getNodeContract("generate.random_table");
    expect(contract?.runtimes.python).toBe(true);
    expect(contract?.runtimes.javascript).toBe(true);
    expect(contract?.cachePolicy).toBe("uncacheable");
  });

  it("marks custom python function as python-only custom code", () => {
    const contract = getNodeContract("custom.python_function");
    expect(contract?.executionModel).toBe("custom-code");
    expect(contract?.runtimes.python).toBe(true);
    expect(contract?.runtimes.javascript).toBe(false);
  });

  it("marks function.map as a Python-only workflow function caller", () => {
    const contract = getNodeContract("function.map");
    expect(contract?.executionModel).toBe("function");
    expect(contract?.functionRole).toBe("call");
    expect(contract?.runtimes.python).toBe(true);
    expect(contract?.runtimes.javascript).toBe(false);
  });

  it("marks temporary variable nodes with temporary state scope", () => {
    expect(getNodeContract("variable.set")?.stateScope).toBe("temporary");
    expect(getNodeContract("variable.get")?.stateScope).toBe("temporary");
  });

  it("keeps the whole catalog internally consistent", () => {
    expect(validateNodeContracts()).toEqual([]);
  });

  it("drives runtime auto capability checks from the shared contract", () => {
    const portable = [{ id: "n1", position: { x: 0, y: 0 }, data: { label: "随机数表", nodeType: "generate.random_table", nodeVersion: 1, parameters: {}, status: "idle" } }];
    const pythonOnly = [{ id: "n1", position: { x: 0, y: 0 }, data: { label: "自定义函数", nodeType: "custom.python_function", nodeVersion: 1, parameters: {}, status: "idle" } }];
    expect(canWorkflowRunInRuntime(portable, "javascript").supported).toBe(true);
    expect(canWorkflowRunInRuntime(pythonOnly, "javascript").supported).toBe(false);
  });

  it("flags side-effectful preview slices as unsafe to pre-execute", () => {
    const safeNodes = [{ id: "n1", position: { x: 0, y: 0 }, data: { label: "随机数表", nodeType: "generate.random_table", nodeVersion: 1, parameters: {}, status: "idle" } }];
    const unsafeNodes = [{ id: "n2", position: { x: 0, y: 0 }, data: { label: "变量写入", nodeType: "variable.set", nodeVersion: 1, parameters: {}, status: "idle" } }];
    expect(canSafelyPreExecuteNodes(safeNodes).safe).toBe(true);
    expect(canSafelyPreExecuteNodes(unsafeNodes).safe).toBe(false);
  });

  it("exposes workflow.group even though it is not a catalog node", () => {
    expect(getNodeContract("workflow.group")?.executionModel).toBe("workflow");
    expect(supportsNodeRuntime("workflow.group", "javascript")).toBe(true);
  });
});
