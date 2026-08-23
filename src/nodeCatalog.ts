export type ParameterKind = "text" | "textarea" | "number" | "boolean" | "select" | "list";

export type ValueType = "table" | "plot" | "csv" | "number" | "text" | "boolean" | "list" | "object" | "any";
export type NodeRuntimeId = "python" | "javascript";
export type NodeExecutionModel = "standard" | "control-flow" | "custom-code" | "function" | "ui" | "workflow";
export type NodeStateScope = "none" | "temporary" | "global";
export type NodeStateAccess = "none" | "read" | "write" | "read-write";
export type NodeFunctionRole = "none" | "definition" | "call";
export type NodeCachePolicy = "cacheable" | "uncacheable";

export type PortSpec = {
  id: string;
  label: string;
  valueType: ValueType;
  required?: boolean;
};

export type ParameterSpec = {
  key: string;
  label: string;
  kind: ParameterKind;
  options?: Array<{ label: string; value: string | number | boolean }>;
  description?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  itemType?: "number" | "text" | "boolean";
  defaultValue?: string | number | boolean | null;
  control?: "slider";
  advanced?: boolean;
  rememberDefault?: boolean;
};

export type NodeSpec = {
  nodeType: string;
  nodeVersion?: number;
  label: string;
  description?: string;
  tags?: string[];
  docsUrl?: string;
  pythonCallable?: string;
  excludedSignatureParameters?: string[];
  category: "输入输出" | "表格处理" | "Pandas 常用" | "Python 内置" | "逻辑控制" | "统计" | "绘图" | "列表处理" | "自定义";
  defaults: Record<string, string | number | boolean | null>;
  parameters: ParameterSpec[];
  inputPorts: PortSpec[];
  outputPorts: PortSpec[];
  runtimeSupport?: NodeRuntimeId[];
  executionModel?: NodeExecutionModel;
  deterministic?: boolean;
  sideEffect?: boolean;
  cachePolicy?: NodeCachePolicy;
  stateScope?: NodeStateScope;
  stateAccess?: NodeStateAccess;
  functionRole?: NodeFunctionRole;
};

const TABLE_INPUT: PortSpec[] = [{ id: "input", label: "表格", valueType: "table", required: true }];
const TABLE_OUTPUT: PortSpec[] = [{ id: "output", label: "表格", valueType: "table" }];

