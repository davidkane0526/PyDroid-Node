import { describe, expect, it } from "vitest";
import { Table, parseCsv, executeWorkflowJson, executeJsCell, executeCustomFunction, createNotebookNamespace, linePlot, heatmapPlot } from "./index";

function node(id: string, nodeType: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, position: { x: 0, y: 0 }, data: { nodeType, parameters, ...extra }, ...extra };
}

function edge(source: string, target: string, handles: { sourceHandle?: string; targetHandle?: string } = {}): Record<string, unknown> {
  return { source, target, sourceHandle: handles.sourceHandle ?? null, targetHandle: handles.targetHandle ?? null };
}

function run(workflow: { nodes: unknown[]; edges: unknown[] }, csvText = "", inputFiles: unknown[] = []): Record<string, unknown> {
  return JSON.parse(executeWorkflowJson(JSON.stringify(workflow), csvText, JSON.stringify(inputFiles))) as Record<string, unknown>;
}

const SAMPLE_CSV = "voltage,current\n0,0.1\n1,0.2\n2,0.3\n3,0.4\n4,0.5\n5,0.6\n";

describe("Table 核心", () => {
  it("解析 CSV 并推断数值类型", () => {
    const table = parseCsv(SAMPLE_CSV, { header: 0 });
    expect(table.columns).toEqual(["voltage", "current"]);
    expect(table.rowCount).toBe(6);
    expect(table.rows()[0]).toEqual([0, 0.1]);
  });

  it("query 支持比较、逻辑与反引号列名", () => {
    const table = parseCsv(SAMPLE_CSV, { header: 0 });
    expect(table.query("voltage > 2").rowCount).toBe(3);
    expect(table.query("voltage >= 2 and current <= 0.4").rowCount).toBe(2);
    const named = new Table(["my col"], [[1], [2], [3]]);
    expect(named.query("`my col` >= 2").rowCount).toBe(2);
  });

  it("sort/dropna/pivot/groupAggregate 对齐 pandas 语义", () => {
    const table = parseCsv("g,v\nb,2\na,3\na,1\nb,4\n", { header: 0 });
    expect(table.sortValues(["g"], true, "last").column("v")).toEqual([3, 1, 2, 4]);
    const withNa = new Table(["a", "b"], [[1, null], [null, 2], [3, 4]]);
    expect(withNa.dropna("any").rowCount).toBe(1);
    const pivot = new Table(["row", "col", "val"], [["r1", "x", 1], ["r1", "y", 2], ["r2", "x", 3]]);
    const pivoted = pivot.pivot("row", "col", "val", "mean");
    expect(pivoted.columns).toEqual(["row", "x", "y"]);
    const grouped = new Table(["v"], [[1], [2], [3], [4]]);
    expect(grouped.groupAggregate(2, 0, 2, "mean").column("v")).toEqual([1.5, 3.5]);
  });
});

