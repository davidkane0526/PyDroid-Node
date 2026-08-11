export type ParameterKind = "text" | "number" | "boolean" | "select";

export type ParameterSpec = {
  key: string;
  label: string;
  kind: ParameterKind;
  options?: Array<{ label: string; value: string | number }>;
};

export type NodeSpec = {
  nodeType: string;
  label: string;
  category: "输入输出" | "表格处理" | "统计" | "绘图";
  defaults: Record<string, string | number | boolean | null>;
  parameters: ParameterSpec[];
  inputPorts?: Array<{ id: string; label: string }>;
};

export const NODE_CATALOG: NodeSpec[] = [
  {
    nodeType: "io.read_csv",
    label: "读取 CSV",
    category: "输入输出",
    defaults: { skipRows: 0 },
    parameters: [{ key: "skipRows", label: "跳过行数", kind: "number" }],
  },
  {
    nodeType: "io.export_csv",
    label: "导出 CSV",
    category: "输入输出",
    defaults: { fileName: "result.csv" },
    parameters: [{ key: "fileName", label: "文件名", kind: "text" }],
  },
  {
    nodeType: "table.concat",
    label: "合并双表",
    category: "表格处理",
    defaults: { axis: 0, ignoreIndex: true },
    inputPorts: [
      { id: "left", label: "A" },
      { id: "right", label: "B" },
    ],
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
    nodeType: "table.select_columns",
    label: "选择列",
    category: "表格处理",
    defaults: { columns: "0,1" },
    parameters: [{ key: "columns", label: "列序号（逗号分隔）", kind: "text" }],
  },
  {
    nodeType: "table.absolute",
    label: "绝对值",
    category: "表格处理",
    defaults: {},
    parameters: [],
  },
  {
    nodeType: "table.transpose",
    label: "转置",
    category: "表格处理",
    defaults: {},
    parameters: [],
  },
  {
    nodeType: "table.difference",
    label: "差分",
    category: "表格处理",
    defaults: { periods: 1, axis: 0 },
    parameters: [
      { key: "periods", label: "差分阶数", kind: "number" },
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
    nodeType: "table.filter_range",
    label: "范围筛选",
    category: "表格处理",
    defaults: { column: 0, min: "", max: "" },
    parameters: [
      { key: "column", label: "筛选列序号", kind: "number" },
      { key: "min", label: "最小值（可空）", kind: "text" },
      { key: "max", label: "最大值（可空）", kind: "text" },
    ],
  },
  {
    nodeType: "table.group_aggregate",
    label: "分组聚合",
    category: "统计",
    defaults: { groupSize: 20, startRow: 0, endRow: 20, method: "mean" },
    parameters: [
      { key: "groupSize", label: "每组行数", kind: "number" },
      { key: "startRow", label: "组内起始行（从0）", kind: "number" },
      { key: "endRow", label: "组内结束行（不包含）", kind: "number" },
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
    nodeType: "plot.line",
    label: "折线图",
    category: "绘图",
    defaults: { logY: false },
    parameters: [{ key: "logY", label: "Y轴对数", kind: "boolean" }],
  },
];

export function getNodeSpec(nodeType: string): NodeSpec | undefined {
  return NODE_CATALOG.find((spec) => spec.nodeType === nodeType);
}