export const NODE_CATALOG: NodeSpec[] = [
  {
    nodeType: "notebook.code_cell", runtimeSupport: ["python"], executionModel: "custom-code", deterministic: false, cachePolicy: "uncacheable", label: "Jupyter 代码单元格", category: "自定义",
    description: "无损承载普通 .ipynb 代码单元格；保留源码、输出、执行计数和 metadata。",
    tags: ["jupyter", "ipynb", "代码", "单元格"],
    defaults: { source: "", metadataJson: "{}", outputsJson: "[]", notebookMetadataJson: "{}", executionCount: null },
    parameters: [
      { key: "source", label: "Python 源码", kind: "textarea", required: true },
      { key: "executionCount", label: "执行计数", kind: "number", advanced: true },
      { key: "metadataJson", label: "单元格 metadata", kind: "textarea", advanced: true },
      { key: "outputsJson", label: "原始输出", kind: "textarea", advanced: true },
      { key: "notebookMetadataJson", label: "Notebook metadata", kind: "textarea", advanced: true },
    ],
    inputPorts: [{ id: "previous", label: "前一单元格", valueType: "any" }], outputPorts: [{ id: "next", label: "下一单元格", valueType: "any" }],
  },
  {
    nodeType: "notebook.markdown_cell", runtimeSupport: ["python", "javascript"], label: "Jupyter Markdown", category: "自定义",
    description: "无损承载普通 .ipynb Markdown 单元格及 metadata。", tags: ["jupyter", "ipynb", "markdown", "文本"],
    defaults: { source: "", metadataJson: "{}", outputsJson: "[]", notebookMetadataJson: "{}", executionCount: null },
    parameters: [{ key: "source", label: "Markdown", kind: "textarea", required: true }, { key: "metadataJson", label: "单元格 metadata", kind: "textarea", advanced: true }, { key: "notebookMetadataJson", label: "Notebook metadata", kind: "textarea", advanced: true }],
    inputPorts: [{ id: "previous", label: "前一单元格", valueType: "any" }], outputPorts: [{ id: "next", label: "下一单元格", valueType: "any" }],
  },
  {
    nodeType: "io.read_csv", runtimeSupport: ["python", "javascript"],
    label: "读取 CSV",
    description: "从 CSV 文本读取表格，支持表头、列类型、缺失值、日期和编码。",
    tags: ["csv", "读取", "导入", "pandas", "read_csv", "readcsv"],
    docsUrl: "https://pandas.pydata.org/docs/reference/api/pandas.read_csv.html",
    pythonCallable: "pandas.read_csv",
    excludedSignatureParameters: ["filepath_or_buffer", "converters", "date_parser", "iterator", "chunksize", "compression", "memory_map", "storage_options"],
    category: "输入输出",
    defaults: {
      separator: ",", header: "none", names: "", indexColumn: "", useColumns: "", dtype: "", engine: "c",
      skipInitialSpace: false, skipRows: 0, skipFooter: 0, nRows: "", naValues: "",
      keepDefaultNa: true, naFilter: true, trueValues: "", falseValues: "", skipBlankLines: true,
      parseDates: "", dateFormat: "", dayFirst: false, cacheDates: true, thousands: "", decimal: ".",
      lineTerminator: "", quoteChar: "\"", quoting: 0, dialect: "",
      doubleQuote: true, escapeChar: "", comment: "", encoding: "utf-8",
      encodingErrors: "strict", onBadLines: "error", lowMemory: true, floatPrecision: "",
    },
    inputPorts: [],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "separator", label: "分隔符 · sep", kind: "text", required: true, rememberDefault: true, description: "例如逗号、分号或制表符 \\t。" },
      { key: "header", label: "表头 · header", kind: "select", rememberDefault: true, options: [{ label: "无表头", value: "none" }, { label: "自动识别首行", value: "infer" }, { label: "第 1 行", value: "0" }, { label: "第 2 行", value: "1" }] },
      { key: "names", label: "列名 · names", kind: "list", itemType: "text", placeholder: "time,voltage,current", description: "留空使用文件表头或数字列名。" },
      { key: "indexColumn", label: "索引列 · index_col", kind: "text", placeholder: "0 或 time", description: "留空时生成默认行索引。" },
      { key: "useColumns", label: "读取列 · usecols", kind: "list", itemType: "text", placeholder: "0,2 或 time,current", description: "只载入指定列。" },
      { key: "skipRows", label: "跳过行 · skiprows", kind: "text", placeholder: "2 或 0,2,4", description: "整数表示跳过开头若干行；列表表示跳过指定行。" },
      { key: "nRows", label: "最大行数 · nrows", kind: "number", min: 0, step: 1, description: "0 或留空表示不限制。" },
      { key: "encoding", label: "文件编码 · encoding", kind: "select", rememberDefault: true, options: [{ label: "UTF-8", value: "utf-8" }, { label: "UTF-8 BOM", value: "utf-8-sig" }, { label: "GBK / CP936", value: "gbk" }, { label: "GB18030", value: "gb18030" }, { label: "UTF-16 LE", value: "utf-16le" }, { label: "Windows-1252", value: "windows-1252" }] },
      { key: "dtype", label: "列类型 · dtype", kind: "textarea", advanced: true, placeholder: "{\"voltage\": \"float64\"}", description: "JSON 对象，或单一 pandas dtype 名称。" },
      { key: "engine", label: "解析引擎 · engine", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "C（快速）", value: "c" }, { label: "Python（兼容）", value: "python" }] },
      { key: "skipInitialSpace", label: "忽略分隔符后空格 · skipinitialspace", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "skipFooter", label: "跳过末尾行 · skipfooter", kind: "number", min: 0, step: 1, advanced: true },
      { key: "naValues", label: "缺失值标记 · na_values", kind: "list", itemType: "text", advanced: true, placeholder: "NA,N/A,-" },
      { key: "keepDefaultNa", label: "保留默认缺失值 · keep_default_na", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "naFilter", label: "检测缺失值 · na_filter", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "trueValues", label: "真值文本 · true_values", kind: "list", itemType: "text", advanced: true, placeholder: "true,yes,1" },
      { key: "falseValues", label: "假值文本 · false_values", kind: "list", itemType: "text", advanced: true, placeholder: "false,no,0" },
      { key: "skipBlankLines", label: "跳过空行 · skip_blank_lines", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "parseDates", label: "日期列 · parse_dates", kind: "list", itemType: "text", advanced: true, placeholder: "time,date" },
      { key: "dateFormat", label: "日期格式 · date_format", kind: "text", advanced: true, placeholder: "%Y-%m-%d %H:%M:%S" },
      { key: "dayFirst", label: "日期日优先 · dayfirst", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "cacheDates", label: "缓存日期解析 · cache_dates", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "thousands", label: "千位分隔符 · thousands", kind: "text", advanced: true, rememberDefault: true },
      { key: "decimal", label: "小数点 · decimal", kind: "text", advanced: true, rememberDefault: true },
      { key: "lineTerminator", label: "行结束符 · lineterminator", kind: "text", advanced: true, rememberDefault: true, placeholder: "留空自动识别" },
      { key: "quoteChar", label: "引号字符 · quotechar", kind: "text", advanced: true, rememberDefault: true },
      { key: "quoting", label: "引号规则 · quoting", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "最少引用", value: 0 }, { label: "全部引用", value: 1 }, { label: "非数字引用", value: 2 }, { label: "不处理引号", value: 3 }] },
      { key: "doubleQuote", label: "双引号转义 · doublequote", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "dialect", label: "CSV 方言 · dialect", kind: "text", advanced: true, placeholder: "excel 或 excel-tab" },
      { key: "escapeChar", label: "转义字符 · escapechar", kind: "text", advanced: true, rememberDefault: true },
      { key: "comment", label: "注释字符 · comment", kind: "text", advanced: true, rememberDefault: true },
      { key: "encodingErrors", label: "编码错误 · encoding_errors", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "报错", value: "strict" }, { label: "替换", value: "replace" }, { label: "忽略", value: "ignore" }] },
      { key: "onBadLines", label: "异常行 · on_bad_lines", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "报错", value: "error" }, { label: "警告并跳过", value: "warn" }, { label: "直接跳过", value: "skip" }] },
      { key: "lowMemory", label: "低内存模式 · low_memory", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "floatPrecision", label: "浮点精度 · float_precision", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "默认", value: "" }, { label: "高精度", value: "high" }, { label: "往返精度", value: "round_trip" }, { label: "旧版", value: "legacy" }] },
    ],
  },
  {
    nodeType: "io.read_csv_batch", runtimeSupport: ["python", "javascript"],
    label: "批量读取 CSV",
    description: "一次读取多个 CSV，追加来源文件列，并可从文件名提取 Vg 等元数据。",
    tags: ["csv", "批量", "多文件", "目录", "pandas", "TER"],
    category: "输入输出",
    defaults: {
      separator: ",", header: "infer", skipRows: 0, useColumns: "", encoding: "utf-8",
      sourceColumn: "source_file", metadataColumn: "Vg_V",
      filenamePattern: "vg\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*v", onError: "error",
    },
    inputPorts: [],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "separator", label: "分隔符 · sep", kind: "text", required: true, rememberDefault: true },
      { key: "header", label: "表头 · header", kind: "select", rememberDefault: true, options: [{ label: "无表头", value: "none" }, { label: "自动识别首行", value: "infer" }, { label: "第 1 行", value: "0" }, { label: "第 2 行", value: "1" }] },
      { key: "skipRows", label: "跳过行 · skiprows", kind: "text", placeholder: "1" },
      { key: "useColumns", label: "读取列 · usecols", kind: "list", itemType: "text", placeholder: "0,1" },
      { key: "encoding", label: "文件编码", kind: "select", rememberDefault: true, options: [{ label: "UTF-8", value: "utf-8" }, { label: "UTF-8 BOM", value: "utf-8-sig" }, { label: "GBK / CP936", value: "gbk" }, { label: "GB18030", value: "gb18030" }] },
      { key: "sourceColumn", label: "来源文件列", kind: "text", required: true, placeholder: "source_file" },
      { key: "metadataColumn", label: "文件名元数据列", kind: "text", placeholder: "Vg_V" },
      { key: "filenamePattern", label: "文件名提取正则", kind: "text", placeholder: "vg=...v", description: "第一个捕获组写入元数据列；留空则不提取。" },
      { key: "onError", label: "单文件错误", kind: "select", options: [{ label: "停止并报告", value: "error" }, { label: "跳过错误文件", value: "skip" }] },
    ],
  },
  {
    nodeType: "io.read_csv_collection", runtimeSupport: ["python", "javascript"],
    label: "批量读取 CSV（独立表）",
    description: "逐文件读取 CSV 并保持文件边界，输出表格列表与一一对应的文件元数据；适合 function.map 逐文件执行同一子流程。",
    tags: ["csv", "批量", "多文件", "表格集合", "逐文件", "map", "元数据"],
    category: "输入输出",
    defaults: {
      separator: ",", header: "infer", skipRows: 0, useColumns: "", encoding: "utf-8",
      sourceColumn: "source_file", metadataColumn: "Vg_V",
      filenamePattern: "gate-([-+]?\\d+(?:\\.\\d+)?)v", metadataType: "number",
      metadataError: "error", duplicateMetadata: "error", orderBy: "metadata_asc", onError: "error",
    },
    inputPorts: [],
    outputPorts: [
      { id: "output", label: "表格列表", valueType: "list" },
      { id: "metadata", label: "文件元数据", valueType: "table" },
      { id: "warnings", label: "警告", valueType: "list" },
    ],
    parameters: [
      { key: "separator", label: "分隔符 · sep", kind: "text", required: true, rememberDefault: true },
      { key: "header", label: "表头 · header", kind: "select", rememberDefault: true, options: [{ label: "无表头", value: "none" }, { label: "自动识别首行", value: "infer" }, { label: "第 1 行", value: "0" }, { label: "第 2 行", value: "1" }] },
      { key: "skipRows", label: "每文件跳过行 · skiprows", kind: "text", placeholder: "2", description: "对每个文件独立应用，不会跨文件累计。" },
      { key: "useColumns", label: "读取列 · usecols", kind: "list", itemType: "text", placeholder: "0,1" },
      { key: "encoding", label: "文件编码", kind: "select", rememberDefault: true, options: [{ label: "UTF-8", value: "utf-8" }, { label: "UTF-8 BOM", value: "utf-8-sig" }, { label: "GBK / CP936", value: "gbk" }, { label: "GB18030", value: "gb18030" }] },
      { key: "sourceColumn", label: "来源文件字段", kind: "text", required: true, placeholder: "source_file" },
      { key: "metadataColumn", label: "文件名元数据字段", kind: "text", placeholder: "Vg_V" },
      { key: "filenamePattern", label: "文件名提取正则", kind: "text", placeholder: "gate-([-+]?\\d+(?:\\.\\d+)?)v", description: "第一个捕获组写入元数据；留空则只保留 source_file。" },
      { key: "metadataType", label: "元数据类型", kind: "select", options: [{ label: "数值", value: "number" }, { label: "文本", value: "text" }] },
      { key: "metadataError", label: "元数据缺失/解析失败", kind: "select", options: [{ label: "停止并报告", value: "error" }, { label: "保留空值并警告", value: "warn" }] },
      { key: "duplicateMetadata", label: "重复元数据", kind: "select", options: [{ label: "停止并报告", value: "error" }, { label: "保留并警告", value: "warn" }] },
      { key: "orderBy", label: "结果顺序", kind: "select", options: [{ label: "元数据升序", value: "metadata_asc" }, { label: "元数据降序", value: "metadata_desc" }, { label: "文件名升序", value: "source_file" }, { label: "选择顺序", value: "input" }] },
      { key: "onError", label: "单文件读取错误", kind: "select", options: [{ label: "停止并报告", value: "error" }, { label: "跳过并警告", value: "skip" }] },
    ],
  },
  {
    nodeType: "io.read_table", runtimeSupport: ["python", "javascript"], label: "读取通用表格", category: "输入输出",
    description: "读取 CSV、TSV、DAT 或记录型 JSON；自动模式根据扩展名和内容选择 pandas.read_csv 或 pandas.read_json。", tags: ["读取", "csv", "tsv", "dat", "json", "表格"], pythonCallable: "pydroid_flow.read_table_auto",
    defaults: { fileIndex: 0, separator: "auto", header: true, encoding: "utf-8", encodingErrors: "strict" }, inputPorts: [], outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "fileIndex", label: "文件序号（从 0 开始）", kind: "number", min: 0, step: 1 }, { key: "separator", label: "分隔符", kind: "select", options: [{ label: "自动识别", value: "auto" }, { label: "逗号", value: "," }, { label: "制表符", value: "\t" }, { label: "空白", value: "\\s+" }, { label: "分号", value: ";" }] }, { key: "header", label: "首行为表头", kind: "boolean" }, { key: "encoding", label: "文件编码", kind: "select", options: [{ label: "UTF-8", value: "utf-8" }, { label: "GBK", value: "gbk" }, { label: "GB18030", value: "gb18030" }, { label: "UTF-16 LE", value: "utf-16le" }] }],
  },
  {
    nodeType: "io.read_text", runtimeSupport: ["python", "javascript"], label: "读取文本文件", category: "输入输出",
    description: "读取 TXT、DAT、日志或其他文本文件并输出字符串。", tags: ["读取", "txt", "dat", "文本"], pythonCallable: "pathlib.Path.read_text",
    defaults: { fileIndex: 0, encoding: "utf-8", encodingErrors: "strict" }, inputPorts: [], outputPorts: [{ id: "output", label: "文本", valueType: "text" }], parameters: [{ key: "fileIndex", label: "文件序号（从 0 开始）", kind: "number", min: 0, step: 1 }, { key: "encoding", label: "文件编码", kind: "select", options: [{ label: "UTF-8", value: "utf-8" }, { label: "GBK", value: "gbk" }, { label: "GB18030", value: "gb18030" }, { label: "UTF-16 LE", value: "utf-16le" }] }],
  },
  {
    nodeType: "io.read_json", runtimeSupport: ["python", "javascript"], label: "读取 JSON", category: "输入输出",
    description: "读取 JSON 文件并输出对象或列表；可继续连接“转为 DataFrame”。", tags: ["读取", "json", "对象", "列表"], pythonCallable: "json.load",
    defaults: { fileIndex: 0, encoding: "utf-8", encodingErrors: "strict" }, inputPorts: [], outputPorts: [{ id: "output", label: "对象", valueType: "object" }], parameters: [{ key: "fileIndex", label: "文件序号（从 0 开始）", kind: "number", min: 0, step: 1 }, { key: "encoding", label: "文件编码", kind: "select", options: [{ label: "UTF-8", value: "utf-8" }, { label: "GBK", value: "gbk" }, { label: "GB18030", value: "gb18030" }] }],
  },
  {
    nodeType: "io.read_image", runtimeSupport: ["python", "javascript"], label: "读取图片", category: "输入输出",
    description: "读取 PNG、JPG 等 Matplotlib 支持的图片并输出图像预览。", tags: ["读取", "png", "jpg", "jpeg", "图片"], pythonCallable: "matplotlib.pyplot.imread",
    defaults: { fileIndex: 0 }, inputPorts: [], outputPorts: [{ id: "output", label: "图像", valueType: "plot" }], parameters: [{ key: "fileIndex", label: "文件序号（从 0 开始）", kind: "number", min: 0, step: 1 }],
  },
  {
    nodeType: "generate.random_table", runtimeSupport: ["python", "javascript"], deterministic: true, cachePolicy: "cacheable",
    label: "生成随机数表",
    category: "输入输出",
    description: "无输入生成可复现的随机数表；相同 seed 在 Python 与 JavaScript 后端使用同一 portable-v1 随机算法并产生一致序列。",
    tags: ["生成", "随机", "random", "source", "数据源", "序列", "表格"],
    defaults: { count: 100, distribution: "uniform", min: 0, max: 1, mean: 0, std: 1, seed: 0, indexColumn: "index", valueColumn: "value" },
    inputPorts: [],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "count", label: "数量", kind: "number", min: 1, max: 1000000, step: 1, required: true },
      { key: "distribution", label: "分布", kind: "select", options: [{ label: "均匀分布", value: "uniform" }, { label: "正态分布", value: "normal" }, { label: "整数均匀分布", value: "integer" }] },
      { key: "min", label: "最小值", kind: "number", description: "均匀/整数分布下限。" },
      { key: "max", label: "最大值", kind: "number", description: "均匀分布上限；整数分布为包含上限。" },
      { key: "mean", label: "均值", kind: "number", description: "正态分布均值。", advanced: true },
      { key: "std", label: "标准差", kind: "number", min: 0, description: "正态分布标准差。", advanced: true },
      { key: "seed", label: "随机种子", kind: "number", step: 1, description: "相同种子可复现结果。" },
      { key: "indexColumn", label: "索引列名", kind: "text", required: true },
      { key: "valueColumn", label: "数值列名", kind: "text", required: true },
    ],
  },
  {
    nodeType: "generate.empty_table", runtimeSupport: ["python", "javascript"],
    label: "创建空 DataFrame",
    category: "输入输出",
    description: "创建一个无行 DataFrame，可预先指定列名。适合需要显式空表起点的流程；Python 与 JavaScript 后端均支持。",
    tags: ["生成", "空表", "DataFrame", "empty", "source", "初始化"],
    defaults: { columns: "" },
    inputPorts: [],
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "columns", label: "列名", kind: "list", itemType: "text", placeholder: "x,y,value" }],
  },
  {
    nodeType: "generate.empty_list", runtimeSupport: ["python", "javascript"],
    label: "创建空列表",
    category: "输入输出",
    description: "创建一个空列表作为流程数据源；Python 与 JavaScript 后端均支持。",
    tags: ["生成", "空列表", "list", "empty", "source", "初始化"],
    defaults: {},
    inputPorts: [],
    outputPorts: [{ id: "output", label: "列表", valueType: "list" }],
    parameters: [],
  },
  {
    nodeType: "ui.alert", runtimeSupport: ["python", "javascript"], executionModel: "ui", sideEffect: true, deterministic: false, cachePolicy: "uncacheable",
    label: "弹窗提示",
    category: "输入输出",
    description: "运行时显示可交互提示。确认、退出、取消按钮分别输出 true、false、None；按钮文字留空可隐藏。",
    tags: ["弹窗", "提示", "消息", "alert", "print"],
    defaults: { title: "提示", message: "流程正在执行。", confirmLabel: "确认", exitLabel: "退出", cancelLabel: "取消", response: null },
    parameters: [
      { key: "title", label: "标题", kind: "text", required: true },
      { key: "message", label: "内容", kind: "textarea", required: true },
      { key: "confirmLabel", label: "True 按钮", kind: "text", placeholder: "留空则隐藏" },
      { key: "exitLabel", label: "False 按钮", kind: "text", placeholder: "留空则隐藏" },
      { key: "cancelLabel", label: "None 按钮", kind: "text", placeholder: "留空则隐藏" },
    ],
    inputPorts: [{ id: "input", label: "触发", valueType: "any" }, { id: "content", label: "内容", valueType: "any" }], outputPorts: [{ id: "output", label: "选择", valueType: "any" }],
  },
  {
    nodeType: "ui.input_dialog", runtimeSupport: ["python", "javascript"], executionModel: "ui", sideEffect: true, deterministic: false, cachePolicy: "uncacheable",
    label: "弹窗输入",
    category: "输入输出",
    description: "运行前请求文本、数值或下拉选择；值作为输出传给后续节点。导出 Jupyter 时转换为 input 占位符。",
    tags: ["弹窗", "输入", "选择", "表单", "dialog"],
    defaults: { title: "输入", prompt: "请输入值", inputKind: "text", options: "", value: "" },
    parameters: [
      { key: "title", label: "标题", kind: "text", required: true }, { key: "prompt", label: "提示", kind: "text", required: true },
      { key: "inputKind", label: "输入类型", kind: "select", options: [{ label: "文本", value: "text" }, { label: "多行文本", value: "multiline" }, { label: "数值", value: "number" }, { label: "开关", value: "boolean" }, { label: "下拉选择", value: "select" }, { label: "日期", value: "date" }, { label: "时间", value: "time" }, { label: "日期时间", value: "datetime-local" }, { label: "JSON / 对象", value: "json" }, { label: "表格（CSV 或 JSON）", value: "table" }, { label: "图片 / 文件", value: "file" }] },
      { key: "options", label: "选择项", kind: "list", itemType: "text", placeholder: "A,B,C", description: "仅下拉选择时使用。" }, { key: "value", label: "默认/最近输入", kind: "text" },
    ],
    inputPorts: [], outputPorts: [{ id: "output", label: "值", valueType: "any" }],
  },
  {
    nodeType: "io.export_csv", runtimeSupport: ["python", "javascript"], sideEffect: true, cachePolicy: "uncacheable",
    label: "导出 CSV",
    category: "输入输出",
    defaults: { fileName: "result.csv" },
    inputPorts: TABLE_INPUT,
    outputPorts: [{ id: "output", label: "CSV", valueType: "csv" }],
    parameters: [{ key: "fileName", label: "文件名", kind: "text", required: true, placeholder: "result.csv", description: "导出时建议保留 .csv 扩展名。" }],
  },
  {
    nodeType: "table.concat", runtimeSupport: ["python", "javascript"],
    label: "合并双表",
    category: "表格处理",
    defaults: { axis: 0, ignoreIndex: true },
    inputPorts: [
      { id: "left", label: "表格 A", valueType: "table", required: true },
      { id: "right", label: "表格 B", valueType: "table", required: true },
    ],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      {
        key: "axis",
        label: "合并方向",
        kind: "select",
        options: [
          { label: "追加行", value: 0 },
          { label: "追加列", value: 1 },
        ],
      },
      { key: "ignoreIndex", label: "重新生成行序号", kind: "boolean" },
    ],
  },
  {
    nodeType: "table.concat_many", runtimeSupport: ["python", "javascript"],
    label: "批量横向合并",
    description: "将表格列表一次按列合并；可按文件元数据为列名加前缀。索引对齐使用 pandas 原始索引；位置对齐会先重置各表行索引。",
    tags: ["concat", "concat_many", "横向合并", "表格集合", "axis=1", "元数据"],
    category: "表格处理",
    defaults: { alignment: "index", prefixMode: "metadata", sourceColumn: "source_file", prefixColumn: "Vg_V", prefixTemplate: "{value}", prefixSeparator: "_" },
    inputPorts: [
      { id: "tables", label: "表格列表", valueType: "list", required: true },
      { id: "metadata", label: "文件元数据", valueType: "table" },
    ],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "alignment", label: "行对齐", kind: "select", options: [{ label: "按原始索引对齐（pandas）", value: "index" }, { label: "按行位置对齐", value: "position" }] },
      { key: "prefixMode", label: "列名前缀", kind: "select", options: [{ label: "使用元数据字段", value: "metadata" }, { label: "使用 source_file", value: "source_file" }, { label: "不加前缀", value: "none" }] },
      { key: "sourceColumn", label: "来源文件字段", kind: "text", placeholder: "source_file", description: "仅“使用 source_file”时生效，应与批量读取节点一致。" },
      { key: "prefixColumn", label: "前缀元数据字段", kind: "text", placeholder: "Vg_V", description: "仅“使用元数据字段”时生效。" },
      { key: "prefixTemplate", label: "前缀模板", kind: "text", placeholder: "{value}V", description: "{value} 表示选定字段；也可引用 {source_file} 等元数据列。" },
      { key: "prefixSeparator", label: "前缀分隔符", kind: "text", placeholder: "_" },
    ],
  },
  {
    nodeType: "table.select_columns", runtimeSupport: ["python", "javascript"],
    label: "选择列",
    category: "表格处理",
    defaults: { columns: "0,1" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "columns", label: "列序号", kind: "text", placeholder: "0,1,2", description: "使用英文逗号分隔；留空表示保留所有列。" }],
  },
  {
    nodeType: "table.absolute", runtimeSupport: ["python", "javascript"],
    label: "绝对值",
    category: "表格处理",
    defaults: {},
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [],
  },
  {
    nodeType: "table.transpose", runtimeSupport: ["python", "javascript"],
    label: "转置",
    category: "表格处理",
    defaults: {},
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [],
  },
  {
    nodeType: "table.slice", runtimeSupport: ["python", "javascript"],
    label: "行列切片",
    description: "按 iloc 语义选取连续或等步的行、列；行列序号均从 0 开始，可覆盖常见的实验数据抽样与隔列取样。",
    category: "表格处理",
    defaults: { rowStart: "", rowStop: "", rowStep: 1, columnStart: "", columnStop: "", columnStep: 1 },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "rowStart", label: "起始行（从 0 计）", kind: "text", placeholder: "留空为首行" },
      { key: "rowStop", label: "结束行（不包含）", kind: "text", placeholder: "留空至末尾" },
      { key: "rowStep", label: "行步长", kind: "number", min: 1, step: 1 },
      { key: "columnStart", label: "起始列（从 0 计）", kind: "text", placeholder: "留空为首列" },
      { key: "columnStop", label: "结束列（不包含）", kind: "text", placeholder: "留空至末列" },
      { key: "columnStep", label: "列步长", kind: "number", min: 1, step: 1 },
    ],
  },
  {
    nodeType: "table.reset_index", runtimeSupport: ["python", "javascript"],
    label: "重置行索引",
    description: "将行索引恢复为从零开始的连续编号。",
    category: "表格处理",
    defaults: { drop: true },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "drop", label: "丢弃旧索引列", kind: "boolean" }],
  },
  {
    nodeType: "table.periodic_window", runtimeSupport: ["python", "javascript"],
    label: "周期窗口抽取",
    description: "每隔固定行数提取一个连续窗口，适合脉冲、循环读写和 Set/Reset 分段数据。",
    category: "表格处理",
    defaults: { groupSize: 75, position: "start", offset: 0, count: 25 },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "groupSize", label: "周期行数", kind: "number", min: 1, step: 1 },
      { key: "position", label: "窗口位置", kind: "select", options: [{ label: "周期开始", value: "start" }, { label: "周期末尾", value: "end" }, { label: "自定义偏移", value: "offset" }] },
      { key: "offset", label: "自定义起点", kind: "number", min: 0, step: 1, advanced: true },
      { key: "count", label: "每周期保留行数", kind: "number", min: 1, step: 1 },
    ],
  },
  {
    nodeType: "table.periodic_tail_mean", runtimeSupport: ["python", "javascript"],
    label: "周期末段均值",
    description: "按零基行位置将数据切成固定周期 [k·groupSize, (k+1)·groupSize)，对每个周期最后 tailRows 行逐列取均值；不使用 +1 边界。末尾不完整周期可明确选择保留、丢弃或报错。",
    category: "统计",
    defaults: { groupSize: 25, tailRows: 10, partialGroup: "include" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "groupSize", label: "周期行数", kind: "number", min: 1, step: 1 },
      { key: "tailRows", label: "末段参与均值的行数", kind: "number", min: 1, step: 1 },
      { key: "partialGroup", label: "末尾不完整周期", kind: "select", options: [{ label: "保留并计算", value: "include" }, { label: "丢弃", value: "drop" }, { label: "报错", value: "error" }] },
    ],
  },
  {
    nodeType: "table.row_chunks_to_columns", runtimeSupport: ["python", "javascript"],
    label: "行分块横向拼接",
    description: "将表格沿行方向近似等分为 N 块，再按列横向拼接；对应 NumPy array_split(axis=0) + pandas.concat(axis=1) 的常见科研处理，并为每块列名追加序号以保持跨运行时列名唯一。",
    category: "表格处理",
    defaults: { chunks: 2 },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "chunks", label: "分块数量", kind: "number", min: 1, step: 1 }],
  },
  {
    nodeType: "stats.column_group_cv", runtimeSupport: ["python", "javascript"],
    label: "列分组逐行变异系数",
    description: "按固定列数分组，对每一组逐行计算总体标准差/均值（CV，ddof=0）；输出每组对应的 CV 数列。",
    category: "统计",
    defaults: { groupSize: 50 },
    inputPorts: TABLE_INPUT,
    outputPorts: [{ id: "output", label: "CV 分组列表", valueType: "list" }],
    parameters: [{ key: "groupSize", label: "每组列数", kind: "number", min: 1, step: 1 }],
  },
  {
    nodeType: "table.sort_index", runtimeSupport: ["python", "javascript"],
    label: "按索引排序",
    description: "按原始行索引或列索引进行稳定排序。",
    category: "表格处理",
    defaults: { axis: 0, ascending: true },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "axis", label: "排序轴", kind: "select", options: [{ label: "行索引", value: 0 }, { label: "列索引", value: 1 }] },
      { key: "ascending", label: "升序", kind: "boolean" },
    ],
  },
  {
    nodeType: "table.difference", runtimeSupport: ["python", "javascript"],
    label: "差分",
    category: "表格处理",
    defaults: { periods: 1, axis: 0 },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "periods", label: "差分阶数", kind: "number", min: 1, step: 1 },
      {
        key: "axis",
        label: "方向",
        kind: "select",
        options: [
          { label: "按行", value: 0 },
          { label: "按列", value: 1 },
        ],
      },
    ],
  },
  {
    nodeType: "table.filter_range", runtimeSupport: ["python", "javascript"],
    label: "范围筛选",
    category: "表格处理",
    defaults: { column: 0, min: "", max: "" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "column", label: "筛选列序号", kind: "number", min: 0, step: 1 },
      { key: "min", label: "最小值（可空）", kind: "text" },
      { key: "max", label: "最大值（可空）", kind: "text" },
    ],
  },
  {
    nodeType: "table.rename_columns", runtimeSupport: ["python", "javascript"],
    label: "重命名列",
    category: "表格处理",
    defaults: { names: "" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      {
        key: "names",
        label: "新列名",
        kind: "text",
        required: true,
        placeholder: "时间,电压,电流",
        description: "按顺序填写全部列名；也可输入 JSON 映射，例如 {\"0\":\"时间\"}。",
      },
    ],
  },
  {
    nodeType: "table.pivot", runtimeSupport: ["python", "javascript"],
    label: "透视矩阵",
    description: "将长表按行键、列键和值列转换为矩阵，适合多文件扫描结果和热图输入。",
    category: "表格处理",
    defaults: { index: "", columns: "", values: "", aggregate: "mean", resetIndex: true },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "index", label: "行键列", kind: "text", required: true, placeholder: "Vg_V" },
      { key: "columns", label: "列键列", kind: "text", required: true, placeholder: "Vds_V" },
      { key: "values", label: "数值列", kind: "text", required: true, placeholder: "TER_percent" },
      { key: "aggregate", label: "重复值聚合", kind: "select", options: [{ label: "平均值", value: "mean" }, { label: "首项", value: "first" }, { label: "最大值", value: "max" }, { label: "最小值", value: "min" }] },
      { key: "resetIndex", label: "将行键保留为首列", kind: "boolean" },
    ],
  },
  {
    nodeType: "table.group_aggregate", runtimeSupport: ["python", "javascript"],
    label: "分组聚合",
    category: "统计",
    defaults: { groupSize: 20, startRow: 0, endRow: 20, method: "mean" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "groupSize", label: "每组行数", kind: "number", min: 1, step: 1 },
      { key: "startRow", label: "组内起始行（从0）", kind: "number", min: 0, step: 1 },
      { key: "endRow", label: "组内结束行（不包含）", kind: "number", min: 1, step: 1 },
      {
        key: "method",
        label: "聚合方法",
        kind: "select",
        options: [
          { label: "平均值", value: "mean" },
          { label: "中位数", value: "median" },
          { label: "最小值", value: "min" },
          { label: "最大值", value: "max" },
          { label: "求和", value: "sum" },
        ],
      },
    ],
  },
  {
    nodeType: "table.groupby_aggregate", runtimeSupport: ["python", "javascript"],
    label: "按列分组聚合",
    description: "按指定列的值分组，对每组数值列求聚合（等价 pandas groupby(...).mean() 等）。",
    tags: ["pandas", "groupby", "分组", "聚合", "统计"],
    category: "统计",
    defaults: { groupBy: "", method: "mean" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "groupBy", label: "分组列", kind: "text", required: true, placeholder: "Vg_V", description: "列名或列序号，多个用英文逗号分隔。" },
      {
        key: "method",
        label: "聚合方法",
        kind: "select",
        options: [
          { label: "平均值", value: "mean" },
          { label: "中位数", value: "median" },
          { label: "求和", value: "sum" },
          { label: "最小值", value: "min" },
          { label: "最大值", value: "max" },
          { label: "标准差", value: "std" },
          { label: "计数", value: "count" },
        ],
      },
    ],
  },
  {
    nodeType: "pandas.dropna", runtimeSupport: ["python", "javascript"],
    label: "删除缺失值",
    description: "删除含缺失值的行。",
    tags: ["pandas", "dropna", "空值", "清洗"],
    category: "Pandas 常用",
    defaults: { how: "any", subset: "" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "how", label: "删除条件", kind: "select", options: [{ label: "任一列为空", value: "any" }, { label: "全部列为空", value: "all" }] },
      { key: "subset", label: "检查列", kind: "text", placeholder: "留空检查全部列", description: "列名或列序号，多个用英文逗号分隔。" },
    ],
  },
  {
    nodeType: "pandas.fillna", runtimeSupport: ["python", "javascript"],
    label: "填充缺失值",
    description: "使用固定值或相邻观测填充缺失值。",
    tags: ["pandas", "fillna", "空值", "清洗"],
    category: "Pandas 常用",
    defaults: { method: "value", value: "0" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "method", label: "填充方式", kind: "select", options: [{ label: "固定值", value: "value" }, { label: "向前填充", value: "forward" }, { label: "向后填充", value: "backward" }] },
      { key: "value", label: "填充值", kind: "text", description: "数字会自动转换；其他内容按文本填充。" },
    ],
  },
  {
    nodeType: "pandas.sort_values", runtimeSupport: ["python", "javascript"],
    label: "按列排序",
    description: "按照一个或多个列的值排序。",
    tags: ["pandas", "sort_values", "排序"],
    category: "Pandas 常用",
    defaults: { columns: "0", ascending: true, naPosition: "last" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "columns", label: "排序列", kind: "text", required: true, description: "列名或列序号，多个用英文逗号分隔。" },
      { key: "ascending", label: "升序", kind: "boolean" },
      { key: "naPosition", label: "空值位置", kind: "select", options: [{ label: "末尾", value: "last" }, { label: "开头", value: "first" }] },
    ],
  },
  {
    nodeType: "pandas.query", runtimeSupport: ["python", "javascript"],
    label: "表达式筛选",
    description: "使用 pandas 查询表达式筛选行。",
    tags: ["pandas", "query", "筛选", "条件"],
    category: "Pandas 常用",
    defaults: { expression: "" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "expression", label: "查询表达式", kind: "text", required: true, placeholder: "voltage > 2 and current < 5", description: "使用 pandas query 表达式；含空格的列名用反引号包围。" }],
  },
  {
    nodeType: "pandas.head", runtimeSupport: ["python", "javascript"],
    label: "前 N 行",
    description: "返回表格开头的 n 行。",
    tags: ["pandas", "head", "预览", "前几行"],
    docsUrl: "https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.head.html",
    pythonCallable: "pandas.DataFrame.head",
    category: "Pandas 常用",
    defaults: { n: 5 },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "n", label: "行数 · n", kind: "number", min: 0, step: 1, required: true }],
  },
  {
    nodeType: "pandas.tail", runtimeSupport: ["python", "javascript"],
    label: "后 N 行",
    description: "返回表格末尾的 n 行。",
    tags: ["pandas", "tail", "预览", "后几行"],
    docsUrl: "https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.tail.html",
    pythonCallable: "pandas.DataFrame.tail",
    category: "Pandas 常用",
    defaults: { n: 5 },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "n", label: "行数 · n", kind: "number", min: 0, step: 1, required: true }],
  },
  {
    nodeType: "pandas.drop_duplicates", runtimeSupport: ["python", "javascript"],
    label: "删除重复行",
    description: "删除重复行，可指定用于判断重复的列。",
    tags: ["pandas", "drop_duplicates", "重复", "去重", "清洗"],
    docsUrl: "https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.drop_duplicates.html",
    pythonCallable: "pandas.DataFrame.drop_duplicates",
    category: "Pandas 常用",
    defaults: { subset: "", keep: "first", ignoreIndex: true },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "subset", label: "判断列 · subset", kind: "list", itemType: "text", placeholder: "留空使用全部列" },
      { key: "keep", label: "保留项 · keep", kind: "select", options: [{ label: "第一项", value: "first" }, { label: "最后一项", value: "last" }, { label: "重复项全部删除", value: "false" }] },
      { key: "ignoreIndex", label: "重建行索引 · ignore_index", kind: "boolean" },
    ],
  },
  {
    nodeType: "pandas.sample", runtimeSupport: ["python", "javascript"],
    label: "随机抽样",
    description: "从表格随机抽取指定行数或比例。",
    tags: ["pandas", "sample", "随机", "抽样"],
    docsUrl: "https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.sample.html",
    pythonCallable: "pandas.DataFrame.sample",
    category: "Pandas 常用",
    defaults: { n: 5, fraction: "", replace: false, randomState: 0, ignoreIndex: true },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "n", label: "行数 · n", kind: "number", min: 0, step: 1 },
      { key: "fraction", label: "比例 · frac", kind: "text", placeholder: "填写比例时忽略 n" },
      { key: "replace", label: "允许重复抽样 · replace", kind: "boolean" },
      { key: "randomState", label: "随机种子 · random_state", kind: "number", step: 1 },
      { key: "ignoreIndex", label: "重建行索引 · ignore_index", kind: "boolean" },
    ],
  },
  {
    nodeType: "pandas.round", runtimeSupport: ["python", "javascript"],
    label: "数值取整",
    description: "将数值列舍入到指定小数位。",
    tags: ["pandas", "round", "取整", "小数"],
    docsUrl: "https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.round.html",
    pythonCallable: "pandas.DataFrame.round",
    category: "Pandas 常用",
    defaults: { decimals: 2 },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "decimals", label: "小数位 · decimals", kind: "number", min: 0, max: 15, step: 1 }],
  },
  {
    nodeType: "pandas.describe", runtimeSupport: ["python", "javascript"],
    label: "描述性统计",
    description: "生成计数、均值、标准差、分位数等描述性统计。",
    tags: ["pandas", "describe", "统计", "摘要"],
    docsUrl: "https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.describe.html",
    pythonCallable: "pandas.DataFrame.describe",
    category: "统计",
    defaults: { percentiles: "0.25,0.5,0.75", include: "", exclude: "" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "percentiles", label: "分位数 · percentiles", kind: "list", itemType: "number" },
      { key: "include", label: "包含类型 · include", kind: "text", placeholder: "留空仅数值；all 表示全部" },
      { key: "exclude", label: "排除类型 · exclude", kind: "text" },
    ],
  },
  {
    nodeType: "logic.if_value", runtimeSupport: ["python", "javascript"], executionModel: "control-flow",
    label: "If 条件结构",
    description: "通用条件结构。condition 决定只执行 True 或 False 分支；input 作为分支的数据上下文，可承载任意值。",
    tags: ["logic", "if", "条件", "结构", "任意类型", "通用"],
    category: "逻辑控制",
    defaults: { invert: false },
    inputPorts: [
      { id: "condition", label: "条件", valueType: "any", required: true },
      { id: "input", label: "上下文", valueType: "any", required: false },
    ],
    outputPorts: [
      { id: "done", label: "完成", valueType: "any" },
      { id: "true", label: "True", valueType: "any" },
      { id: "false", label: "False", valueType: "any" },
    ],
    parameters: [{ key: "invert", label: "条件取反", kind: "boolean" }],
  },
  {
    nodeType: "logic.for_each_value", runtimeSupport: ["python", "javascript"], executionModel: "control-flow",
    label: "For Each 结构",
    description: "遍历列表、元组、文本、对象或表格等输入；循环体每次接收一个元素，结果统一按顺序收集为列表。",
    tags: ["logic", "for", "foreach", "循环", "迭代", "任意类型", "通用"],
    category: "逻辑控制",
    defaults: { maxIterations: 10000 },
    inputPorts: [{ id: "input", label: "可迭代值", valueType: "any", required: true }],
    outputPorts: [
      { id: "done", label: "结果列表", valueType: "list" },
      { id: "last", label: "最后结果", valueType: "any" },
      { id: "lastItem", label: "最后迭代项", valueType: "any" },
    ],
    parameters: [
      { key: "maxIterations", label: "最大迭代次数", kind: "number", min: 1, max: 100000, step: 1 },
    ],
  },
  {
    nodeType: "logic.while_state", runtimeSupport: ["python", "javascript"], executionModel: "control-flow",
    label: "While 状态结构",
    description: "以任意值作为循环状态，条件成立时执行循环体并以循环体结果作为下一轮状态。",
    tags: ["logic", "while", "循环", "状态", "反馈", "通用"],
    category: "逻辑控制",
    defaults: { conditionMode: "expression", condition: "value < 10", maxIterations: 100 },
    inputPorts: [{ id: "input", label: "初始状态", valueType: "any", required: true }],
    outputPorts: [
      { id: "done", label: "最终状态", valueType: "any" },
      { id: "iterations", label: "迭代次数", valueType: "number" },
    ],
    parameters: [
      { key: "conditionMode", label: "继续条件模式", kind: "select", options: [{ label: "表达式", value: "expression" }, { label: "状态为真", value: "truthy" }, { label: "状态非空", value: "notEmpty" }] },
      { key: "condition", label: "继续条件", kind: "text", required: true, placeholder: "value < 10", description: "表达式模式支持 value、iteration、数值运算、比较和 and/or/not。" },
      { key: "maxIterations", label: "最大迭代次数", kind: "number", min: 1, max: 10000, step: 1 },
    ],
  },
  {
    nodeType: "table.split_condition", runtimeSupport: ["python", "javascript"],
    label: "按条件拆分表格",
    description: "按行条件把输入表格拆成匹配与未匹配两路；这是表格数据处理，不是控制流 If。",
    category: "表格处理",
    defaults: { condition: "" },
    inputPorts: TABLE_INPUT,
    outputPorts: [
      { id: "true", label: "匹配", valueType: "table" },
      { id: "false", label: "未匹配", valueType: "table" },
    ],
    parameters: [{ key: "condition", label: "判断条件", kind: "text", required: true, placeholder: "voltage >= 3", description: "按行求值，并从两个端口输出成立与不成立的数据。" }],
  },
  {
    nodeType: "analysis.ter_matrix", runtimeSupport: ["python", "javascript"],
    label: "计算 TER 矩阵",
    description: "按 Vg 分组识别 Vds 升降扫描，计算电阻和 TER 长表。",
    tags: ["TER", "Vg", "Vds", "扫描", "电阻", "矩阵"],
    category: "统计",
    defaults: { vgColumn: "Vg_V", voltageColumn: "0", currentColumn: "1", sourceColumn: "source_file", vmin: 0, vmax: 0, vstep: 0, tolerance: 0, currentFloor: 1e-15, mode: "high-low" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "vgColumn", label: "Vg 列", kind: "text", required: true },
      { key: "voltageColumn", label: "Vds 列", kind: "text", required: true, description: "列名或列序号。" },
      { key: "currentColumn", label: "电流列", kind: "text", required: true, description: "列名或列序号。" },
      { key: "sourceColumn", label: "来源文件列", kind: "text" },
      { key: "mode", label: "TER 计算方式", kind: "select", options: [{ label: "高低阻差 / 低阻", value: "high-low" }, { label: "降压减升压", value: "down-minus-up" }, { label: "升压减降压", value: "up-minus-down" }] },
      { key: "vmin", label: "最小 Vds（0 自动）", kind: "number" },
      { key: "vmax", label: "最大 Vds（0 自动）", kind: "number" },
      { key: "vstep", label: "Vds 步长（0 自动）", kind: "number", min: 0 },
      { key: "tolerance", label: "配对容差（0 自动）", kind: "number", min: 0 },
      { key: "currentFloor", label: "最小有效电流", kind: "number", min: 0, step: 1e-15 },
    ],
  },
  {
    nodeType: "analysis.linear_fit", runtimeSupport: ["python"],
    label: "线性拟合",
    description: "对两列做最小二乘线性回归（scipy.stats.linregress），输出斜率、截距、相关系数等。",
    tags: ["拟合", "线性", "linregress", "回归", "斜率", "scipy"],
    category: "统计",
    defaults: { xColumn: "", yColumn: "" },
    inputPorts: TABLE_INPUT,
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "xColumn", label: "X 列", kind: "text", required: true, description: "列名或列序号。" },
      { key: "yColumn", label: "Y 列", kind: "text", required: true, description: "列名或列序号。" },
    ],
  },
  {
    nodeType: "pulse.generate_waveform", runtimeSupport: ["python", "javascript"],
    label: "生成脉冲波形",
    description: "以读出-写入交替序列生成可复现的电压时间表；可分别用于 Vd、Vs、Vg 后再合并。",
    tags: ["pulse", "脉冲", "波形", "电压", "Vd", "Vs", "Vg"],
    category: "统计",
    defaults: { voltageMax: 3, voltageStep: 0.2, readVoltage: 0.1, pulseTime: 0.01, readTime: 0.01, timeShift: 0, cycles: 1, ratio: 1 },
    inputPorts: [], outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "voltageMax", label: "最大脉冲电压 · Vmax", kind: "number", required: true, step: 0.1 },
      { key: "voltageStep", label: "脉冲电压步长 · Vstep", kind: "number", required: true, min: 0.0000001, step: 0.1 },
      { key: "readVoltage", label: "读出电压 · Vread", kind: "number", step: 0.1 },
      { key: "pulseTime", label: "写入脉冲时长（s）", kind: "number", required: true, min: 0, step: 0.001 },
      { key: "readTime", label: "读出时长（s）", kind: "number", required: true, min: 0, step: 0.001 },
      { key: "timeShift", label: "起始时间偏移（s）", kind: "number", step: 0.001 },
      { key: "cycles", label: "扫描周期", kind: "select", options: [{ label: "1/4 周期", value: 0.25 }, { label: "1/2 周期", value: 0.5 }, { label: "1 周期", value: 1 }, { label: "2 周期", value: 2 }, { label: "3 周期", value: 3 }] },
      { key: "ratio", label: "通道电压倍率", kind: "number", step: 0.1, description: "同一主波形映射到不同通道时使用；-1 可生成反相波形。" },
    ],
  },
  {
    nodeType: "pulse.generate_oscillating_ramp", runtimeSupport: ["python", "javascript"],
    label: "生成周期震荡脉冲",
    description: "生成读出电压与正负交替、逐级增幅的三端口周期脉冲表。",
    tags: ["pulse", "脉冲", "震荡", "周期", "三端口"],
    category: "统计",
    defaults: { interval: 0.005, totalTime: 10, amplitudeStep: 0.2, fixedVoltage: 0.6, gateVoltage: 0 },
    inputPorts: [], outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "interval", label: "时间间隔（s）", kind: "number", required: true, min: 0.000001, step: 0.001 },
      { key: "totalTime", label: "总时间（s）", kind: "number", required: true, min: 0.000001, step: 0.1 },
      { key: "amplitudeStep", label: "震荡增幅（V）", kind: "number", required: true, min: 0.000001, step: 0.1 },
      { key: "fixedVoltage", label: "读出端固定电压（V）", kind: "number", step: 0.1 },
      { key: "gateVoltage", label: "第三端固定电压（V）", kind: "number", step: 0.1 },
    ],
  },
  {
    nodeType: "pulse.combine_channels", runtimeSupport: ["python", "javascript"],
    label: "合并 Vd / Vs / Vg 波形",
    description: "按时间并集对齐三个脉冲通道，并以前一个有效值保持各通道电压。",
    tags: ["pulse", "脉冲", "波形", "Vd", "Vs", "Vg", "合并"],
    category: "表格处理",
    defaults: { timeColumn: "time_s", voltageColumn: "voltage_V" },
    inputPorts: [{ id: "drain", label: "Vd 波形", valueType: "table" }, { id: "source", label: "Vs 波形", valueType: "table" }, { id: "gate", label: "Vg 波形", valueType: "table" }], outputPorts: TABLE_OUTPUT,
    parameters: [{ key: "timeColumn", label: "时间列", kind: "text", required: true }, { key: "voltageColumn", label: "电压列", kind: "text", required: true }],
  },
  {
    nodeType: "pulse.segment_measurement", runtimeSupport: ["python", "javascript"],
    label: "脉冲测量分段平均",
    description: "按波形时间边界切分连续电流记录，剔除每段前后样本后计算平均值。",
    tags: ["pulse", "脉冲", "测量", "平均", "电流", "Data_pick"],
    category: "统计",
    defaults: { measurementTimeColumn: "time", currentColumn: "current", waveformTimeColumn: "time_s", waveformVoltageColumn: "voltage_V", dropLeadingRows: 0, dropTrailingRows: 0 },
    inputPorts: [{ id: "measurement", label: "测量数据", valueType: "table", required: true }, { id: "waveform", label: "脉冲波形", valueType: "table", required: true }], outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "measurementTimeColumn", label: "测量时间列", kind: "text", required: true },
      { key: "currentColumn", label: "电流列", kind: "text", required: true },
      { key: "waveformTimeColumn", label: "波形时间列", kind: "text", required: true },
      { key: "waveformVoltageColumn", label: "波形电压列", kind: "text", required: true },
      { key: "dropLeadingRows", label: "每段舍弃前样本数", kind: "number", min: 0, step: 1 },
      { key: "dropTrailingRows", label: "每段舍弃后样本数", kind: "number", min: 0, step: 1 },
    ],
  },
  {
    nodeType: "table.merge_rows", runtimeSupport: ["python", "javascript"],
    label: "合并表格行",
    description: "将两路表格按行合并，并可恢复原行顺序；这是表格数据处理，不是控制流合流结构。",
    tags: ["table", "merge", "concat", "合并", "行"],
    category: "表格处理",
    defaults: { ignoreIndex: true, sortIndex: false },
    inputPorts: [
      { id: "left", label: "分支 A", valueType: "table", required: true },
      { id: "right", label: "分支 B", valueType: "table", required: true },
    ],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "ignoreIndex", label: "重建行索引", kind: "boolean" },
      { key: "sortIndex", label: "按原索引排序", kind: "boolean", description: "仅在不重建索引时生效。" },
    ],
  },
  {
    nodeType: "logic.for_range", runtimeSupport: ["python", "javascript"],
    label: "For 数值循环",
    description: "按 Python range 语义生成迭代次数和值，适合参数扫描和动态绘图。",
    tags: ["logic", "for", "range", "循环", "参数扫描"],
    category: "逻辑控制",
    defaults: { start: 0, stop: 10, step: 1 },
    inputPorts: [],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      { key: "start", label: "起始值 · start", kind: "number", step: 1 },
      { key: "stop", label: "结束值 · stop（不包含）", kind: "number", step: 1 },
      { key: "step", label: "步长 · step", kind: "number", step: 1 },
    ],
  },
  {
    nodeType: "logic.while_number", runtimeSupport: ["python", "javascript"],
    label: "While 数值循环",
    description: "在安全表达式成立时重复更新数值，并输出完整迭代轨迹。",
    tags: ["logic", "while", "循环", "迭代", "数值"],
    category: "逻辑控制",
    defaults: { start: 0, condition: "value < 10", update: "value + 1", maxIterations: 100 },
    inputPorts: [],
    outputPorts: [
      { id: "output", label: "迭代轨迹", valueType: "table" },
      { id: "last", label: "最终值", valueType: "number" },
      { id: "iterations", label: "迭代次数", valueType: "number" },
    ],
    parameters: [
      { key: "start", label: "初始值 · value", kind: "number" },
      { key: "condition", label: "继续条件", kind: "text", required: true, placeholder: "value < 10", description: "可使用 value、iteration、算术和比较运算。" },
      { key: "update", label: "更新表达式", kind: "text", required: true, placeholder: "value + 1" },
      { key: "maxIterations", label: "最大迭代次数", kind: "number", min: 1, max: 10000, step: 1, description: "防止条件错误造成无限循环。" },
    ],
  },
  {
    nodeType: "variable.set", runtimeSupport: ["python", "javascript"], stateScope: "temporary", stateAccess: "write", sideEffect: true, deterministic: false, cachePolicy: "uncacheable",
    label: "设置变量",
    description: "将输入值保存到命名变量并原样透传；配合“读取变量”在工作流中跨节点共享数据。",
    tags: ["变量", "variable", "set", "赋值", "共享"],
    category: "逻辑控制",
    defaults: { name: "" },
    inputPorts: [{ id: "input", label: "输入值", valueType: "any", required: true }],
    outputPorts: [{ id: "output", label: "原值", valueType: "any" }],
    parameters: [{ key: "name", label: "变量名", kind: "text", required: true, placeholder: "my_var", description: "变量在工作流执行期间有效；同名变量会被后执行的设置节点覆盖。" }],
  },
  {
    nodeType: "variable.get", runtimeSupport: ["python", "javascript"], stateScope: "temporary", stateAccess: "read", deterministic: false, cachePolicy: "uncacheable",
    label: "读取变量",
    description: "读取命名变量的值；变量由“设置变量”节点在本次执行中写入。",
    tags: ["变量", "variable", "get", "读取", "共享"],
    category: "逻辑控制",
    defaults: { name: "" },
    inputPorts: [{ id: "previous", label: "顺序（可选）", valueType: "any", required: false }],
    outputPorts: [{ id: "output", label: "变量值", valueType: "any" }],
    parameters: [{ key: "name", label: "变量名", kind: "text", required: true, placeholder: "my_var", description: "建议从设置变量节点连一条线到“顺序”端口，确保读取发生在设置之后；否则可能因执行顺序早于设置而报错。" }],
  },
  {
    nodeType: "variable.set_workspace", runtimeSupport: ["python", "javascript"], stateScope: "global", stateAccess: "write", sideEffect: true, deterministic: false, cachePolicy: "uncacheable",
    label: "设置工作区变量",
    description: "将输入值保存到当前工作区会话；后续运行仍可读取，但不会跨标签页、客户端或进程共享。",
    tags: ["变量", "variable", "workspace", "持久", "状态"],
    category: "逻辑控制",
    defaults: { name: "" },
    inputPorts: [{ id: "input", label: "输入值", valueType: "any", required: true }],
    outputPorts: [{ id: "output", label: "原值", valueType: "any" }],
    parameters: [{ key: "name", label: "变量名", kind: "text", required: true, placeholder: "workspace_value", description: "状态仅保留在当前工作区会话；关闭/重新载入工作区后重置。" }],
  },
  {
    nodeType: "variable.get_workspace", runtimeSupport: ["python", "javascript"], stateScope: "global", stateAccess: "read", deterministic: false, cachePolicy: "uncacheable",
    label: "读取工作区变量",
    description: "读取当前工作区会话在本次或此前运行中保存的命名值。",
    tags: ["变量", "variable", "workspace", "读取", "状态"],
    category: "逻辑控制",
    defaults: { name: "" },
    inputPorts: [{ id: "previous", label: "顺序（可选）", valueType: "any", required: false }],
    outputPorts: [{ id: "output", label: "变量值", valueType: "any" }],
    parameters: [{ key: "name", label: "变量名", kind: "text", required: true, placeholder: "workspace_value", description: "工作区变量不会跨标签页或 Remote Web 客户端共享。" }],
  },
  {
    nodeType: "plot.line", runtimeSupport: ["python", "javascript"],
    label: "折线图",
    category: "绘图",
    defaults: {
      xColumn: "0",
      yColumns: "1",
      title: "",
      xLabel: "",
      yLabel: "",
      legend: true,
      grid: true,
      logX: false,
      logY: false,
      scientificNotation: true,
      lineStyle: "-",
      marker: "",
      lineWidth: 1.5,
      figureWidth: 8,
      figureHeight: 4.5,
      dpi: 120,
    },
    inputPorts: TABLE_INPUT,
    outputPorts: [{ id: "output", label: "图像", valueType: "plot" }],
    parameters: [
      { key: "xColumn", label: "X 列", kind: "text", placeholder: "留空使用行号", description: "填写列名或列序号。" },
      { key: "yColumns", label: "Y 列", kind: "text", placeholder: "留空绘制全部", description: "多个列名或序号用英文逗号分隔。" },
      { key: "title", label: "图表标题", kind: "text" },
      { key: "xLabel", label: "X 轴标签", kind: "text" },
      { key: "yLabel", label: "Y 轴标签", kind: "text" },
      { key: "legend", label: "显示图例", kind: "boolean", rememberDefault: true },
      { key: "grid", label: "显示网格", kind: "boolean", rememberDefault: true },
      { key: "logX", label: "X 轴对数", kind: "boolean" },
      { key: "logY", label: "Y 轴对数", kind: "boolean" },
      { key: "scientificNotation", label: "科学计数法", kind: "boolean", rememberDefault: true, description: "数值轴在过大或过小时自动使用科学计数法。" },
      {
        key: "lineStyle", label: "线型", kind: "select", rememberDefault: true, options: [
          { label: "实线", value: "-" }, { label: "虚线", value: "--" },
          { label: "点划线", value: "-." }, { label: "点线", value: ":" },
        ],
      },
      {
        key: "marker", label: "数据点", kind: "select", rememberDefault: true, options: [
          { label: "无", value: "" }, { label: "圆形", value: "o" },
          { label: "方形", value: "s" }, { label: "三角形", value: "^" }, { label: "点", value: "." },
        ],
      },
      { key: "lineWidth", label: "线宽", kind: "number", min: 0.5, max: 5, step: 0.5, control: "slider", rememberDefault: true },
      { key: "figureWidth", label: "图片宽度", kind: "number", min: 4, max: 16, step: 0.5, control: "slider", rememberDefault: true },
      { key: "figureHeight", label: "图片高度", kind: "number", min: 3, max: 12, step: 0.5, control: "slider", rememberDefault: true },
      { key: "dpi", label: "清晰度 DPI", kind: "number", min: 72, max: 240, step: 12, control: "slider", rememberDefault: true },
    ],
  },
  ...([{"nodeType":"plot.scatter","label":"散点图","description":"按 X/Y 数值列绘制散点关系。"},{"nodeType":"plot.bar","label":"柱状图","description":"按分类或数值 X 轴绘制柱状比较。"},{"nodeType":"plot.histogram","label":"直方图","description":"显示一个或多个数值列的分布。"},{"nodeType":"plot.box","label":"箱线图","description":"比较数值列的中位数、四分位数与异常值。"},{"nodeType":"plot.area","label":"面积图","description":"绘制随 X 轴变化的堆叠或重叠面积。"}] as const).map((item): NodeSpec => ({
    ...item, runtimeSupport: ["python", "javascript"], category: "绘图", tags: ["plot", "绘图", item.label],
    defaults: { xColumn: "", yColumns: "", title: "", xLabel: "", yLabel: "", legend: true, grid: true, scientificNotation: true, bins: 20, pointSize: 24, alpha: .8, figureWidth: 8, figureHeight: 4.5, dpi: 120 },
    inputPorts: TABLE_INPUT, outputPorts: [{ id: "output", label: "图像", valueType: "plot" }],
    parameters: [
      { key: "xColumn", label: "X 列", kind: "text", placeholder: item.nodeType === "plot.scatter" ? "散点图必填" : "留空使用行号" },
      { key: "yColumns", label: "Y 列", kind: "list", itemType: "text", placeholder: item.nodeType === "plot.scatter" ? "散点图仅填写一列" : "留空使用全部数值列" },
      { key: "title", label: "图表标题", kind: "text" }, { key: "xLabel", label: "X 轴标签", kind: "text" }, { key: "yLabel", label: "Y 轴标签", kind: "text" },
      ...(item.nodeType === "plot.histogram" ? [{ key: "bins", label: "分箱数量", kind: "number", min: 1, max: 500, step: 1 } as ParameterSpec] : []),
      ...(item.nodeType === "plot.scatter" ? [{ key: "pointSize", label: "点大小", kind: "number", min: 1, max: 300, step: 1 } as ParameterSpec] : []),
      { key: "alpha", label: "透明度", kind: "number", min: 0.05, max: 1, step: 0.05, control: "slider" }, { key: "legend", label: "显示图例", kind: "boolean" }, { key: "grid", label: "显示网格", kind: "boolean" }, { key: "scientificNotation", label: "科学计数法", kind: "boolean", rememberDefault: true, description: "数值轴在过大或过小时自动使用科学计数法。" },
      { key: "figureWidth", label: "图片宽度", kind: "number", min: 4, max: 16, step: .5 }, { key: "figureHeight", label: "图片高度", kind: "number", min: 3, max: 12, step: .5 }, { key: "dpi", label: "清晰度 DPI", kind: "number", min: 72, max: 300, step: 12 },
    ],
  })),
  {
    nodeType: "plot.heatmap", runtimeSupport: ["python", "javascript"],
    label: "矩阵热图",
    description: "将二维数值表绘制为带颜色条的矩阵热图。",
    tags: ["plot", "heatmap", "matrix", "热图", "矩阵"],
    category: "绘图",
    defaults: {
      rowLabelColumn: "0", title: "矩阵热图", xLabel: "列", yLabel: "行",
      xTickInterval: 1, yTickInterval: 1, xTickRotation: 45,
      origin: "lower", aspect: "auto", interpolation: "nearest",
      colorMap: "viridis", colorMin: null, colorMax: null, showColorBar: true,
      colorBarLabel: "", figureWidth: 9, figureHeight: 6, dpi: 160,
    },
    inputPorts: TABLE_INPUT,
    outputPorts: [{ id: "output", label: "图像", valueType: "plot" }],
    parameters: [
      { key: "rowLabelColumn", label: "行标签列", kind: "text", placeholder: "0 或 Vg_V", description: "留空则使用默认行号。" },
      { key: "title", label: "图表标题", kind: "text" },
      { key: "xLabel", label: "X 轴标签", kind: "text" },
      { key: "yLabel", label: "Y 轴标签", kind: "text" },
      { key: "xTickInterval", label: "X 轴刻度间隔（列）", kind: "number", min: 1, max: 1000, step: 1, description: "1 表示显示每一列；2 表示每隔一列显示一个标签。" },
      { key: "yTickInterval", label: "Y 轴刻度间隔（行）", kind: "number", min: 1, max: 1000, step: 1, description: "控制行标签的显示密度，大矩阵建议增大。" },
      { key: "xTickRotation", label: "X 标签旋转角度", kind: "number", min: 0, max: 90, step: 5, control: "slider", rememberDefault: true },
      { key: "origin", label: "坐标原点", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "左下", value: "lower" }, { label: "左上", value: "upper" }] },
      { key: "aspect", label: "单元格纵横比", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "自动填充", value: "auto" }, { label: "等宽等高", value: "equal" }] },
      { key: "interpolation", label: "插值方式", kind: "select", advanced: true, rememberDefault: true, options: [{ label: "最近邻（清晰格子）", value: "nearest" }, { label: "不插值", value: "none" }, { label: "双线性（平滑）", value: "bilinear" }, { label: "双三次（更平滑）", value: "bicubic" }] },
      { key: "colorMin", label: "颜色下限", kind: "number", advanced: true, placeholder: "留空自动" },
      { key: "colorMax", label: "颜色上限", kind: "number", advanced: true, placeholder: "留空自动" },
      { key: "showColorBar", label: "显示颜色条", kind: "boolean", advanced: true, rememberDefault: true },
      { key: "colorBarLabel", label: "颜色条标签", kind: "text" },
      { key: "colorMap", label: "配色", kind: "select", rememberDefault: true, options: [{ label: "Viridis", value: "viridis" }, { label: "冷暖", value: "coolwarm" }, { label: "等离子", value: "plasma" }, { label: "蓝红", value: "RdBu_r" }] },
      { key: "figureWidth", label: "图片宽度", kind: "number", min: 4, max: 16, step: 0.5, control: "slider", rememberDefault: true },
      { key: "figureHeight", label: "图片高度", kind: "number", min: 3, max: 12, step: 0.5, control: "slider", rememberDefault: true },
      { key: "dpi", label: "清晰度 DPI", kind: "number", min: 72, max: 300, step: 12, control: "slider", rememberDefault: true },
    ],
  },
  {
    nodeType: "convert.to_text", runtimeSupport: ["python", "javascript"],
    label: "转为文本",
    description: "将表格、列表、字典、数字、布尔值等转换为可读文本。",
    tags: ["转换", "文本", "string", "str"], pythonCallable: "str", category: "Python 内置", defaults: { pretty: true },
    inputPorts: [{ id: "input", label: "任意值", valueType: "any", required: true }], outputPorts: [{ id: "output", label: "文本", valueType: "text" }],
    parameters: [{ key: "pretty", label: "格式化结构", kind: "boolean" }],
  },
  {
    nodeType: "convert.to_number", runtimeSupport: ["python", "javascript"], label: "转为数字", description: "将单值、单单元格表格或数字文本转换为数字。", tags: ["转换", "数字", "float", "int"], pythonCallable: "float", category: "Python 内置", defaults: { integer: false },
    inputPorts: [{ id: "input", label: "输入", valueType: "any", required: true }], outputPorts: [{ id: "output", label: "数字", valueType: "number" }], parameters: [{ key: "integer", label: "转换为整数", kind: "boolean" }],
  },
  {
    nodeType: "convert.to_boolean", runtimeSupport: ["python", "javascript"], label: "转为布尔值", description: "按常见 true/false、是/否、1/0 规则转换为布尔值。", tags: ["转换", "布尔", "bool"], pythonCallable: "bool", category: "Python 内置", defaults: {},
    inputPorts: [{ id: "input", label: "输入", valueType: "any", required: true }], outputPorts: [{ id: "output", label: "布尔", valueType: "boolean" }], parameters: [],
  },
  {
    nodeType: "convert.to_table", runtimeSupport: ["python", "javascript"], label: "列表 / 对象转 DataFrame", description: "将 Python list、记录列表、字典、Series、NumPy 数组、标量或 CSV 文本规范化为 pandas DataFrame。", tags: ["转换", "DataFrame", "表格", "列表", "list", "字典"], pythonCallable: "pandas.DataFrame", category: "Python 内置", defaults: { csvText: false },
    inputPorts: [{ id: "input", label: "输入", valueType: "any", required: true }], outputPorts: TABLE_OUTPUT, parameters: [{ key: "csvText", label: "按 CSV 文本解析", kind: "boolean" }],
  },
  {
    nodeType: "convert.table_to_records", runtimeSupport: ["python", "javascript"], label: "表格转记录列表", description: "将 DataFrame 转换为由字典组成的记录列表。", tags: ["转换", "records", "list", "dict"], pythonCallable: "pandas.DataFrame.to_dict", category: "Python 内置", defaults: {},
    inputPorts: TABLE_INPUT, outputPorts: [{ id: "output", label: "记录列表", valueType: "list" }], parameters: [],
  },
  {
    nodeType: "sequence.map_expression", runtimeSupport: ["python", "javascript"],
    label: "列表映射",
    description: "对数字列表逐项执行受控表达式。表达式可使用 value 和 iteration，例如 value * 2 + iteration。",
    tags: ["列表", "映射", "map", "sequence"], category: "列表处理", defaults: { expression: "value" },
    inputPorts: [{ id: "input", label: "数字列表", valueType: "list", required: true }],
    outputPorts: [{ id: "output", label: "映射结果", valueType: "list" }],
    parameters: [{ key: "expression", label: "映射表达式", kind: "text" }],
  },
  {
    nodeType: "sequence.reduce", runtimeSupport: ["python", "javascript"],
    label: "列表归约",
    description: "将数字列表归约为单值，支持求和、平均、最小、最大、乘积和计数。",
    tags: ["列表", "归约", "reduce", "sum", "mean"], category: "列表处理", defaults: { method: "sum" },
    inputPorts: [{ id: "input", label: "数字列表", valueType: "list", required: true }],
    outputPorts: [{ id: "output", label: "结果", valueType: "number" }],
    parameters: [{ key: "method", label: "归约方式", kind: "select", options: [{ label: "求和", value: "sum" }, { label: "平均", value: "mean" }, { label: "最小", value: "min" }, { label: "最大", value: "max" }, { label: "乘积", value: "product" }, { label: "计数", value: "count" }] }],
  },
  {
    nodeType: "sequence.accumulate", runtimeSupport: ["python", "javascript"],
    label: "列表累计",
    description: "返回逐项累计结果，可用于累加、累乘、运行最小值或运行最大值。",
    tags: ["列表", "累计", "accumulate", "scan", "running"], category: "列表处理", defaults: { method: "sum" },
    inputPorts: [{ id: "input", label: "数字列表", valueType: "list", required: true }],
    outputPorts: [{ id: "output", label: "累计列表", valueType: "list" }, { id: "last", label: "最终累计值", valueType: "number" }],
    parameters: [{ key: "method", label: "累计方式", kind: "select", options: [{ label: "累加", value: "sum" }, { label: "累乘", value: "product" }, { label: "运行最小值", value: "min" }, { label: "运行最大值", value: "max" }] }],
  },
  {
    nodeType: "sequence.consecutive_segments", runtimeSupport: ["python", "javascript"],
    label: "连续整数区间",
    description: "对整数列表排序去重后提取连续区间，输出 [起点, 终点, 长度] 列表。",
    tags: ["列表", "连续区间", "segment", "sequence"], category: "列表处理", defaults: {},
    inputPorts: [{ id: "input", label: "整数列表", valueType: "list", required: true }],
    outputPorts: [{ id: "output", label: "连续区间", valueType: "list" }], parameters: [],
  },
  {
    nodeType: "sequence.filter_short_segments", runtimeSupport: ["python", "javascript"],
    label: "过滤短连续区间",
    description: "对整数列表排序去重，将长度小于阈值的连续区间删除，并返回保留下来的整数。",
    tags: ["列表", "连续区间", "过滤", "segment", "sequence"], category: "列表处理", defaults: { minLength: 3 },
    inputPorts: [{ id: "input", label: "整数列表", valueType: "list", required: true }],
    outputPorts: [{ id: "output", label: "过滤后列表", valueType: "list" }],
    parameters: [{ key: "minLength", label: "最短区间长度", kind: "number", min: 1, step: 1 }],
  },
  {
    nodeType: "convert.table_to_csv", runtimeSupport: ["python", "javascript"], label: "表格转 CSV 文本", description: "将 DataFrame 转换为 CSV 字符串，不写入文件。", tags: ["转换", "csv", "文本"], pythonCallable: "pandas.DataFrame.to_csv", category: "Python 内置", defaults: { includeIndex: false },
    inputPorts: TABLE_INPUT, outputPorts: [{ id: "output", label: "CSV", valueType: "csv" }], parameters: [{ key: "includeIndex", label: "包含索引", kind: "boolean" }],
  },
  {
    nodeType: "convert.json_parse", runtimeSupport: ["python", "javascript"], label: "解析 JSON", description: "将 JSON 文本转换为列表、字典或标量对象。", tags: ["转换", "json", "解析"], pythonCallable: "json.loads", category: "Python 内置", defaults: {},
    inputPorts: [{ id: "input", label: "JSON 文本", valueType: "text", required: true }], outputPorts: [{ id: "output", label: "对象", valueType: "object" }], parameters: [],
  },
  {
    nodeType: "convert.json_stringify", runtimeSupport: ["python", "javascript"], label: "生成 JSON", description: "将列表、字典和标量转换为格式化 JSON 文本。", tags: ["转换", "json", "序列化"], pythonCallable: "json.dumps", category: "Python 内置", defaults: { indent: 2 },
    inputPorts: [{ id: "input", label: "对象", valueType: "any", required: true }], outputPorts: [{ id: "output", label: "JSON 文本", valueType: "text" }], parameters: [{ key: "indent", label: "缩进", kind: "number", min: 0, max: 8, step: 1 }],
  },
  {
    nodeType: "python.len", runtimeSupport: ["python", "javascript"],
    label: "计算长度",
    description: "调用 Python 内置 len，表格输入返回行数。",
    tags: ["python", "builtins", "len", "长度", "行数"],
    docsUrl: "https://docs.python.org/3/library/functions.html#len",
    pythonCallable: "builtins.len",
    category: "Python 内置",
    defaults: {},
    inputPorts: [{ id: "input", label: "对象", valueType: "any", required: true }],
    outputPorts: [{ id: "output", label: "长度", valueType: "number" }],
    parameters: [],
  },
  {
    nodeType: "python.round", runtimeSupport: ["python", "javascript"],
    label: "数字舍入",
    description: "调用 Python 内置 round，将数字舍入到指定小数位。",
    tags: ["python", "builtins", "round", "舍入", "小数"],
    docsUrl: "https://docs.python.org/3/library/functions.html#round",
    pythonCallable: "builtins.round",
    category: "Python 内置",
    defaults: { digits: 0 },
    inputPorts: [{ id: "input", label: "数字", valueType: "number", required: true }],
    outputPorts: [{ id: "output", label: "数字", valueType: "number" }],
    parameters: [{ key: "digits", label: "小数位 · ndigits", kind: "number", min: 0, max: 15, step: 1 }],
  },
  {
    nodeType: "python.print", runtimeSupport: ["python", "javascript"], sideEffect: true, cachePolicy: "uncacheable",
    label: "打印输出",
    description: "输出输入对象的可读摘要，并将原始值继续传给后续节点。每个打印结果会独立显示在节点内和结果面板。",
    tags: ["python", "builtins", "print", "日志", "调试", "输出"],
    docsUrl: "https://docs.python.org/3/library/functions.html#print",
    pythonCallable: "builtins.print",
    category: "Python 内置",
    defaults: { prefix: "", format: "pretty", includeType: true, maxRows: 20, maxChars: 8000, encoding: "utf-8", encodingErrors: "replace", bytesFormat: "decode", end: "" },
    inputPorts: [{ id: "input", label: "对象", valueType: "any", required: true }],
    outputPorts: [{ id: "output", label: "原值", valueType: "any" }],
    parameters: [{ key: "prefix", label: "输出前缀", kind: "text", placeholder: "例如：清洗结果" }, { key: "format", label: "显示格式", kind: "select", options: [{ label: "智能格式", value: "pretty" }, { label: "Python repr", value: "repr" }, { label: "JSON", value: "json" }, { label: "纯文本", value: "text" }] }, { key: "includeType", label: "显示类型与尺寸", kind: "boolean" }, { key: "maxRows", label: "表格最大行数", kind: "number", min: 1, max: 500, step: 1 }, { key: "maxChars", label: "最大字符数", kind: "number", min: 100, max: 100000, step: 100 }, { key: "encoding", label: "字节编码格式", kind: "select", advanced: true, options: [{ label: "UTF-8", value: "utf-8" }, { label: "UTF-8 BOM", value: "utf-8-sig" }, { label: "GBK / CP936", value: "gbk" }, { label: "GB18030", value: "gb18030" }, { label: "UTF-16 LE", value: "utf-16le" }, { label: "Windows-1252", value: "windows-1252" }] }, { key: "encodingErrors", label: "字节解码错误", kind: "select", advanced: true, options: [{ label: "替换无效字符", value: "replace" }, { label: "严格报错", value: "strict" }, { label: "忽略无效字符", value: "ignore" }] }, { key: "bytesFormat", label: "字节显示方式", kind: "select", advanced: true, options: [{ label: "按编码解码", value: "decode" }, { label: "十六进制", value: "hex" }, { label: "Base64", value: "base64" }, { label: "Python repr", value: "repr" }] }, { key: "end", label: "结尾文本 · end", kind: "text", advanced: true, placeholder: "例如 \\n" }],
  },
  {
    nodeType: "custom.python_function", runtimeSupport: ["python"], executionModel: "custom-code", deterministic: false, cachePolicy: "uncacheable",
    label: "Python 函数",
    category: "自定义",
    defaults: {
      code: "def transform(table: 'table', factor: float = 1) -> 'table':\n    return table * factor",
    },
    inputPorts: [{ id: "table", label: "table", valueType: "table", required: true }],
    outputPorts: TABLE_OUTPUT,
    parameters: [
      {
        key: "code",
        label: "Python 函数",
        kind: "textarea",
        required: true,
        description: "为输入和返回值添加类型标注。table/DataFrame 生成端口，int/float/str/bool 生成参数。仅运行你信任的代码。",
      },
    ],
  },
];

