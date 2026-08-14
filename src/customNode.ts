import type { NodeSpec, ParameterSpec, PortSpec, ValueType } from "./nodeCatalog";

export type ParsedFunctionSignature = {
  functionName: string;
  inputPorts: PortSpec[];
  outputPorts: PortSpec[];
  outputType: ValueType;
  parameters: ParameterSpec[];
  error?: string;
};

type AnnotationSpec = {
  valueType?: ValueType;
  optional?: boolean;
  listItemType?: "number" | "text" | "boolean";
  literalOptions?: Array<{ label: string; value: string | number }>;
  tupleOutputs?: Array<{ id: string; label: string; valueType: ValueType }>;
};

export type CustomNodeTemplate = {
  id: string;
  label: string;
  description: string;
  code: string;
};

export type CustomNodeTemplateDocument = {
  format: "pydroid-flow.custom-node-template";
  version: 1;
  template: CustomNodeTemplate;
};

export function serializeCustomNodeTemplate(template: CustomNodeTemplate): CustomNodeTemplateDocument {
  return { format: "pydroid-flow.custom-node-template", version: 1, template };
}

export function parseCustomNodeTemplate(text: string): CustomNodeTemplate {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("模板文件必须是 JSON 对象");
  const document = value as Partial<CustomNodeTemplateDocument>;
  if (document.format !== "pydroid-flow.custom-node-template" || document.version !== 1) {
    throw new Error("不支持的自定义节点模板格式或版本");
  }
  const template = document.template;
  if (!template || typeof template.id !== "string" || typeof template.label !== "string" || typeof template.code !== "string" || typeof template.description !== "string") {
    throw new Error("模板缺少 id、label、description 或 code");
  }
  const signature = parsePythonFunctionSignature(template.code);
  if (signature.error) throw new Error(`模板函数签名无效：${signature.error}`);
  return template;
}

export const CUSTOM_NODE_TEMPLATES: CustomNodeTemplate[] = [
  {
    id: "scale",
    label: "数值缩放",
    description: "将表格中的所有数值乘以指定倍数。",
    code: "def transform(table: 'table', factor: float = 1) -> 'table':\n    return table * factor",
  },
  {
    id: "select_rows",
    label: "按行截取",
    description: "使用可选起点和终点截取表格行。",
    code: "def select_rows(table: 'table', start: int = 0, end: Optional[int] = None) -> 'table':\n    return table.iloc[start:end].reset_index(drop=True)",
  },
  {
    id: "fill_missing",
    label: "填充缺失值",
    description: "选择前向、后向或固定值填充。",
    code: "def fill_missing(table: 'table', method: Literal['forward', 'backward', 'value'] = 'forward', value: float = 0) -> 'table':\n    if method == 'forward':\n        return table.ffill()\n    if method == 'backward':\n        return table.bfill()\n    return table.fillna(value)",
  },
  {
    id: "split_columns",
    label: "拆分双输出",
    description: "按列序号拆成左右两个表格输出。",
    code: "def split_columns(table: 'table', left_columns: list[int] = [0]) -> tuple['selected:table', 'remaining:table']:\n    right_columns = [index for index in range(table.shape[1]) if index not in left_columns]\n    return table.iloc[:, left_columns], table.iloc[:, right_columns]",
  },
];

