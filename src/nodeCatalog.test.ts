import { describe, expect, it } from "vitest";
import {
  areValueTypesCompatible,
  getInputPort,
  getNodeSpec,
  getOutputPort,
  NODE_CATALOG,
  searchNodeCatalog,
} from "./nodeCatalog";
import { parseCustomNodeTemplate, parsePythonFunctionSignature, resolveNodeSpec, serializeCustomNodeTemplate } from "./customNode";

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
    expect(getNodeSpec("logic.if_rows")!.outputPorts.map((port) => [port.id, port.valueType])).toEqual([
      ["true", "table"],
      ["false", "table"],
    ]);
    expect(getNodeSpec("logic.merge_rows")!.inputPorts.map((port) => port.id)).toEqual(["left", "right"]);
    expect(getNodeSpec("logic.for_range")!.inputPorts).toHaveLength(0);
    expect(getNodeSpec("logic.while_number")!.parameters.map((parameter) => parameter.key)).toContain("maxIterations");
    expect(getNodeSpec("logic.for_each_subflow")!.outputPorts.map((port) => port.id)).toEqual(["body", "done"]);
    expect(getNodeSpec("logic.while_subflow")!.inputPorts.map((port) => port.id)).toEqual(["input", "continue"]);
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
    expect(getNodeSpec("analysis.ter_matrix")!.parameters.map((parameter) => parameter.key)).toEqual(expect.arrayContaining([
      "vgColumn", "voltageColumn", "currentColumn", "vstep", "tolerance", "mode",
    ]));
    expect(getNodeSpec("pulse.generate_waveform")!.inputPorts).toHaveLength(0);
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
