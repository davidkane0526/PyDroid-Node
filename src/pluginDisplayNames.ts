export type UiLanguage = "zh-CN" | "en";

const DEMO_PLUGIN_NAMES_ZH: Record<string, string> = {
  "demo.conditional-ui": "条件界面示例",
  "demo.constraint-ui": "约束界面示例",
  "demo.declarative-scale": "声明式缩放示例",
  "demo.declarative-table": "声明式表格示例",
  "demo.linked-enum-table": "联动枚举表格示例",
  "demo.manifest-scale": "清单缩放示例",
  "demo.manifest-table-tools": "清单表格工具示例",
  "demo.multi-output-status": "多输出状态示例",
  "demo.resource-scale": "资源缩放示例",
  "demo.resource-table": "资源表格示例",
  "demo.result-status-table": "结果状态表格示例",
  "demo.validation-ui": "校验界面示例",
};

const DEMO_NODE_NAMES_ZH: Record<string, string> = {
  "demo.conditional_ui": "条件界面",
  "demo.constraint_ui": "约束界面",
  "demo.declarative_scale": "声明式缩放",
  "demo.declarative_table": "声明式表格",
  "demo.linked_enum_table": "联动枚举表格",
  "demo.manifest_scale": "清单缩放",
  "demo.manifest_table": "清单表格",
  "demo.manifest_table_offset": "清单表格偏移",
  "demo.multi_output_status": "多输出状态",
  "demo.resource_scale": "资源缩放",
  "demo.resource_table": "资源表格",
  "demo.result_status_table": "结果状态表格",
  "demo.validation_ui": "校验界面",
};

export function pluginDisplayName(id: string, fallback: string, language: UiLanguage): string {
  return language === "zh-CN" ? DEMO_PLUGIN_NAMES_ZH[id] ?? fallback : fallback;
}

export function nodeDisplayName(nodeType: string, fallback: string, language: UiLanguage): string {
  return language === "zh-CN" ? DEMO_NODE_NAMES_ZH[nodeType] ?? fallback : fallback;
}
