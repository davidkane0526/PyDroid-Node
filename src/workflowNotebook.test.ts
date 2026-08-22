// @ts-nocheck -- Optional corpus test uses Node filesystem APIs only under Vitest.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { analyzedNotebookToWorkflow, joinNotebookCells, notebookCellsToWorkflow, normalizeNotebookCellsForWorkflow, parseJupyterNotebook, parseWorkflowNotebook, serializeJupyterNotebook, serializeJupyterNotebookCells, serializeWorkflowNotebook, splitWorkflowNotebookCells, summarizeNotebookConversion, workflowNotebookCells, workflowNotebookMetadata } from "./workflowNotebook";
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

  it("serializes nodes with primary plus side outputs without collapsing their ports", () => {
    const accumulate = {
      id: "acc", type: "workflow", position: { x: 0, y: 0 },
      data: { label: "累计", nodeType: "sequence.accumulate", nodeVersion: 1, parameters: { method: "sum" }, status: "idle" },
    } as WorkflowNode;
    const number = {
      id: "number", type: "workflow", position: { x: 200, y: 0 },
      data: { label: "数字", nodeType: "convert.to_number", nodeVersion: 1, parameters: {}, status: "idle" },
    } as WorkflowNode;
    const sideSource = serializeWorkflowNotebook("side", [accumulate, number], [
      { id: "e1", source: "acc", sourceHandle: "last", target: "number", targetHandle: "input" },
    ]);
    expect(sideSource).toContain('node_acc = {"output": _accumulated, "last": _current}');
    expect(sideSource).toContain('node_acc["last"]');

    const primarySource = serializeWorkflowNotebook("primary", [accumulate, number], [
      { id: "e2", source: "acc", sourceHandle: "output", target: "number", targetHandle: "input" },
    ]);
    expect(primarySource).toContain('node_acc["output"]');
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

  it("places AST branch operations inside the generic visual If structure", () => {
    const cells = [{ id: "logic", cellType: "code" as const, source: "if flag:\n    clean = frame.abs()" }];
    const bindings = JSON.stringify({ condition: "flag", input: "frame" });
    const workflow = analyzedNotebookToWorkflow("逻辑", cells, [{ index: 0, recognized: true, semantic: true, nodeType: "logic.if_value", label: "If", inputVariable: "frame", uses: ["flag", "frame"], parameters: { notebookInputBindingsJson: bindings }, operations: [{ index: 0, recognized: true, semantic: true, nodeType: "logic.if_value", label: "If", inputVariable: "frame", uses: ["flag", "frame"], parameters: { notebookInputBindingsJson: bindings }, children: [{ recognized: true, semantic: true, nodeType: "table.absolute", label: "clean", inputVariable: "frame", outputVariable: "clean", branch: "true", childIndex: 0, parameters: {} }] }] }]);
    const structure = workflow.nodes.find((node) => node.data.nodeType === "logic.if_value")!;
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
    expect(source).toContain("node_range_for = pd.DataFrame");
    expect(source).not.toMatch(/^range\s*=/m);
    const localPython = join(process.cwd(), ".tools", "python313-runtime", process.platform === "win32" ? "python.exe" : "bin/python3.13");
    const python = process.env.PYDROID_PYTHON_EXECUTABLE || (existsSync(localPython) ? localPython : "python3.13");
    const output = execFileSync(python, ["-c", source], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    expect(output).toContain("结果数量");
  }, 60_000);



  it("keeps mixed analyzed notebook cells lossless while structuring safe operations", () => {
    const source = "import pandas as pd\ndf = pd.read_csv('a.csv')\nanswer = custom_runtime(df)";
    const cells = [{ id: "mixed", cellType: "code" as const, source, metadata: { tag: "keep" }, outputs: [{ output_type: "stream" }], executionCount: 4 }];
    const workflow = analyzedNotebookToWorkflow("混合", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: true, semantic: false, kind: "Import", nodeType: "notebook.code_cell", label: "导入模块", source: "import pandas as pd", defines: ["pd"], uses: [], parameters: { source: "import pandas as pd" } },
      { index: 1, recognized: true, semantic: true, kind: "call", nodeType: "io.read_csv", label: "df", outputVariable: "df", defines: ["df"], uses: [], parameters: { platformInput: true } },
      { index: 2, recognized: false, semantic: false, kind: "Assign", label: "原样执行", source: "answer = custom_runtime(df)", defines: ["answer"], uses: ["custom_runtime", "df"], parameters: { source: "answer = custom_runtime(df)" } },
    ] }]);
    expect(workflow.nodes.some((node) => node.data.nodeType === "io.read_csv")).toBe(true);
    expect(workflow.nodes.filter((node) => node.data.nodeType === "notebook.code_cell")).toHaveLength(2);
    const restored = workflowNotebookCells(workflow.nodes, workflow.edges);
    expect(restored).toHaveLength(1);
    expect(restored[0].source).toBe(source);
    expect(restored[0].metadata).toEqual({ tag: "keep" });
    expect(restored[0].outputs).toEqual([{ output_type: "stream" }]);
    expect(restored[0].executionCount).toBe(4);
  });

  it("drops blank cells and folds a one-line heading/comment into the following code cell", () => {
    const normalized = normalizeNotebookCellsForWorkflow([
      { id: "blank", cellType: "code" as const, source: "   \n" },
      { id: "heading", cellType: "markdown" as const, source: "# 导入数据并显示" },
      { id: "heading-comment", cellType: "code" as const, source: "# 使用 pandas" },
      { id: "code", cellType: "code" as const, source: "import pandas as pd\nframe = pd.DataFrame()" },
      { id: "comment", cellType: "code" as const, source: "# 清洗" },
      { id: "clean", cellType: "code" as const, source: "frame = frame.dropna()" },
    ]);
    expect(normalized.removedBlankCells).toBe(1);
    expect(normalized.mergedAnnotationCells).toBe(3);
    expect(normalized.cells.map((cell) => cell.source)).toEqual([
      "# 导入数据并显示\n# 使用 pandas\nimport pandas as pd\nframe = pd.DataFrame()",
      "# 清洗\nframe = frame.dropna()",
    ]);
  });

  it("does not render pure Python comment cells as executable nodes but restores them for notebook round-trip", () => {
    const cells = [
      { id: "comment", cellType: "code" as const, source: "# Python\n# experiment setup" },
      { id: "code", cellType: "code" as const, source: "value = 1" },
    ];
    const workflow = analyzedNotebookToWorkflow("注释", cells, [
      { index: 0, recognized: false, semantic: false, operations: [] },
      { index: 1, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "value", source: "value = 1", defines: ["value"], uses: [], parameters: { source: "value = 1" }, operations: [
        { index: 0, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "value", source: "value = 1", defines: ["value"], uses: [], parameters: { source: "value = 1" } },
      ] },
    ]);
    expect(workflow.nodes).toHaveLength(1);
    expect(workflow.nodes[0].data.parameters.source).toBe("value = 1");
    expect(workflow.nodes[0].data.parameters.notebookSkippedCommentCellsJson).toBeTruthy();
    expect(workflowNotebookCells(workflow.nodes, workflow.edges).map((cell) => cell.source)).toEqual(["# Python\n# experiment setup", "value = 1"]);
  });

  it("hoists a leading Python setup prelude into persisted Workflow Context and preserves Notebook round-trip", () => {
    const source = "import pandas as pd\nthreshold = 3\ndef helper(frame):\n    return frame.head(threshold)\nresult = helper(frame)";
    const functionId = "notebook-fn-1-1-helper";
    const cells = [{ id: "context", cellType: "code" as const, source }];
    const workflow = analyzedNotebookToWorkflow("上下文", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: true, semantic: false, kind: "Import", nodeType: "notebook.code_cell", label: "导入模块", source: "import pandas as pd", defines: ["pd"], uses: [], parameters: { source: "import pandas as pd" } },
      { index: 1, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "参数 · threshold", source: "threshold = 3", defines: ["threshold"], uses: [], parameters: { source: "threshold = 3", notebookParameterName: "threshold", notebookParameterExpression: "3", notebookParameterValueJson: "3" } },
      { index: 2, recognized: true, semantic: false, kind: "FunctionDef", nodeType: "notebook.code_cell", label: "定义函数 · helper", source: "def helper(frame):\n    return frame.head(threshold)", defines: ["helper"], uses: [], parameters: {
        source: "def helper(frame):\n    return frame.head(threshold)",
        workflowFunctionId: functionId,
        workflowFunctionCode: "def helper(frame: 'table', *, threshold: 'Any') -> 'table':\n    return frame.head(threshold)",
        workflowFunctionInputsJson: JSON.stringify(["frame", "threshold"]),
        workflowFunctionInputTypesJson: JSON.stringify(["table", "any"]),
        workflowFunctionOutputsJson: JSON.stringify(["output"]),
        workflowFunctionOutputTypesJson: JSON.stringify(["table"]),
        workflowFunctionDependenciesJson: JSON.stringify(["threshold"]),
      } },
      { index: 3, recognized: true, semantic: true, kind: "UserFunctionCall", nodeType: "function.call", label: "helper", inputVariable: "frame", outputVariable: "result", defines: ["result"], uses: ["frame", "threshold"], parameters: {
        functionId, functionVersion: 1,
        notebookInputBindingsJson: JSON.stringify({ frame: "frame", threshold: "threshold" }),
        notebookLiteralInputsJson: JSON.stringify({}),
        notebookExpressionInputsJson: JSON.stringify({}),
        notebookFunctionInputsJson: JSON.stringify(["frame", "threshold"]),
        notebookFunctionOutputsJson: JSON.stringify(["output"]),
      } },
    ] }]);
    expect(workflow.environment.sourceLanguage).toBe("python");
    expect(workflow.environment.pythonImports.map((item) => item.source)).toEqual(["import pandas as pd"]);
    expect(workflow.parameters).toMatchObject([{ name: "threshold", expression: "3", value: 3, valueType: "number" }]);
    expect(workflow.environment.pythonDefinitions.map((item) => item.name)).toEqual(["helper"]);
    expect(workflow.nodes.map((node) => node.data.nodeType)).toEqual(["function.call"]);
    expect(workflowNotebookCells(workflow.nodes, workflow.edges, workflow.requirements, workflow.environment).map((cell) => cell.source)).toEqual([source]);
  });

  it("stores every top-level static import in Workflow Environment even after computation begins", () => {
    const cells = [{ id: "late-import", cellType: "code" as const, source: "value = 1\nimport numpy as np\nresult = np.array([value])" }];
    const workflow = analyzedNotebookToWorkflow("late import", cells, [{ index: 0, recognized: true, semantic: false, operations: [
      { index: 0, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "value", source: "value = 1", defines: ["value"], uses: [], parameters: { source: "value = 1" } },
      { index: 1, recognized: true, semantic: false, kind: "Import", nodeType: "notebook.code_cell", label: "import", source: "import numpy as np", defines: ["np"], uses: [], parameters: { source: "import numpy as np" } },
      { index: 2, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "result", source: "result = np.array([value])", defines: ["result"], uses: ["np", "value"], parameters: { source: "result = np.array([value])" } },
    ] }]);
    expect(workflow.environment.pythonImports.map((item) => item.source)).toEqual(["import numpy as np"]);
    expect(workflow.nodes.map((node) => node.data.parameters.source)).toEqual(["value = 1", "result = np.array([value])"]);
  });

  it("adds visual-only execution order links when adjacent notebook operations have no data dependency", () => {
    const cells = [{ id: "order", cellType: "code" as const, source: "import pandas as pd\nvalue = 1\nprint(value)" }];
    const workflow = analyzedNotebookToWorkflow("顺序", cells, [{ index: 0, recognized: true, semantic: false, operations: [
      { index: 0, recognized: true, semantic: false, kind: "Import", nodeType: "notebook.code_cell", label: "导入模块", source: "import pandas as pd", defines: ["pd"], uses: [], parameters: { source: "import pandas as pd" } },
      { index: 1, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "value", source: "value = 1", defines: ["value"], uses: [], parameters: { source: "value = 1" } },
      { index: 2, recognized: true, semantic: false, kind: "Expr", nodeType: "notebook.code_cell", label: "print", source: "print(value)", defines: [], uses: ["print", "value"], parameters: { source: "print(value)" } },
    ] }]);
    const orderEdges = workflow.edges.filter((edge) => edge.data?.role === "notebook-order");
    expect(orderEdges.length).toBeGreaterThan(0);
    expect(orderEdges.every((edge) => edge.sourceHandle === "__notebook_order_out" && edge.targetHandle === "__notebook_order_in")).toBe(true);
  });

  it("does not expose visual notebook dependencies as public workflow-group data ports", () => {
    const cells = [{ id: "group-visual", cellType: "code" as const, source: "frame = make()\nvalue = use(frame)\nprint(value)" }];
    const workflow = analyzedNotebookToWorkflow("组合端口", cells, [{ index: 0, recognized: true, semantic: false, operations: [
      { index: 0, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "frame", source: "frame = make()", defines: ["frame"], uses: ["make"], parameters: { source: "frame = make()" } },
      { index: 1, recognized: true, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "value", source: "value = use(frame)", defines: ["value"], uses: ["use", "frame"], parameters: { source: "value = use(frame)" } },
      { index: 2, recognized: true, semantic: false, kind: "Expr", nodeType: "notebook.code_cell", label: "打印", source: "print(value)", defines: [], uses: ["print", "value"], parameters: { source: "print(value)" } },
    ] }]);
    const group = workflow.nodes.find((node) => node.data.nodeType === "workflow.group")!;
    expect(group).toBeTruthy();
    expect(group.data.groupInputs).toEqual([]);
    expect(group.data.groupOutputs).toEqual([]);
    expect(workflow.edges.some((edge) => edge.data?.role === "notebook-variable")).toBe(true);
  });

  it("auto-connects notebook data and scalar parameter dependencies without turning parameter lines into data edges", () => {
    const cells = [{ id: "links", cellType: "code" as const, source: "frame = make_frame()\ncount = 2\npicked = Pick(frame, count)\nanswer = use(picked)" }];
    const workflow = analyzedNotebookToWorkflow("连线", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: false, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "frame", source: "frame = make_frame()", defines: ["frame"], uses: ["make_frame"], parameters: { source: "frame = make_frame()" } },
      { index: 1, recognized: false, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "count", source: "count = 2", defines: ["count"], uses: [], parameters: { source: "count = 2" } },
      { index: 2, recognized: true, semantic: true, kind: "NativeLowering", nodeType: "table.periodic_window", label: "picked", inputVariable: "frame", outputVariable: "picked", defines: ["picked"], uses: ["frame", "count"], parameters: { groupSize: 4, count: 1, position: "start", notebookInputBindingsJson: JSON.stringify({ input: "frame" }), notebookParameterBindingsJson: JSON.stringify({ count: "count" }) } },
      { index: 3, recognized: false, semantic: false, kind: "Assign", nodeType: "notebook.code_cell", label: "answer", source: "answer = use(picked)", defines: ["answer"], uses: ["use", "picked"], parameters: { source: "answer = use(picked)" } },
    ] }]);
    expect(workflow.edges.some((edge) => edge.data?.role === "notebook-variable" && edge.data?.variable === "frame")).toBe(true);
    expect(workflow.edges.some((edge) => edge.data?.role === "notebook-parameter" && edge.data?.variable === "count")).toBe(true);
    expect(workflow.edges.some((edge) => edge.data?.role === "notebook-variable" && edge.data?.variable === "picked")).toBe(true);
    const periodic = workflow.nodes.find((node) => node.data.nodeType === "table.periodic_window")!;
    expect(JSON.parse(String(periodic.data.parameters.notebookInputBindingsJson))).toEqual({ input: "frame" });
  });

  it("moves a leading promoted function definition into Workflow Functions instead of keeping a provenance-only canvas node", () => {
    const functionId = "notebook-fn-1-1-pick";
    const cells = [{ id: "native-origin", cellType: "code" as const, source: "def pick(frame):\n    return frame\npicked = pick(frame)" }];
    const workflow = analyzedNotebookToWorkflow("原生下沉", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: true, semantic: false, kind: "FunctionDef", nodeType: "notebook.code_cell", label: "定义函数 · pick", source: "def pick(frame):\n    return frame", defines: ["pick"], uses: [], parameters: {
        source: "def pick(frame):\n    return frame",
        workflowFunctionId: functionId,
        workflowFunctionCode: "def pick(frame: 'Any') -> 'Any':\n    return frame",
        workflowFunctionInputsJson: JSON.stringify(["frame"]),
        workflowFunctionInputTypesJson: JSON.stringify(["table"]),
        workflowFunctionOutputsJson: JSON.stringify(["output"]),
        workflowFunctionOutputTypesJson: JSON.stringify(["table"]),
        workflowFunctionDependenciesJson: JSON.stringify([]),
      } },
      { index: 1, recognized: true, semantic: true, kind: "NativeLowering", nodeType: "table.periodic_window", label: "picked", inputVariable: "frame", outputVariable: "picked", defines: ["picked"], uses: ["frame"], parameters: {
        groupSize: 4, count: 1, position: "start", notebookInputBindingsJson: JSON.stringify({ input: "frame" }),
      } },
    ] }]);
    expect(workflow.environment.sourceLanguage).toBe("python");
    expect(workflow.environment.pythonDefinitions.map((definition) => definition.name)).toEqual(["pick"]);
    expect(workflow.functions.map((definition) => definition.id)).toEqual([functionId]);
    expect(workflow.nodes.some((node) => node.data.nodeType === "notebook.code_cell" && node.data.parameters.astKind === "FunctionDef")).toBe(false);
    expect(workflow.nodes.some((node) => node.data.nodeType === "table.periodic_window")).toBe(true);
    expect(workflow.edges.some((edge) => edge.data?.role === "notebook-provenance" && edge.data?.relation === "function-origin")).toBe(false);
  });

  it("creates a document workflow function and typed call ports for promoted notebook calls", () => {
    const cells = [{ id: "fn", cellType: "code" as const, source: "def scale(frame, factor=2):\n    return frame * factor\nscaled = scale(frame, 3)" }];
    const functionId = "notebook-fn-1-1-scale";
    const workflow = analyzedNotebookToWorkflow("函数", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: true, semantic: false, kind: "FunctionDef", nodeType: "notebook.code_cell", label: "定义函数 · scale", source: "def scale(frame, factor=2):\n    return frame * factor", defines: ["scale"], uses: [], parameters: {
        source: "def scale(frame, factor=2):\n    return frame * factor",
        workflowFunctionId: functionId,
        workflowFunctionCode: "def scale(frame: 'Any', factor: 'Any') -> 'Any':\n    return frame * factor",
        workflowFunctionInputsJson: JSON.stringify(["frame", "factor"]),
        workflowFunctionInputTypesJson: JSON.stringify(["table", "number"]),
        workflowFunctionOutputsJson: JSON.stringify(["output"]),
        workflowFunctionOutputTypesJson: JSON.stringify(["table"]),
        workflowFunctionDependenciesJson: JSON.stringify([]),
      } },
      { index: 1, recognized: true, semantic: true, kind: "UserFunctionCall", nodeType: "function.call", label: "scale", inputVariable: "frame", outputVariable: "scaled", defines: ["scaled"], uses: ["frame"], parameters: {
        functionId, functionVersion: 1,
        notebookInputBindingsJson: JSON.stringify({ frame: "frame" }),
        notebookLiteralInputsJson: JSON.stringify({ factor: 3 }),
        notebookExpressionInputsJson: JSON.stringify({}),
        notebookFunctionInputsJson: JSON.stringify(["frame", "factor"]),
        notebookFunctionOutputsJson: JSON.stringify(["output"]),
      } },
    ] }]);
    expect(workflow.functions).toHaveLength(1);
    expect(workflow.functions?.[0].id).toBe(functionId);
    expect(workflow.functions?.[0].inputs.map((port) => [port.id, port.valueType])).toEqual([["frame", "table"], ["factor", "number"]]);
    expect(workflow.functions?.[0].outputs.map((port) => [port.id, port.valueType])).toEqual([["output", "table"]]);
    const call = workflow.nodes.find((node) => node.data.nodeType === "function.call")!;
    expect(call.data.functionInputs?.map((port) => port.id)).toEqual(["frame", "factor"]);
    expect(call.data.functionOutputs?.map((port) => port.id)).toEqual(["output"]);
    expect(workflow.environment.pythonDefinitions.map((definition) => definition.name)).toEqual(["scale"]);
    expect(workflow.nodes.some((node) => node.data.nodeType === "notebook.code_cell" && node.data.parameters.astKind === "FunctionDef")).toBe(false);
  });

  it("creates a function.map node with function inputs and one collected table output", () => {
    const functionId = "notebook-fn-1-1-measure";
    const cells = [{ id: "fn-map", cellType: "code" as const, source: "def measure(path, sign=1):\n    return path * sign\nframe = pd.DataFrame([measure(path, sign) for path in paths])" }];
    const workflow = analyzedNotebookToWorkflow("函数映射", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: true, semantic: false, kind: "FunctionDef", nodeType: "notebook.code_cell", label: "定义函数 · measure", source: "def measure(path, sign=1):\n    return path * sign", defines: ["measure"], uses: [], parameters: {
        source: "def measure(path, sign=1):\n    return path * sign",
        workflowFunctionId: functionId,
        workflowFunctionCode: "def measure(path: 'Any', sign: 'Any') -> 'Any':\n    return path * sign",
        workflowFunctionInputsJson: JSON.stringify(["path", "sign"]),
        workflowFunctionInputTypesJson: JSON.stringify(["text", "number"]),
        workflowFunctionOutputsJson: JSON.stringify(["output"]),
        workflowFunctionOutputTypesJson: JSON.stringify(["number"]),
        workflowFunctionDependenciesJson: JSON.stringify([]),
      } },
      { index: 1, recognized: true, semantic: true, kind: "UserFunctionMap", nodeType: "function.map", label: "measure · 映射", inputVariable: "paths", outputVariable: "frame", defines: ["frame"], uses: ["paths", "sign"], parameters: {
        functionId, functionVersion: 1, mapInput: "path", collectMode: "table", maxIterations: 100000,
        notebookInputBindingsJson: JSON.stringify({ path: "paths", sign: "sign" }),
        notebookLiteralInputsJson: JSON.stringify({}),
        notebookExpressionInputsJson: JSON.stringify({}),
        notebookFunctionInputsJson: JSON.stringify(["path", "sign"]),
        notebookFunctionOutputsJson: JSON.stringify(["output"]),
      } },
    ] }]);
    const map = workflow.nodes.find((node) => node.data.nodeType === "function.map")!;
    expect(map).toBeTruthy();
    expect(map.data.functionInputs?.map((port) => [port.id, port.valueType])).toEqual([["path", "list"], ["sign", "number"]]);
    expect(map.data.functionOutputs).toEqual([{ id: "output", label: "结果表", valueType: "table" }]);
    expect(map.data.parameters.mapInput).toBe("path");
    expect(map.data.parameters.collectMode).toBe("table");
  });


  it("builds a native Python/JavaScript workflow function when the analyzer proves the body portable", () => {
    const functionId = "notebook-fn-1-1-clean";
    const cells = [{ id: "portable-function", cellType: "code" as const, source: "def clean(frame):\n    cleaned = frame.dropna()\n    return cleaned.reset_index(drop=True)\nresult = clean(frame)" }];
    const portableBody = {
      version: 1,
      inputNames: ["frame"],
      operations: [
        { recognized: true, semantic: true, kind: "call", nodeType: "pandas.dropna", label: "cleaned", parameters: {}, inputVariable: "frame", outputVariable: "cleaned", defines: ["cleaned"], uses: ["frame"] },
        { recognized: true, semantic: true, kind: "call", nodeType: "table.reset_index", label: "result", parameters: { drop: true }, inputVariable: "cleaned", outputVariable: "__pydroid_return_1", defines: ["__pydroid_return_1"], uses: ["cleaned"] },
      ],
      returns: [{ port: "output", variable: "__pydroid_return_1" }],
    };
    const workflow = analyzedNotebookToWorkflow("portable", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: true, semantic: false, kind: "FunctionDef", nodeType: "notebook.code_cell", label: "定义函数 · clean", source: "def clean(frame):\n    cleaned = frame.dropna()\n    return cleaned.reset_index(drop=True)", defines: ["clean"], uses: [], parameters: {
        source: "def clean(frame):\n    cleaned = frame.dropna()\n    return cleaned.reset_index(drop=True)",
        workflowFunctionId: functionId,
        workflowFunctionCode: "def clean(frame: 'table') -> 'table':\n    cleaned = frame.dropna()\n    return cleaned.reset_index(drop=True)",
        workflowFunctionInputsJson: JSON.stringify(["frame"]),
        workflowFunctionInputTypesJson: JSON.stringify(["table"]),
        workflowFunctionOutputsJson: JSON.stringify(["output"]),
        workflowFunctionOutputTypesJson: JSON.stringify(["table"]),
        workflowFunctionDependenciesJson: JSON.stringify([]),
        workflowFunctionPortableBodyJson: JSON.stringify(portableBody),
      } },
      { index: 1, recognized: true, semantic: true, kind: "UserFunctionCall", nodeType: "function.call", label: "clean", inputVariable: "frame", outputVariable: "result", defines: ["result"], uses: ["frame"], parameters: {
        functionId, functionVersion: 1,
        notebookInputBindingsJson: JSON.stringify({ frame: "frame" }),
        notebookLiteralInputsJson: JSON.stringify({}), notebookExpressionInputsJson: JSON.stringify({}),
        notebookFunctionInputsJson: JSON.stringify(["frame"]), notebookFunctionOutputsJson: JSON.stringify(["output"]),
      } },
    ] }]);
    const definition = workflow.functions[0];
    expect(definition.nodes.map((node) => node.data.nodeType)).toEqual(["pandas.dropna", "table.reset_index"]);
    expect(definition.nodes.some((node) => node.data.nodeType === "custom.python_function")).toBe(false);
    expect(definition.inputs).toMatchObject([{ id: "frame", internalNodeId: `${functionId}-native-1`, internalHandle: "input" }]);
    expect(definition.outputs).toMatchObject([{ id: "output", internalNodeId: `${functionId}-native-2`, internalHandle: "output" }]);
    expect(definition.edges).toMatchObject([{ source: `${functionId}-native-1`, sourceHandle: "output", target: `${functionId}-native-2`, targetHandle: "input" }]);
  });

  it("falls back to the Python kernel when portable metadata references a non-JavaScript node", () => {
    const functionId = "notebook-fn-1-1-python-only";
    const cells = [{ id: "fallback-portable", cellType: "code" as const, source: "def helper(frame):\n    return frame" }];
    const workflow = analyzedNotebookToWorkflow("fallback", cells, [{ index: 0, recognized: true, semantic: false, operations: [
      { index: 0, recognized: true, semantic: false, kind: "FunctionDef", nodeType: "notebook.code_cell", label: "定义函数 · helper", source: cells[0].source, defines: ["helper"], uses: [], parameters: {
        source: cells[0].source,
        workflowFunctionId: functionId,
        workflowFunctionCode: "def helper(frame: 'Any') -> 'Any':\n    return frame",
        workflowFunctionInputsJson: JSON.stringify(["frame"]), workflowFunctionInputTypesJson: JSON.stringify(["any"]),
        workflowFunctionOutputsJson: JSON.stringify(["output"]), workflowFunctionOutputTypesJson: JSON.stringify(["any"]),
        workflowFunctionDependenciesJson: JSON.stringify([]),
        workflowFunctionPortableBodyJson: JSON.stringify({ version: 1, inputNames: ["frame"], operations: [
          { recognized: true, semantic: true, nodeType: "custom.python_function", label: "bad", parameters: { code: "def bad(input: 'Any') -> 'Any':\n    return input" }, inputVariable: "frame", outputVariable: "value", defines: ["value"], uses: ["frame"] },
        ], returns: [{ port: "output", variable: "value" }] }),
      } },
    ] }]);
    expect(workflow.functions[0].nodes.map((node) => node.data.nodeType)).toEqual(["custom.python_function"]);
  });


  it("summarizes structural coverage and platform compatibility without treating stdlib or bundled Android packages as unsupported", () => {
    const cells = [
      { id: "a", cellType: "code" as const, source: "import os\nimport pandas as pd\nimport numpy as np\nimport matplotlib.pyplot as plt\nfrom scipy.stats import linregress\nfrom PIL import Image\npath = r'\\\\S1\\data\\a.csv'" },
      { id: "b", cellType: "markdown" as const, source: "# note" },
    ];
    const report = summarizeNotebookConversion(cells, [{ index: 0, recognized: true, operations: [
      { index: 0, recognized: true, semantic: false, kind: "FunctionDef", nodeType: "notebook.code_cell", label: "def", parameters: { workflowFunctionId: "fn", workflowFunctionOutputTypesJson: JSON.stringify(["table"]) } },
      { index: 1, recognized: true, semantic: true, kind: "call", nodeType: "function.call", label: "f", parameters: {} },
      { index: 2, recognized: true, semantic: true, kind: "UserFunctionMap", nodeType: "function.map", label: "map", parameters: { collectMode: "table" } },
      { index: 3, recognized: true, semantic: false, kind: "Code", nodeType: "notebook.code_cell", label: "code", parameters: {} },
    ] }]);
    expect(report.totalCells).toBe(2);
    expect(report.operations).toBe(4);
    expect(report.semanticOperations).toBe(2);
    expect(report.carrierOperations).toBe(2);
    expect(report.structuredPercent).toBe(50);
    expect(report.promotedFunctionDefinitions).toBe(1);
    expect(report.typedFunctionDefinitions).toBe(1);
    expect(report.functionCalls).toBe(1);
    expect(report.functionMaps).toBe(1);
    expect(report.functionConcatMaps).toBe(1);
    expect(report.managedWorkflowDefinitions).toBe(1);
    expect(report.managedContextOperations).toBe(1);
    expect(report.canvasOperations).toBe(3);
    expect(report.dependencyLinks).toBeGreaterThanOrEqual(0);
    expect(report.linkedOperations + report.isolatedOperations).toBe(report.operations);
    expect(report.importedModules).toEqual(["PIL", "matplotlib", "numpy", "os", "pandas", "scipy"]);
    expect(report.androidUnsupportedModules).toEqual(["PIL", "scipy"]);
    expect(report.windowsPathCells).toBe(1);
  });

  it("keeps control-flow child node ids distinct from following top-level statements", () => {
    const cells = [{ id: "logic", cellType: "code" as const, source: "if flag:\n    clean = frame.abs()\nresult = clean.head()" }];
    const workflow = analyzedNotebookToWorkflow("编号", cells, [{ index: 0, recognized: true, semantic: true, operations: [
      { index: 0, recognized: true, semantic: true, nodeType: "logic.if_value", label: "If", inputVariable: "frame", uses: ["frame", "flag"], parameters: { notebookInputBindingsJson: JSON.stringify({ condition: "flag", input: "frame" }) }, children: [
        { index: 0, recognized: true, semantic: true, nodeType: "table.absolute", label: "clean", inputVariable: "frame", outputVariable: "clean", defines: ["clean"], uses: ["frame"], branch: "true", childIndex: 0, parameters: {} },
      ] },
      { index: 1, recognized: true, semantic: true, nodeType: "pandas.head", label: "result", inputVariable: "clean", outputVariable: "result", defines: ["result"], uses: ["clean"], parameters: {} },
    ] }]);
    const ids = workflow.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("notebook-cell-1-step-2");
    expect(ids).toContain("notebook-cell-1-step-1001");
  });

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