export function getNodeSpec(nodeType: string): NodeSpec | undefined {
  return NODE_CATALOG.find((spec) => spec.nodeType === nodeType);
}

function fuzzyScore(text: string, query: string): number {
  const source = text.toLocaleLowerCase();
  const target = query.toLocaleLowerCase().trim();
  if (!target) return 1;
  if (source === target) return 100;
  if (source.startsWith(target)) return 70;
  if (source.includes(target)) return 50;
  let cursor = 0;
  for (const character of target) {
    cursor = source.indexOf(character, cursor);
    if (cursor < 0) return 0;
    cursor += 1;
  }
  return 15;
}

export function searchNodeCatalog(query: string): NodeSpec[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return NODE_CATALOG;
  return NODE_CATALOG.map((spec) => {
    const searchable = [spec.label, spec.nodeType, spec.pythonCallable, spec.description, ...(spec.tags ?? [])].filter(Boolean).join(" ");
    const score = terms.reduce((total, term) => {
      const termScore = fuzzyScore(searchable, term);
      return termScore ? total + termScore : -1000;
    }, 0);
    return { spec, score };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.spec.label.localeCompare(right.spec.label)).map((item) => item.spec);
}

export function areValueTypesCompatible(source: ValueType, target: ValueType): boolean {
  return source === "any" || target === "any" || source === target;
}

export function getInputPort(nodeType: string, portId: string | null | undefined): PortSpec | undefined {
  const ports = getNodeSpec(nodeType)?.inputPorts ?? [];
  return ports.find((port) => port.id === (portId ?? "input"));
}

export function getOutputPort(nodeType: string, portId: string | null | undefined): PortSpec | undefined {
  const ports = getNodeSpec(nodeType)?.outputPorts ?? [];
  return ports.find((port) => port.id === (portId ?? "output"));
}