describe("工作流执行", () => {
  it("read_csv → query → head 链路", () => {
    const result = run({
      nodes: [
        node("n1", "io.read_csv", { header: "infer" }),
        node("n2", "pandas.query", { expression: "voltage >= 2" }),
        node("n3", "pandas.head", { n: 2 }),
      ],
      edges: [edge("n1", "n2"), edge("n2", "n3")],
    }, SAMPLE_CSV);
    expect(result.status).toBe("success");
    const preview = result.preview as { rows: unknown[] };
    expect(preview.rows).toEqual([[2, 0.3], [3, 0.4]]);
  });

  it("原生随机数源可直接连接到打印节点，并在 JS 后端复现", () => {
    const workflow = {
      nodes: [
        node("random", "generate.random_table", { count: 4, seed: 2024, min: 0, max: 1 }),
        node("print", "python.print"),
      ],
      edges: [edge("random", "print", { sourceHandle: "output", targetHandle: "input" })],
    };
    const first = run(workflow);
    const second = run(workflow);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    const firstRandom = (first.nodeResults as Record<string, { kind: string; preview?: { columns: string[]; rows: unknown[][] } }>).random;
    const secondRandom = (second.nodeResults as Record<string, { kind: string; preview?: { columns: string[]; rows: unknown[][] } }>).random;
    expect(firstRandom.kind).toBe("table");
    expect(firstRandom.preview?.columns).toEqual(["index", "value"]);
    expect(firstRandom.preview?.rows).toHaveLength(4);
    expect(secondRandom.preview?.rows).toEqual(firstRandom.preview?.rows);
  });

  it("原生空列表和空 DataFrame 在 JS 后端可作为显式数据源", () => {
    const emptyList = run({ nodes: [node("list", "generate.empty_list")], edges: [] });
    expect(emptyList.status).toBe("success");
    expect((emptyList.nodeResults as Record<string, { kind: string; text?: string; value?: unknown }>).list).toEqual({ kind: "value", text: "[]", value: [] });

    const emptyTable = run({ nodes: [node("table", "generate.empty_table", { columns: ["x", "y"] })], edges: [] });
    expect(emptyTable.status).toBe("success");
    expect((emptyTable.preview as { columns: string[]; rows: unknown[][] }).columns).toEqual(["x", "y"]);
    expect((emptyTable.preview as { columns: string[]; rows: unknown[][] }).rows).toEqual([]);
  });

  it("plot.line 产出 ECharts 配置", () => {
    const result = run({
      nodes: [
        node("n1", "io.read_csv", { header: "infer" }),
        node("n2", "plot.line", { xColumn: "voltage", yColumns: "current", title: "I-V" }),
      ],
      edges: [edge("n1", "n2")],
    }, SAMPLE_CSV);
    expect(result.status).toBe("success");
    const chart = (result.nodeResults as Record<string, { kind: string; chart: { type: string; option: { series: unknown[] } } }>).n2;
    expect(chart.kind).toBe("plot");
    expect(chart.chart.type).toBe("line");
    expect(chart.chart.option.series).toHaveLength(1);
  });

  it("拓扑排序与循环检测", () => {
    const result = run({
      nodes: [node("a", "python.print"), node("b", "python.print"), node("c", "python.print")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    });
    expect(result.status).toBe("error");
    expect(result.message).toContain("cycles");
  });

  it("Notebook 可视依赖边不参与 JS 拓扑和数据输入", () => {
    const result = run({
      nodes: [
        node("read", "io.read_csv", { header: "infer" }),
        node("query", "pandas.query", { expression: "voltage >= 2" }),
      ],
      edges: [
        edge("read", "query"),
        { source: "query", target: "read", sourceHandle: "output", targetHandle: "input", data: { role: "notebook-variable", variable: "frame" } },
        { source: "read", target: "query", sourceHandle: "output", targetHandle: "input", data: { role: "notebook-parameter", variable: "limit" } },
      ],
    }, SAMPLE_CSV);
    expect(result.status).toBe("success");
    expect((result.preview as { rows: unknown[][] }).rows).toEqual([[2, 0.3], [3, 0.4], [4, 0.5], [5, 0.6]]);
  });

  it("节点失败时报告节点信息并保留已完成结果", () => {
    const result = run({
      nodes: [
        node("n1", "io.read_csv"),
        node("n2", "pandas.query", { expression: "no_such_column > 1" }),
      ],
      edges: [edge("n1", "n2")],
    }, SAMPLE_CSV);
    expect(result.status).toBe("error");
    expect(result.nodeId).toBe("n2");
    expect(result.message).toContain("no_such_column");
  });

  it("for_range 与 while_number 有界执行", () => {
    const result = run({
      nodes: [node("n1", "logic.for_range", { start: 0, stop: 5, step: 1 })],
      edges: [],
    });
    expect(result.status).toBe("success");
    const preview = result.preview as { rows: unknown[][] };
    expect(preview.rows).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it("while_number 达到安全上限报错", () => {
    const result = run({
      nodes: [node("n1", "logic.while_number", { start: 0, condition: "value >= 0", update: "value + 1", maxIterations: 100 })],
      edges: [],
    });
    expect(result.status).toBe("error");
  });

  it("notebook 代码单元共享命名空间并捕获最后一个表达式", () => {
    const result = run({
      nodes: [
        node("c1", "notebook.code_cell", { source: "const x = 21;\nconst df = new Table(['v'], [[1],[2]]);\nx" }),
      ],
      edges: [],
    });
    expect(result.status).toBe("success");
  });

  it("custom JS 函数使用注解端口", () => {
    const code = "function scale(df: table, factor: number): table { return new Table(df.columns, df.rows().map(r => r.map(v => typeof v === 'number' ? v * factor : v))); }";
    const withTable = executeCustomFunction(code, { df: new Table(["v"], [[2], [3]]) }, { factor: "2" });
    expect(withTable.output).toBeInstanceOf(Table);
    expect((withTable.output as Table).column("v")).toEqual([4, 6]);
  });

  it("内置 custom 模板以 JS 语法执行", () => {
    // scale / select_rows / fill_missing / split_columns 模板
    const scale = "function transform(table: table, factor: number = 1): table {\n  return new Table(table.columns, table.rows().map((row) => row.map((value) => typeof value === 'number' ? value * factor : value)));\n}";
    const scaled = executeCustomFunction(scale, { table: new Table(["v"], [[2], [3]]) }, {});
    expect((scaled.output as Table).column("v")).toEqual([2, 3]);

    const selectRows = "function select_rows(table: table, start: number = 0, stop: number = 0): table {\n  const end = stop === 0 ? table.rowCount : stop;\n  return table.sliceRows(start, end);\n}";
    const sliced = executeCustomFunction(selectRows, { table: new Table(["v"], [[1], [2], [3]]) }, { start: "1" });
    expect((sliced.output as Table).rows()).toEqual([[2], [3]]);

    const splitColumns = "function split_columns(table: table, left_columns: list<number> = [0]): tuple<selected: table, remaining: table> {\n  const left = left_columns.map((index) => table.columns[index]);\n  const remaining = table.columns.filter((column) => !left.includes(column));\n  const leftTable = new Table(left, table.rows().map((row) => left_columns.map((index) => row[index])));\n  const rightTable = new Table(remaining, table.rows().map((row) => row.filter((_, c) => remaining.includes(table.columns[c]))));\n  return [leftTable, rightTable];\n}";
    const split = executeCustomFunction(splitColumns, { table: new Table(["a", "b"], [[1, 2], [3, 4]]) }, {});
    expect(split.selected as Table).toBeInstanceOf(Table);
    expect((split.selected as Table).columns).toEqual(["a"]);
    expect((split.remaining as Table).columns).toEqual(["b"]);
  });

  it("executeJsCell 支持 pd/np/plt API", () => {
    const ns = createNotebookNamespace("", []);
    const first = executeJsCell("const t = pd.DataFrame({a: [1, 2], b: [3, 4]});\nt", ns);
    expect(first.table).toBeInstanceOf(Table);
    const second = executeJsCell("np.arange(3)", ns);
    expect(second.outputs.output).toEqual([0, 1, 2]);
  });

  it("批量 CSV 提取 Vg 元数据", () => {
    const files = [{ name: "sample_vg=1.5V.csv", text: "voltage,current\n0,0.1\n1,0.2\n" }];
    const result = run({
      nodes: [node("n1", "io.read_csv_batch", { filenamePattern: "vg\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*v" })],
      edges: [],
    }, "", files);
    expect(result.status).toBe("success");
    const preview = result.preview as { columns: string[]; rows: unknown[][] };
    expect(preview.columns).toContain("Vg_V");
    expect(preview.columns).toContain("source_file");
    expect(preview.rows[0][preview.columns.indexOf("Vg_V")]).toBe(1.5);
  });

  it("按列分组聚合对齐常用 pandas groupby 语义", () => {
    const result = run({
      nodes: [
        node("read", "io.read_csv", { header: "infer" }),
        node("agg", "table.groupby_aggregate", { groupBy: "group", method: "mean" }),
      ],
      edges: [edge("read", "agg")],
    }, "group,value\na,1\na,3\nb,4\nb,6\n");
    expect(result.status).toBe("success");
    expect((result.preview as { rows: unknown[][] }).rows).toEqual([["a", 2], ["b", 5]]);
  });

  it("设置变量与读取变量在一次工作流执行中共享状态", () => {
    const result = run({
      nodes: [
        node("read", "io.read_csv", { header: "infer" }),
        node("set", "variable.set", { name: "saved" }),
        node("get", "variable.get", { name: "saved" }),
      ],
      edges: [edge("read", "set"), edge("set", "get", { targetHandle: "previous" })],
    }, "value\n1\n2\n");
    expect(result.status).toBe("success");
    expect((result.preview as { rows: unknown[][] }).rows).toEqual([[1], [2]]);
  });

  it("heatmap 产出可序列化且可自适应的可视化配置", () => {
    const table = new Table(["row", "a", "b"], [["r1", 1, 2], ["r2", 3, 4]]);
    const chart = heatmapPlot(table, { rowLabelColumn: "row", xTickInterval: 2, showColorBar: true });
    expect(chart.type).toBe("heatmap");
    expect(chart.option.series).toHaveLength(1);
    const data = (chart.option.series as Array<{ data: unknown[] }>)[0].data;
    expect(data).toHaveLength(4);
    expect(chart.option.__pydroidHeatmapMeta).toEqual(expect.objectContaining({ xLabels: ["a", "b"], xTickInterval: 2 }));
    expect(JSON.parse(JSON.stringify(chart)).option.__pydroidHeatmapMeta.xLabels).toEqual(["a", "b"]);
    expect(JSON.stringify(chart)).not.toContain("formatter");
    expect(heatmapPlot(table, { rowLabelColumn: "row", showColorBar: false }).option.visualMap).toBeUndefined();
  });

  it("linePlot 校验参数范围", () => {
    const table = new Table(["x", "y"], [[1, 2]]);
    expect(() => linePlot(table, { xColumn: "x", yColumns: "y", figureWidth: 100 })).toThrow("outside the supported range");
  });
});

describe("分组扁平化", () => {
  it("workflow.group 端口展开后可执行", () => {
    const inner = node("inner", "table.absolute");
    const group = node("group", "workflow.group", {}, {
      groupInputs: [{ id: "in", internalNodeId: "inner", internalHandle: "input" }],
      groupOutputs: [{ id: "out", internalNodeId: "inner", internalHandle: "output" }],
    });
    const result = run({
      nodes: [node("n1", "io.read_csv", { header: "infer" }), group, inner, node("n3", "pandas.head", { n: 2 })],
      edges: [
        edge("n1", "group", { targetHandle: "in" }),
        edge("group", "n3", { sourceHandle: "out" }),
      ],
    }, SAMPLE_CSV);
    expect(result.status).toBe("success");
    const preview = result.preview as { rows: unknown[][] };
    expect(preview.rows).toEqual([[0, 0.1], [1, 0.2]]);
  });
});

describe("通用控制结构", () => {
  it("If 条件结构只执行选中的分支", () => {
    const condition = node("read", "io.read_csv", { header: "infer" });
    const structure = node("if-any", "logic.if_value");
    const child = node("abs", "table.absolute");
    (child as { parentId?: string }).parentId = "if-any";
    ((child as { data: Record<string, unknown> }).data).branch = "true";
    const result = run({
      nodes: [condition, structure, child],
      edges: [edge("read", "if-any", { targetHandle: "condition" })],
    }, "x\n-2\n3\n");
    expect(result.status).toBe("success");
    expect((result.preview as { rows: unknown[][] }).rows).toEqual([[2], [3]]);
  });

  it("For Each 可逐行处理表格并统一收集为列表", () => {
    const structure = node("for-any", "logic.for_each_value", { maxIterations: 10 });
    const child = node("abs", "table.absolute");
    (child as { parentId?: string }).parentId = "for-any";
    ((child as { data: Record<string, unknown> }).data).branch = "body";
    const count = node("count", "python.len");
    const result = run({
      nodes: [node("read", "io.read_csv", { header: "infer" }), structure, child, count],
      edges: [
        edge("read", "for-any", { targetHandle: "input" }),
        edge("for-any", "count", { sourceHandle: "done", targetHandle: "input" }),
      ],
    }, "x\n-2\n3\n");
    expect(result.status).toBe("success");
    expect((result.nodeResults as Record<string, { value?: unknown }>).count.value).toBe(2);
  });

  it("While State 可用非空状态模式反复执行循环体", () => {
    const structure = node("while-any", "logic.while_state", { conditionMode: "notEmpty", condition: "value < 10", maxIterations: 10 });
    const child = node("drop-first", "table.slice", { rowStart: "1", rowStop: "", rowStep: 1, columnStart: "", columnStop: "", columnStep: 1 });
    (child as { parentId?: string }).parentId = "while-any";
    ((child as { data: Record<string, unknown> }).data).branch = "body";
    const result = run({
      nodes: [node("read", "io.read_csv", { header: "infer" }), structure, child],
      edges: [edge("read", "while-any", { targetHandle: "input" })],
    }, "x\n1\n2\n3\n");
    expect(result.status).toBe("success");
    expect((result.preview as { rows: unknown[][] }).rows).toEqual([]);
  });

  it("通用控制结构允许嵌套", () => {
    const outer = node("for-any", "logic.for_each_value", { maxIterations: 10 });
    const inner = node("if-any", "logic.if_value");
    (inner as { parentId?: string }).parentId = "for-any";
    ((inner as { data: Record<string, unknown> }).data).branch = "body";
    const child = node("abs", "table.absolute");
    (child as { parentId?: string }).parentId = "if-any";
    ((child as { data: Record<string, unknown> }).data).branch = "true";
    const count = node("count", "python.len");
    const result = run({
      nodes: [node("read", "io.read_csv", { header: "infer" }), outer, inner, child, count],
      edges: [
        edge("read", "for-any", { targetHandle: "input" }),
        edge("for-any", "count", { sourceHandle: "done", targetHandle: "input" }),
      ],
    }, "x\n-2\n3\n");
    expect(result.status).toBe("success");
    expect((result.nodeResults as Record<string, { value?: unknown }>).count.value).toBe(2);
  });
});
