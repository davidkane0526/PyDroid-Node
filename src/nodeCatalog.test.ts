import { describe, expect, it } from "vitest";
import {
  areValueTypesCompatible,
  getInputPort,
  getNodeSpec,
  getOutputPort,
  NODE_CATALOG,
  searchNodeCatalog,
} from "./nodeCatalog";
import { parseCustomNodeTemplate, parsePythonFunctionSignature, serializeCustomNodeTemplate } from "./customNode";
import { resolveNodeSpec } from "./nodeSpec";

describe("node function signatures", () => {
  it("declares input and output signatures for every built-in node", () => {
    for (const spec of NODE_CATALOG) {
      expect(Array.isArray(spec.inputPorts), spec.nodeType).toBe(true);
      expect(spec.outputPorts.length, spec.nodeType).toBeGreaterThan(0);
    }
  });

  it("accepts table pipelines and rejects incompatible output types", () => {
    const tableOutput = getOutputPort("io.read_csv", "output");
    const tableInput = getInputPort("table.absolute", "input");
    const plotOutput = getOutputPort("plot.line", "output");

    expect(areValueTypesCompatible(tableOutput!.valueType, tableInput!.valueType)).toBe(true);
    expect(areValueTypesCompatible(plotOutput!.valueType, tableInput!.valueType)).toBe(false);
  });

  it("exposes required dual inputs in the concat signature", () => {
    const spec = getNodeSpec("table.concat")!;
    expect(spec.inputPorts.map((port) => [port.id, port.valueType, port.required])).toEqual([
      ["left", "table", true],
      ["right", "table", true],
    ]);
  });

  it("provides configurable plots, common pandas nodes and typed condition branches", () => {
    expect(getNodeSpec("plot.line")!.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining([
      "xColumn", "yColumns", "title", "xLabel", "yLabel", "lineWidth", "figureWidth", "figureHeight", "dpi",
    ]));
    expect(getNodeSpec("plot.line")!.parameters.find((parameter) => parameter.key === "lineWidth")?.control).toBe("slider");
    expect(NODE_CATALOG.filter((spec) => spec.category === "Pandas 常用")).toHaveLength(9);
    expect(getNodeSpec("table.split_condition")!.outputPorts.map((port) => [port.id, port.valueType])).toEqual([
      ["true", "table"],
      ["false", "table"],
    ]);
    expect(getNodeSpec("table.merge_rows")!.inputPorts.map((port) => port.id)).toEqual(["left", "right"]);
    expect(getNodeSpec("logic.for_range")!.inputPorts.map((port) => [port.id, port.defaultParameter])).toEqual([["start", "start"], ["stop", "stop"], ["step", "step"]]);
    expect(getNodeSpec("logic.for_range")!.category).toBe("列表处理");
    expect(getNodeSpec("logic.while_number")!.category).toBe("列表处理");
    expect(getNodeSpec("logic.while_number")!.parameters.map((parameter) => parameter.key)).toContain("maxIterations");
    expect(getNodeSpec("logic.while_number")!.outputPorts.map((port) => port.id)).toEqual(["output", "last", "iterations"]);
    expect(getNodeSpec("logic.if_subflow")).toBeUndefined();
    expect(getNodeSpec("logic.for_each_subflow")).toBeUndefined();
    expect(getNodeSpec("logic.while_subflow")).toBeUndefined();
    expect(getNodeSpec("logic.if_value")!.inputPorts.map((port) => port.id)).toEqual(["condition", "input"]);
    expect(getNodeSpec("logic.if_value")!.outputPorts.map((port) => port.id)).toEqual(["done"]);
    expect(getNodeSpec("logic.if_value")!.parameters).toEqual([]);
    expect(getNodeSpec("logic.compare")?.runtimeSupport).toEqual(["python", "javascript"]);
    expect(getNodeSpec("logic.switch")?.runtimeSupport).toEqual(["python", "javascript"]);
    expect(getNodeSpec("math.operation")?.runtimeSupport).toEqual(["python", "javascript"]);
    expect(getNodeSpec("logic.boolean_math")?.runtimeSupport).toEqual(["python", "javascript"]);
    expect(getNodeSpec("logic.for_each_value")!.outputPorts.map((port) => port.id)).toEqual(["done", "last", "lastItem"]);
    expect(getNodeSpec("logic.for_each_value")!.ui?.inlineParameters).toEqual(["maxIterations"]);
    expect(getNodeSpec("logic.while_state")!.parameters.map((parameter) => parameter.key)).toEqual(["conditionMode", "condition", "maxIterations"]);
    expect(getNodeSpec("sequence.reduce")!.ui?.inlineParameters).toEqual(["method"]);
    expect(getNodeSpec("sequence.accumulate")!.ui?.inlineParameters).toEqual(["method"]);
    expect(getNodeSpec("sequence.accumulate")!.outputPorts.map((port) => port.id)).toEqual(["output", "last"]);
    expect(getNodeSpec("plot.heatmap")!.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining([
      "rowLabelColumn", "xTickInterval", "yTickInterval", "xTickRotation", "origin", "aspect",
      "interpolation", "colorMap", "colorMin", "colorMax", "showColorBar", "colorBarLabel", "figureWidth", "dpi",
    ]));
  });

  it("matches functions by Chinese intent, callable name and fuzzy text", () => {
    expect(searchNodeCatalog("去重")[0].nodeType).toBe("pandas.drop_duplicates");
    expect(searchNodeCatalog("DataFrame head").map((spec) => spec.nodeType)).toContain("pandas.head");
    expect(searchNodeCatalog("readcsv")[0].nodeType).toBe("io.read_csv");
    expect(searchNodeCatalog("Python 长度")[0].nodeType).toBe("python.len");
  });

  it("exposes read_csv signature parameters in basic and advanced groups", () => {
    const spec = getNodeSpec("io.read_csv")!;
    expect(spec.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining([
      "separator", "header", "names", "useColumns", "dtype", "skipRows", "nRows", "naValues",
      "parseDates", "dateFormat", "quoteChar", "encoding", "onBadLines", "floatPrecision",
    ]));
    expect(spec.parameters.filter((parameter) => parameter.advanced).length).toBeGreaterThan(15);
    expect(spec.parameters.filter((parameter) => parameter.rememberDefault).map((parameter) => parameter.key)).toContain("encoding");
  });

  it("provides multi-file CSV metadata extraction and TER calculation nodes", () => {
    expect(getNodeSpec("io.read_csv_batch")!.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining([
      "useColumns", "sourceColumn", "metadataColumn", "filenamePattern", "onError",
    ]));
    const collection = getNodeSpec("io.read_csv_collection")!;
    expect(collection.outputPorts.map((port) => [port.id, port.valueType])).toEqual([["output", "list"], ["metadata", "table"], ["warnings", "list"]]);
    expect(collection.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining([
      "skipRows", "sourceColumn", "metadataColumn", "filenamePattern", "metadataType", "metadataError", "duplicateMetadata", "orderBy", "onError",
    ]));
    const concatMany = getNodeSpec("table.concat_many")!;
    expect(concatMany.inputPorts.map((port) => [port.id, port.valueType, port.required])).toEqual([["tables", "list", true], ["metadata", "table", undefined]]);
    expect(concatMany.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining(["alignment", "prefixMode", "sourceColumn", "prefixColumn", "prefixTemplate"]));
    expect(getNodeSpec("analysis.ter_matrix")!.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining([
      "vgColumn", "voltageColumn", "currentColumn", "vstep", "tolerance", "mode",
    ]));
    expect(getNodeSpec("pulse.generate_waveform")!.inputPorts).toHaveLength(0);
    const square = getNodeSpec("pulse.generate_square_waveform")!;
    expect(square.runtimeSupport).toEqual(["python", "javascript"]);
    expect(square.inputPorts).toHaveLength(0);
    expect(square.outputPorts.map((port) => [port.id, port.valueType])).toEqual([["output", "table"]]);
    expect(square.defaults).toMatchObject({ highVoltage: 5, lowVoltage: 0, repeatCount: 1, startLevel: "high", timeStart: 0, totalTime: 0 });
    expect(square.parameters.map((parameter) => parameter.key)).toEqual([
      "highVoltage", "lowVoltage", "highTime", "lowTime", "repeatCount", "startLevel", "timeStart", "totalTime",
    ]);
    expect(getNodeSpec("pulse.combine_channels")!.inputPorts.map((port) => port.id)).toEqual(["drain", "source", "gate"]);
    expect(getNodeSpec("pulse.segment_measurement")!.inputPorts.map((port) => [port.id, port.required])).toEqual([["measurement", true], ["waveform", true]]);
  });

  it("only marks reusable presentation preferences as plot defaults", () => {
    const preferred = getNodeSpec("plot.line")!.parameters.filter((parameter) => parameter.rememberDefault).map((parameter) => parameter.key);
    expect(preferred).toEqual(expect.arrayContaining(["lineWidth", "figureWidth", "figureHeight", "dpi"]));
    expect(preferred).not.toContain("xColumn");
    expect(preferred).not.toContain("yColumns");
    expect(preferred).not.toContain("title");
  });

  it("derives ports and editable parameters from a custom Python signature", () => {
    const code = "def merge(left: 'table', right: 'table', factor: float = 2) -> 'table':\n    return left";
    const signature = parsePythonFunctionSignature(code);
    expect(signature.error).toBeUndefined();
    expect(signature.inputPorts.map((port) => port.id)).toEqual(["left", "right"]);
    expect(signature.parameters.map((parameter) => [parameter.key, parameter.kind])).toEqual([["factor", "number"]]);
    expect(signature.outputType).toBe("table");

    const resolved = resolveNodeSpec(getNodeSpec("custom.python_function"), { code })!;
    expect(resolved.inputPorts).toHaveLength(2);
    expect(resolved.parameters.map((parameter) => parameter.key)).toEqual(["code", "factor"]);
  });

  it("resolves declarative dynamic ports for Compare and Switch", () => {
    const compareText = resolveNodeSpec(getNodeSpec("logic.compare"), { valueType: "text", operation: "contains", a: "abc", b: "b" })!;
    expect(compareText.inputPorts.map((port) => [port.id, port.valueType, port.defaultParameter])).toEqual([
      ["a", "text", "a"],
      ["b", "text", "b"],
    ]);
    expect(compareText.parameters.find((parameter) => parameter.key === "a")?.kind).toBe("text");
    expect(compareText.parameters.find((parameter) => parameter.key === "operation")?.options?.map((option) => option.value)).toContain("contains");

    const switchTable = resolveNodeSpec(getNodeSpec("logic.switch"), { valueType: "table" })!;
    expect(switchTable.inputPorts.map((port) => [port.id, port.valueType, port.required, port.defaultParameter])).toEqual([
      ["condition", "boolean", undefined, "condition"],
      ["false", "table", true, undefined],
      ["true", "table", true, undefined],
    ]);
    expect(switchTable.outputPorts).toEqual([{ id: "output", label: "Result", valueType: "table" }]);
    expect(switchTable.parameters.map((parameter) => parameter.key)).toEqual(["valueType", "condition"]);
  });

  it("resolves dynamic parameter sockets for ordinary data nodes", () => {
    const defaultRandom = resolveNodeSpec(getNodeSpec("generate.random_table"), {})!;
    expect(defaultRandom.parameters.map((parameter) => parameter.key)).not.toContain("mean");
    expect(defaultRandom.parameters.map((parameter) => parameter.key)).not.toContain("std");

    const normalRandom = resolveNodeSpec(getNodeSpec("generate.random_table"), { distribution: "normal" })!;
    expect(normalRandom.inputPorts.map((port) => [port.id, port.defaultParameter])).toEqual([
      ["count", "count"], ["mean", "mean"], ["std", "std"], ["seed", "seed"],
    ]);
    expect(normalRandom.parameters.map((parameter) => parameter.key)).not.toContain("min");
    expect(normalRandom.parameters.map((parameter) => parameter.key)).not.toContain("max");

    const forwardFill = resolveNodeSpec(getNodeSpec("pandas.fillna"), { method: "forward" })!;
    expect(forwardFill.inputPorts.map((port) => port.id)).toEqual(["input"]);
    expect(forwardFill.parameters.map((parameter) => parameter.key)).toEqual(["method"]);

    expect(getNodeSpec("pandas.head")!.inputPorts.map((port) => [port.id, port.defaultParameter])).toEqual([
      ["input", undefined], ["n", "n"],
    ]);
    expect(getNodeSpec("table.periodic_tail_mean")!.inputPorts.map((port) => port.id)).toEqual(["input", "groupSize", "tailRows"]);

    expect(getNodeSpec("table.select_columns")!.inputPorts.map((port) => [port.id, port.defaultParameter])).toEqual([
      ["input", undefined], ["columns", "columns"],
    ]);
    expect(getNodeSpec("pandas.sort_values")!.inputPorts.map((port) => [port.id, port.defaultParameter])).toEqual([
      ["input", undefined], ["columns", "columns"], ["ascending", "ascending"],
    ]);
    expect(getNodeSpec("table.groupby_aggregate")!.inputPorts.map((port) => [port.id, port.defaultParameter])).toEqual([
      ["input", undefined], ["groupBy", "groupBy"],
    ]);
    expect(getNodeSpec("pulse.generate_square_waveform")!.inputPorts.map((port) => port.defaultParameter)).toEqual([
      "highVoltage", "lowVoltage", "highTime", "lowTime", "repeatCount",
    ]);
    expect(getNodeSpec("plot.line")!.inputPorts.map((port) => [port.id, port.defaultParameter])).toEqual([
      ["input", undefined], ["xColumn", "xColumn"], ["yColumns", "yColumns"], ["lineWidth", "lineWidth"],
    ]);
    expect(getNodeSpec("plot.histogram")!.inputPorts.map((port) => port.id)).toEqual(["input", "yColumns", "bins", "alpha"]);
    expect(getNodeSpec("plot.box")!.inputPorts.map((port) => port.id)).toEqual(["input", "yColumns"]);
    expect(getNodeSpec("plot.scatter")!.inputPorts.map((port) => port.id)).toEqual(["input", "xColumn", "yColumns", "pointSize", "alpha"]);
  });

  it("resolves unary Math / Boolean Math ports and While condition variants", () => {
    const sqrt = resolveNodeSpec(getNodeSpec("math.operation"), { operation: "sqrt", a: 9, b: 3 })!;
    expect(sqrt.inputPorts.map((port) => [port.id, port.label, port.defaultParameter])).toEqual([["a", "Value", "a"]]);
    expect(sqrt.parameters.map((parameter) => parameter.key)).toEqual(["operation", "a"]);

    const not = resolveNodeSpec(getNodeSpec("logic.boolean_math"), { operation: "not", a: true, b: false })!;
    expect(not.inputPorts.map((port) => port.id)).toEqual(["a"]);
    expect(not.parameters.map((parameter) => parameter.key)).toEqual(["operation", "a"]);

    const truthyWhile = resolveNodeSpec(getNodeSpec("logic.while_state"), { conditionMode: "truthy", condition: "value < 10", maxIterations: 5 })!;
    expect(truthyWhile.parameters.map((parameter) => parameter.key)).toEqual(["conditionMode", "maxIterations"]);
  });

  it("reports unsupported or missing Python annotations", () => {
    expect(parsePythonFunctionSignature("def transform(table):\n    return table").error).toContain("类型标注");
  });

  it("supports Optional, list, Literal and tuple output annotations", () => {
    const code = "def split(table: 'table', columns: list[int] = [0], mode: Literal['keep', 'drop'] = 'keep', limit: Optional[int] = None) -> tuple['table', 'table']:\n    return table, table";
    const signature = parsePythonFunctionSignature(code);
    expect(signature.error).toBeUndefined();
    expect(signature.parameters.map((parameter) => [parameter.key, parameter.kind, parameter.required])).toEqual([
      ["columns", "list", false],
      ["mode", "select", false],
      ["limit", "number", false],
    ]);
    expect(signature.parameters[1].options?.map((option) => option.value)).toEqual(["keep", "drop"]);
    expect(signature.outputPorts.map((port) => [port.id, port.valueType])).toEqual([
      ["output1", "table"],
      ["output2", "table"],
    ]);
  });

  it("accepts PEP 604 nullable inputs", () => {
    const signature = parsePythonFunctionSignature("def choose(primary: 'table', fallback: 'table' | None) -> 'table':\n    return primary");
    expect(signature.error).toBeUndefined();
    expect(signature.inputPorts[1]).toMatchObject({ id: "fallback", required: false, valueType: "table" });
  });

  it("uses named tuple annotations as stable output handles", () => {
    const signature = parsePythonFunctionSignature("def split(table: 'table') -> tuple['clean:table', 'rejected:table']:\n    return table, table");
    expect(signature.error).toBeUndefined();
    expect(signature.outputPorts).toEqual([
      { id: "clean", label: "clean", valueType: "table" },
      { id: "rejected", label: "rejected", valueType: "table" },
    ]);
  });

  it("maps Literal[True, False] to a boolean switch instead of a numeric select", () => {
    const signature = parsePythonFunctionSignature("def pick(table: 'table', flag: Literal[True, False] = True) -> 'table':\n    return table");
    expect(signature.error).toBeUndefined();
    expect(signature.parameters[0]).toMatchObject({ key: "flag", kind: "boolean", defaultValue: true });
  });

  it("parses scientific-notation numeric defaults", () => {
    const signature = parsePythonFunctionSignature("def scale(table: 'table', epsilon: float = 1e-3) -> 'table':\n    return table");
    expect(signature.error).toBeUndefined();
    expect(signature.parameters[0]).toMatchObject({ key: "epsilon", kind: "number", defaultValue: 0.001 });
  });

  it("maps dict/set/Series/ndarray annotations to object/list/table", () => {
    const signature = parsePythonFunctionSignature("def enrich(table: 'table', config: dict = None, flags: set[str] = None, extra: 'pd.Series' | None = None) -> 'table':\n    return table");
    expect(signature.error).toBeUndefined();
    expect(signature.parameters.map((parameter) => [parameter.key, parameter.kind])).toEqual([
      ["config", "textarea"],
      ["flags", "list"],
    ]);
    expect(signature.inputPorts.map((port) => [port.id, port.valueType])).toEqual([
      ["table", "table"],
      ["extra", "table"],
    ]);
  });

  it("evaluates arithmetic expressions in numeric defaults", () => {
    const signature = parsePythonFunctionSignature("def scale(table: 'table', factor: float = 10**6, offset: int = 2*3+1) -> 'table':\n    return table");
    expect(signature.error).toBeUndefined();
    expect(signature.parameters.map((parameter) => [parameter.key, parameter.defaultValue])).toEqual([
      ["factor", 1000000],
      ["offset", 7],
    ]);
  });

  it("round-trips a portable custom node template document", () => {
    const template = {
      id: "shared-clean",
      label: "清洗",
      description: "测试模板",
      code: "def clean(table: 'table') -> 'table':\n    return table",
    };
    expect(parseCustomNodeTemplate(JSON.stringify(serializeCustomNodeTemplate(template)))).toEqual(template);
    expect(() => parseCustomNodeTemplate(JSON.stringify({ ...serializeCustomNodeTemplate(template), version: 2 }))).toThrow("版本");
  });
});
