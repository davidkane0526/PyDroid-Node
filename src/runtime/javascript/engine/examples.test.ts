// @ts-nocheck -- 示例语料测试使用 Node 文件系统 API，仅在 Vitest 下运行。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeWorkflowJson } from "./index";

const examples = join(process.cwd(), "examples");

describe("示例工作流在 JS 引擎下执行", () => {
  it("logic-control-demo", () => {
    const workflow = readFileSync(join(examples, "logic-control-demo.workflow.json"), "utf8");
    const result = JSON.parse(executeWorkflowJson(workflow, ""));
    expect(result.status).toBe("success");
    expect(result.preview.totalRows).toBe(7);
  });

  it("periodic-oscillating-pulse", () => {
    const workflow = readFileSync(join(examples, "periodic-oscillating-pulse.workflow.json"), "utf8");
    const result = JSON.parse(executeWorkflowJson(workflow, ""));
    expect(result.status).toBe("success");
    expect(result.preview.columns).toEqual(["time_s", "port1_V", "port2_V", "port3_V"]);
  });

  it("ter-matrix", () => {
    const workflow = readFileSync(join(examples, "ter-matrix.workflow.json"), "utf8");
    const files = [
      { name: "vg=0v.csv", text: "Instrument export\nVds,Current\n-1,-1e-6\n0,1e-12\n1,1e-6\n1,2e-6\n0,1e-12\n-1,-2e-6\n" },
      { name: "vg=1v.csv", text: "Instrument export\nVds,Current\n-1,-1e-6\n0,1e-12\n1,1e-6\n1,4e-6\n0,1e-12\n-1,-4e-6\n" },
    ];
    const result = JSON.parse(executeWorkflowJson(workflow, "", JSON.stringify(files)));
    expect(result.status).toBe("success");
  });

  for (const file of [
    "demo-01-scientific-pipeline.workflow.json",
    "demo-02-native-function.workflow.json",
    "demo-03-composite-group.workflow.json",
    "demo-04-control-flow.workflow.json",
  ]) {
    it(file, () => {
      const workflow = readFileSync(join(examples, file), "utf8");
      const result = JSON.parse(executeWorkflowJson(workflow, ""));
      expect(result.status).toBe("success");
      expect(result.executionOrder.length).toBeGreaterThan(0);
    });
  }
});