function stripQuotes(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitTopLevel(raw: string, separator = ","): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote) {
      if (character === quote && raw[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if ("[({".includes(character)) {
      depth += 1;
    } else if ("])}".includes(character)) {
      depth -= 1;
    } else if (character === separator && depth === 0) {
      items.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(raw.slice(start).trim());
  return items.filter(Boolean);
}

function unwrapGeneric(raw: string): { name: string; arguments: string[] } | undefined {
  const match = raw.trim().match(/^([A-Za-z_.][\w.]*)\s*\[([\s\S]*)\]$/);
  if (!match) return undefined;
  return { name: match[1].toLowerCase(), arguments: splitTopLevel(match[2]) };
}

function scalarValueType(raw: string): ValueType | undefined {
  const annotation = stripQuotes(raw).replaceAll(" ", "").toLowerCase();
  if (["table", "dataframe", "pd.dataframe", "pandas.dataframe"].includes(annotation)) return "table";
  if (["plot", "image"].includes(annotation)) return "plot";
  if (annotation === "csv") return "csv";
  if (["int", "float", "number"].includes(annotation)) return "number";
  if (["str", "text", "string"].includes(annotation)) return "text";
  if (["bool", "boolean"].includes(annotation)) return "boolean";
  if (["any", "typing.any"].includes(annotation)) return "any";
  return undefined;
}

function parseLiteral(rawValues: string[]): AnnotationSpec | undefined {
  const values = rawValues.map((raw) => {
    const value = stripQuotes(raw);
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value === "True") return 1;
    if (value === "False") return 0;
    return value;
  });
  if (!values.length || !values.every((value) => typeof value === typeof values[0])) return undefined;
  return {
    valueType: typeof values[0] === "number" ? "number" : "text",
    literalOptions: values.map((value) => ({ label: String(value), value })),
  };
}

function annotationSpec(raw: string): AnnotationSpec | undefined {
  const value = raw.trim();
  const pipeParts = splitTopLevel(value, "|");
  if (pipeParts.length > 1) {
    const nonNull = pipeParts.filter((part) => !["none", "nonetype"].includes(stripQuotes(part).toLowerCase()));
    if (nonNull.length !== 1) return undefined;
    const parsed = annotationSpec(nonNull[0]);
    return parsed ? { ...parsed, optional: true } : undefined;
  }
  const generic = unwrapGeneric(value);
  if (generic) {
    if (["optional", "typing.optional"].includes(generic.name) && generic.arguments.length === 1) {
      const parsed = annotationSpec(generic.arguments[0]);
      return parsed ? { ...parsed, optional: true } : undefined;
    }
    if (["union", "typing.union"].includes(generic.name)) {
      const nonNull = generic.arguments.filter((part) => !["none", "nonetype"].includes(stripQuotes(part).toLowerCase()));
      if (nonNull.length !== 1) return undefined;
      const parsed = annotationSpec(nonNull[0]);
      return parsed ? { ...parsed, optional: true } : undefined;
    }
    if (["list", "typing.list", "sequence", "typing.sequence"].includes(generic.name) && generic.arguments.length === 1) {
      const itemType = scalarValueType(generic.arguments[0]);
      if (!itemType || !["number", "text", "boolean"].includes(itemType)) return undefined;
      return { valueType: "text", listItemType: itemType as "number" | "text" | "boolean" };
    }
    if (["literal", "typing.literal"].includes(generic.name)) return parseLiteral(generic.arguments);
    if (["tuple", "typing.tuple"].includes(generic.name)) {
      const tupleOutputs = generic.arguments.map((argument, index) => {
        const declaration = stripQuotes(argument);
        const separator = declaration.indexOf(":");
        const proposedId = separator > 0 ? declaration.slice(0, separator).trim() : `output${index + 1}`;
        const rawType = separator > 0 ? declaration.slice(separator + 1).trim() : argument;
        const valueType = scalarValueType(rawType);
        if (!valueType || !/^[A-Za-z_]\w*$/.test(proposedId)) return undefined;
        return { id: proposedId, label: separator > 0 ? proposedId : `结果 ${index + 1}`, valueType };
      });
      if (tupleOutputs.some((item) => !item) || new Set(tupleOutputs.map((item) => item?.id)).size !== tupleOutputs.length) return undefined;
      return { tupleOutputs: tupleOutputs as Array<{ id: string; label: string; valueType: ValueType }> };
    }
  }
  const valueType = scalarValueType(value);
  return valueType ? { valueType } : undefined;
}

function splitDefault(raw: string): { declaration: string; defaultValue?: string } {
  const parts = splitTopLevel(raw, "=");
  return parts.length > 1
    ? { declaration: parts[0], defaultValue: raw.slice(raw.indexOf("=") + 1).trim() }
    : { declaration: raw };
}

function parseFunctionHeader(code: string): { functionName: string; argumentsText: string; returnText?: string } | undefined {
  const start = /def\s+([A-Za-z_]\w*)\s*\(/m.exec(code);
  if (!start || start.index === undefined) return undefined;
  const openIndex = start.index + start[0].lastIndexOf("(");
  let depth = 1;
  let quote = "";
  let closeIndex = -1;
  for (let index = openIndex + 1; index < code.length; index += 1) {
    const character = code[index];
    if (quote) {
      if (character === quote && code[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex < 0) return undefined;
  const suffix = code.slice(closeIndex + 1);
  depth = 0;
  quote = "";
  let colonIndex = -1;
  for (let index = 0; index < suffix.length; index += 1) {
    const character = suffix[index];
    if (quote) {
      if (character === quote && suffix[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if ("[({".includes(character)) depth += 1;
    else if ("])}".includes(character)) depth -= 1;
    else if (character === ":" && depth === 0) {
      colonIndex = index;
      break;
    }
  }
  if (colonIndex < 0) return undefined;
  const returnDeclaration = suffix.slice(0, colonIndex).trim();
  return {
    functionName: start[1],
    argumentsText: code.slice(openIndex + 1, closeIndex),
    returnText: returnDeclaration.startsWith("->") ? returnDeclaration.slice(2).trim() : undefined,
  };
}

function parseDefaultValue(raw: string | undefined, kind: ParameterSpec["kind"]): string | number | boolean | null | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "None") return null;
  if (kind === "boolean") return value === "True";
  if (kind === "number" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (kind === "text" || kind === "select") return stripQuotes(value);
  return value;
}

export function parsePythonFunctionSignature(code: string): ParsedFunctionSignature {
  const header = parseFunctionHeader(code);
  const empty = { functionName: "", inputPorts: [], outputPorts: [], outputType: "any" as const, parameters: [] };
  if (!header) return { ...empty, error: "未找到有效的 Python 函数定义" };

  const { functionName, argumentsText: rawArguments, returnText: rawReturn } = header;
  const inputPorts: PortSpec[] = [];
  const parameters: ParameterSpec[] = [];
  for (const rawArgument of splitTopLevel(rawArguments)) {
    const { declaration, defaultValue } = splitDefault(rawArgument);
    const argument = declaration.match(/^([A-Za-z_]\w*)\s*(?::\s*(.+))?$/);
    if (!argument) return { ...empty, functionName, error: `无法解析参数：${rawArgument}` };
    const [, name, annotation] = argument;
    const parsed = annotation ? annotationSpec(annotation) : undefined;
    if (!parsed?.valueType || parsed.tupleOutputs) return { ...empty, functionName, error: `参数 ${name} 缺少受支持的类型标注` };
    const required = defaultValue === undefined && !parsed.optional;
    if (["table", "plot", "csv", "any"].includes(parsed.valueType)) {
      inputPorts.push({ id: name, label: name, valueType: parsed.valueType, required });
      continue;
    }
    const kind: ParameterSpec["kind"] = parsed.literalOptions ? "select" : parsed.listItemType ? "list" : parsed.valueType === "number" ? "number" : parsed.valueType === "boolean" ? "boolean" : "text";
    parameters.push({
      key: name,
      label: name,
      kind,
      options: parsed.literalOptions,
      itemType: parsed.listItemType,
      required,
      placeholder: defaultValue?.trim(),
      defaultValue: parseDefaultValue(defaultValue, kind),
      description: `${annotation.trim()}${required ? " · 必填" : defaultValue === undefined ? " · 可选" : ` · 默认 ${defaultValue.trim()}`}`,
    });
  }

  const output = rawReturn ? annotationSpec(rawReturn) : undefined;
  if (!output || (!output.valueType && !output.tupleOutputs)) {
    return { ...empty, functionName, inputPorts, parameters, error: "函数返回值缺少受支持的类型标注" };
  }
  const outputPorts = output.tupleOutputs
    ? output.tupleOutputs
    : [{ id: "output", label: "结果", valueType: output.valueType! }];
  return { functionName, inputPorts, outputPorts, outputType: outputPorts[0].valueType, parameters };
}

export function resolveNodeSpec(base: NodeSpec | undefined, parameters: Record<string, unknown>): NodeSpec | undefined {
  if (!base || base.nodeType !== "custom.python_function") return base;
  const signature = parsePythonFunctionSignature(String(parameters.code ?? ""));
  return {
    ...base,
    inputPorts: signature.error ? base.inputPorts : signature.inputPorts,
    outputPorts: signature.error ? base.outputPorts : signature.outputPorts,
    parameters: [...base.parameters, ...signature.parameters],
  };
}
