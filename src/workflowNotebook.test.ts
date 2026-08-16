// @ts-nocheck -- Optional corpus test uses Node filesystem APIs only under Vitest.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { analyzedNotebookToWorkflow, joinNotebookCells, notebookCellsToWorkflow, parseJupyterNotebook, parseWorkflowNotebook, serializeJupyterNotebook, serializeJupyterNotebookCells, serializeWorkflowNotebook, splitWorkflowNotebookCells, workflowNotebookCells, workflowNotebookMetadata } from "./workflowNotebook";
import type { WorkflowNode } from "./workflow";

const sampleNode: WorkflowNode = {
  id: "read",
  type: "workflow",
  position: { x: 10, y: 20 },
  data: { label: "读取", nodeType: "io.read_csv", nodeVersion: 1, parameters: { skipRows: 1 }, status: "idle" },
};

describe("workflow notebook DSL", () => {
  it("keeps an empty workflow notebook completely empty", () => {
    expect(workflowNotebookCells([], [])).toEqual([]);
  });

  it("round-trips nodes, edges and package requirements", () => {
    const source = serializeWorkflowNotebook("测试", [sampleNode], [], ["scipy==1.12.0"]);
    expect(source).toContain("import pandas as pd");
    expect(source).toContain("pd.read_csv");
    expect(source).not.toContain('"schemaVersion"');
    const parsed = parseWorkflowNotebook(source);
    expect(parsed.nodes[0].data.parameters.skipRows).toBe(1);
    expect(parsed.requirements).toEqual(["scipy==1.12.0"]);
  });

  it("applies editable notebook JSON back to the workflow", () => {
    const source = serializeWorkflowNotebook("测试", [sampleNode], [], []).replace('"skipRows": 1', '"skipRows": 3');
    expect(parseWorkflowNotebook(source).nodes[0].data.parameters.skipRows).toBe(3);
  });

  it("reports malformed cells", () => {
    expect(() => parseWorkflowNotebook("# %% [node] bad\n{" )).toThrow("node-type");
  });

  it("exports a standard Jupyter notebook with Python code cells", () => {
    const python = serializeWorkflowNotebook("测试", [sampleNode], [], []);
    const notebook = JSON.parse(serializeJupyterNotebook("测试", python));
    expect(notebook.nbformat).toBe(4);
    expect(notebook.cells.some((cell: { cell_type: string; source: string[] }) => cell.cell_type === "code" && cell.source.join("").includes("pd.read_csv"))).toBe(true);
  });

  it("keeps Jupyter cells, outputs and metadata during import and export", () => {
    const original = JSON.stringify({
      cells: [{ cell_type: "code", execution_count: 7, metadata: { tag: "keep" }, outputs: [{ output_type: "stream", name: "stdout", text: ["ok\n"] }], source: ["print('ok')\n"] }],
      metadata: { custom: { keep: true } }, nbformat: 4, nbformat_minor: 5,
    });
    const parsed = parseJupyterNotebook(original);
    const exported = JSON.parse(serializeJupyterNotebookCells(parsed.name, parsed.cells, parsed.metadata));
    expect(exported.cells[0].execution_count).toBe(7);
    expect(exported.cells[0].outputs[0].text).toEqual(["ok\n"]);
    expect(exported.cells[0].metadata.tag).toBe("keep");
    expect(exported.metadata.custom.keep).toBe(true);
  });

  it("splits generated Python into independently editable cells", () => {
    const source = serializeWorkflowNotebook("测试", [sampleNode], [], []);
    const cells = splitWorkflowNotebookCells(source);
    expect(cells.length).toBeGreaterThanOrEqual(3);
    expect(cells.some((cell) => cell.source.includes("# %% [node] read"))).toBe(true);
    expect(joinNotebookCells(cells)).toContain("pd.read_csv");
  });

  it("round-trips arbitrary Jupyter cells through lossless carrier nodes", () => {
    const cells = parseJupyterNotebook(JSON.stringify({ cells: [
      { cell_type: "markdown", metadata: { a: 1 }, source: ["# Title\n"] },
      { cell_type: "code", execution_count: 2, metadata: {}, outputs: [{ output_type: "execute_result" }], source: ["x = 1\n"] },
    ], metadata: {}, nbformat: 4, nbformat_minor: 5 })).cells;
    const workflow = notebookCellsToWorkflow("任意文件", cells, { custom: { keep: true } });
    const restored = workflowNotebookCells(workflow.nodes, workflow.edges);
    expect(restored.map((cell) => [cell.cellType, cell.source])).toEqual(cells.map((cell) => [cell.cellType, cell.source]));
    expect(restored[1].outputs).toEqual(cells[1].outputs);
    expect(workflowNotebookMetadata(workflow.nodes)).toEqual({ custom: { keep: true } });
  });

  it("creates typed nodes and variable dependency edges from analyses", () => {
    const cells = [{ id: "a", cellType: "code" as const, source: "df = pd.read_csv('a.csv')" }, { id: "b", cellType: "code" as const, source: "clean = df.dropna()" }];
    const workflow = analyzedNotebookToWorkflow("分析", cells, [
      { index: 0, recognized: true, nodeType: "io.read_csv", label: "df", outputVariable: "df", parameters: {} },
      { index: 1, recognized: true, nodeType: "pandas.dropna", label: "clean", inputVariable: "df", outputVariable: "clean", parameters: {} },
    ], { keep: true });
    expect(workflow.nodes.map((node) => node.data.nodeType)).toEqual(["io.read_csv", "pandas.dropna"]);
    expect(workflow.edges).toHaveLength(1);
    const generated = workflowNotebookCells(workflow.nodes, workflow.edges).map((cell) => cell.source).join("\n");
    expect(generated).toContain("pd.read_csv");
    expect(generated).toContain("dropna");
    expect(workflow.nodes.some((node) => node.data.nodeType.startsWith("notebook."))).toBe(false);
  });

  it("groups a compound notebook cell and keeps its external boundary ports", () => {
    const cells = [{ id: "a", cellType: "code" as const, source: "df = pd.read_csv('a.csv')\na = df.dropna()\nb = a.head()" }, { id: "b", cellType: "code" as const, source: "result = b.tail()" }];
    const workflow = analyzedNotebookToWorkflow("分组", cells, [
      { index: 0, recognized: true, operations: [
        { index: 0, recognized: true, nodeType: "io.read_csv", label: "df", outputVariable: "df", defines: ["df"], parameters: {} },
        { index: 1, recognized: true, nodeType: "pandas.dropna", label: "a", inputVariable: "df", outputVariable: "a", defines: ["a"], uses: ["df"], parameters: {} },
        { index: 2, recognized: true, nodeType: "pandas.head", label: "b", inputVariable: "a", outputVariable: "b", defines: ["b"], uses: ["a"], parameters: {} },
      ] },
      { index: 1, recognized: true, nodeType: "pandas.tail", label: "result", inputVariable: "b", outputVariable: "result", parameters: {} },
    ]);
    const group = workflow.nodes.find((node) => node.data.nodeType === "workflow.group")!;
    expect(group).toBeTruthy();
    expect(workflow.nodes.filter((node) => node.data.canvasParentId === group.id)).toHaveLength(3);
    expect(group.data.groupOutputs).toHaveLength(1);
    expect(workflow.edges.some((edge) => edge.source === group.id)).toBe(true);
  });

  it("maps custom Python notebook dependencies to signature ports and preserves multi-input export", () => {
    const code = "def combine(left: 'table', right: 'table', /, *, scale: float = 2) -> tuple['scaled:table', 'raw:table']:\n    return left * scale + right, left";
    const cells = [{ id: "logic", cellType: "code" as const, source: "custom" }];
    const workflow = analyzedNotebookToWorkflow("自定义", cells, [{
      index: 0, recognized: true, semantic: true, nodeType: "custom.python_function", label: "combine",
      inputVariable: "leftFrame", outputVariable: "scaled", defines: ["scaled", "raw"], uses: ["leftFrame", "rightFrame"], parameters: { code, scale: 3 },
      operations: [
        { index: 0, recognized: true, semantic: true, nodeType: "io.read_csv", label: "left", outputVariable: "leftFrame", defines: ["leftFrame"], uses: [], parameters: {} },
        { index: 1, recognized: true, semantic: true, nodeType: "io.read_csv", label: "right", outputVariable: "rightFrame", defines: ["rightFrame"], uses: [], parameters: {} },
        { index: 2, recognized: true, semantic: true, nodeType: "custom.python_function", label: "combine", inputVariable: "leftFrame", outputVariable: "scaled", defines: ["scaled", "raw"], uses: ["leftFrame", "rightFrame"], parameters: { code, scale: 3 } },
      ],
    }]);
    const custom = workflow.nodes.find((node) => node.data.nodeType === "custom.python_function")!;
    const incoming = workflow.edges.filter((edge) => edge.target === custom.id).map((edge) => edge.targetHandle).sort();
    expect(incoming).toEqual(["left", "right"]);
    const source = serializeWorkflowNotebook("自定义", workflow.nodes, workflow.edges);
    expect(source).toContain("_call_custom(combine");
    expect(source).toContain('"left"');
    expect(source).toContain('"right"');
    expect(source).toContain('"scaled"');
    expect(source).toContain('"raw"');
  });

  it("places AST branch operations inside a visual If structure", () => {
    const cells = [{ id: "logic", cellType: "code" as const, source: "if value >= 0:\n    clean = frame.abs()" }];
    const workflow = analyzedNotebookToWorkflow("逻辑", cells, [{ index: 0, recognized: true, semantic: true, nodeType: "logic.if_subflow", label: "If", inputVariable: "frame", parameters: { condition: "value >= 0" }, operations: [{ index: 0, recognized: true, semantic: true, nodeType: "logic.if_subflow", label: "If", inputVariable: "frame", parameters: { condition: "value >= 0" }, children: [{ recognized: true, semantic: true, nodeType: "table.absolute", label: "clean", inputVariable: "frame", outputVariable: "clean", branch: "true", childIndex: 0, parameters: {} }] }] }]);
    const structure = workflow.nodes.find((node) => node.data.nodeType === "logic.if_subflow")!;
    const child = workflow.nodes.find((node) => node.data.nodeType === "table.absolute")!;
    expect(structure.style).toMatchObject({ width: 520, height: 300 });
    expect(child.parentId).toBe(structure.id);
    expect(child.data.branch).toBe("true");
  });

  it("round-trips the executable logic-control demo without code carrier nodes", () => {
    const original = JSON.parse(readFileSync(join(process.cwd(), "examples", "logic-control-demo.workflow.json"), "utf8"));
    const source = serializeWorkflowNotebook(original.name, original.nodes, original.edges, original.requirements ?? []);
    const restored = parseWorkflowNotebook(source, original.name);
    expect(restored.nodes.map((node) => node.data.nodeType).sort()).toEqual(original.nodes.map((node) => node.data.nodeType).sort());
    expect(restored.edges).toHaveLength(original.edges.length);
    expect(restored.nodes.some((node) => node.data.nodeType.startsWith("notebook.") || node.data.nodeType === "custom.python_function")).toBe(false);
    expect(restored.nodes.filter((node) => node.parentId === "if")).toHaveLength(2);
    expect(source).not.toContain("Notebook exporter does not support logic.");
    expect(source).toContain("node_range = pd.DataFrame");
    expect(source).not.toMatch(/^range\s*=/m);
    const localPython = join(process.cwd(), ".tools", "python312-runtime", process.platform === "win32" ? "python.exe" : "bin/python3.12");
    const python = process.env.PYDROID_PYTHON_EXECUTABLE || (existsSync(localPython) ? localPython : "python3.12");
    const output = execFileSync(python, ["-c", source], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    expect(output).toContain("逻辑控制结果");
  }, 60_000);

  it.skipIf(!process.env.PYDROID_NOTEBOOK_CORPUS)("losslessly round-trips every notebook in the configured corpus", () => {
    const root = process.env.PYDROID_NOTEBOOK_CORPUS!;
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ipynb")) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    const normalizeCell = (cell: Record<string, unknown>) => ({ ...cell, source: Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? "") });
    for (const file of files) {
      const original = JSON.parse(readFileSync(file, "utf8"));
      const parsed = parseJupyterNotebook(JSON.stringify(original));
      const exported = JSON.parse(serializeJupyterNotebookCells(parsed.name, parsed.cells, parsed.metadata));
      expect(exported.metadata, file).toEqual(original.metadata ?? {});
      expect(exported.cells.map(normalizeCell), file).toEqual(original.cells.map(normalizeCell));
    }
  });
});
