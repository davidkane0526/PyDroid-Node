import scientificPipeline from "../examples/demo-01-scientific-pipeline.workflow.json?raw";
import nativeFunction from "../examples/demo-02-native-function.workflow.json?raw";
import compositeGroup from "../examples/demo-03-composite-group.workflow.json?raw";
import controlFlow from "../examples/demo-04-control-flow.workflow.json?raw";
import dynamicSockets from "../examples/demo-05-dynamic-sockets.workflow.json?raw";
import ifZone from "../examples/demo-06-if-zone.workflow.json?raw";
import dynamicTypes from "../examples/demo-07-dynamic-types.workflow.json?raw";
import dynamicOperators from "../examples/demo-08-dynamic-operators.workflow.json?raw";
import loopZones from "../examples/demo-09-loop-zones.workflow.json?raw";
import parameterSockets from "../examples/demo-10-parameter-sockets.workflow.json?raw";
import dynamicDataNodes from "../examples/demo-11-dynamic-data-nodes.workflow.json?raw";
import dynamicTableParameters from "../examples/demo-12-dynamic-table-parameters.workflow.json?raw";
import dynamicPulsePlot from "../examples/demo-13-dynamic-pulse-plot.workflow.json?raw";
import dynamicMultiInputConcat from "../examples/demo-14-dynamic-multi-input-concat.workflow.json?raw";
import groupbyMultiSeries from "../examples/demo-15-groupby-multi-series.workflow.json?raw";
import dynamicPulseChannels from "../examples/demo-16-dynamic-pulse-channels.workflow.json?raw";
import columnMathPipeline from "../examples/demo-17-column-math-pipeline.workflow.json?raw";
import seriesRegistry from "../examples/demo-18-series-registry.workflow.json?raw";
import seriesGroups from "../examples/demo-19-series-groups.workflow.json?raw";
import scientificColumnTransforms from "../examples/demo-20-scientific-column-transforms.workflow.json?raw";
import legendGroupSolo from "../examples/demo-21-legend-group-solo.workflow.json?raw";
import columnTransformPipeline from "../examples/demo-22-column-transform-pipeline.workflow.json?raw";

export type WorkflowDemo = {
  id: string;
  label: string;
  description: string;
  document: string;
};

export const WORKFLOW_DEMOS: readonly WorkflowDemo[] = [
  {
    id: "scientific-pipeline",
    label: "Demo 01 · 科学数据流水线",
    description: "随机表格 → 清洗 → 描述统计 / 绘图；无需外部数据，可直接运行。",
    document: scientificPipeline,
  },
  {
    id: "native-function",
    label: "Demo 02 · 原生可复用函数",
    description: "检查函数卡片、展开编辑，以及 Python / JavaScript 双运行时原生函数图。",
    document: nativeFunction,
  },
  {
    id: "composite-group",
    label: "Demo 03 · 组合节点与嵌套画布",
    description: "双击组合进入内部画布，检查组合、内部普通节点和返回上层的层级样式。",
    document: compositeGroup,
  },
  {
    id: "control-flow",
    label: "Demo 04 · If / For / While 控制流",
    description: "检查原生结构容器、分支/循环子节点、端口和连线。",
    document: controlFlow,
  },
  {
    id: "dynamic-sockets",
    label: "Demo 05 · 动态 Socket 与 Compare / Switch",
    description: "未连接输入直接使用节点内默认值；连线后默认值控件自动让位。",
    document: dynamicSockets,
  },
  {
    id: "if-zone",
    label: "Demo 06 · Blender 风格 If Zone",
    description: "Compare 驱动惰性 If Zone，只执行 TRUE / FALSE 中被选中的分支。",
    document: ifZone,
  },
  {
    id: "dynamic-types",
    label: "Demo 07 · 动态节点类型变体",
    description: "并排查看数字、文本、布尔节点的动态端口与内联默认值。",
    document: dynamicTypes,
  },
  {
    id: "dynamic-operators",
    label: "Demo 08 · 动态 Math / Boolean Math",
    description: "查看二元/一元操作切换、Socket 默认值，以及连接后默认控件自动让位。",
    document: dynamicOperators,
  },
  {
    id: "loop-zones",
    label: "Demo 09 · For / While Zones",
    description: "For Each 与 While 使用 Start / BODY / End Zone 表达，执行语义保持不变。",
    document: loopZones,
  },
  {
    id: "parameter-sockets",
    label: "Demo 10 · 通用参数 Socket",
    description: "普通节点参数可由连线覆盖；随机表 Count 与 Head N 都由上游 Math 节点驱动。",
    document: parameterSockets,
  },
  {
    id: "dynamic-data-nodes",
    label: "Demo 11 · 动态数据节点",
    description: "数值序列表与周期统计使用参数 Socket，展示数据节点与参数节点的统一组合方式。",
    document: dynamicDataNodes,
  },
  {
    id: "dynamic-table-parameters",
    label: "Demo 12 · 动态表格参数",
    description: "列选择、排序、分组聚合与绘图参数由普通节点动态驱动。",
    document: dynamicTableParameters,
  },
  {
    id: "dynamic-pulse-plot",
    label: "Demo 13 · 动态 Pulse 与 Plot",
    description: "用 Math 动态驱动脉冲高电平、重复次数和绘图线宽。",
    document: dynamicPulsePlot,
  },
  {
    id: "dynamic-multi-input-concat",
    label: "Demo 14 · 动态多输入 Concat",
    description: "Concat 切换为独立 Socket 模式后，根据输入数量动态生成 Table 端口。",
    document: dynamicMultiInputConcat,
  },
  {
    id: "groupby-multi-series",
    label: "Demo 15 · GroupBy 多聚合与 Series",
    description: "同一个 GroupBy 对不同列执行多种聚合，并用 Series 配置控制多条曲线。",
    document: groupbyMultiSeries,
  },
  {
    id: "dynamic-pulse-channels",
    label: "Demo 16 · 动态 Pulse 多通道",
    description: "合并节点按通道数量生成 Socket，并将四路独立波形对齐为一张多通道表。",
    document: dynamicPulseChannels,
  },
  {
    id: "column-math-pipeline",
    label: "Demo 17 · 动态列运算流水线",
    description: "Math 动态驱动列运算标量，并串联乘法与绝对值节点处理表格列。",
    document: columnMathPipeline,
  },
  {
    id: "series-registry",
    label: "Demo 18 · Series Registry",
    description: "两条 Series 声明通过动态 Socket Group 汇入 Registry，再结构化驱动折线图。",
    document: seriesRegistry,
  },
  {
    id: "series-groups",
    label: "Demo 19 · Series 分组与可见性",
    description: "Series 声明 group/visible，Registry 由动态 Groups Socket 统一筛选可见曲线。",
    document: seriesGroups,
  },
  {
    id: "scientific-column-transforms",
    label: "Demo 20 · 科学列变换",
    description: "动态上下限驱动 Clip，再串联 Sqrt 与 Min-Max 归一化。",
    document: scientificColumnTransforms,
  },
  {
    id: "legend-group-solo",
    label: "Demo 21 · Legend Group 与 Solo",
    description: "Series 声明 legendGroup 与 solo；Registry 检测有效 Solo 后仅保留单显曲线。",
    document: legendGroupSolo,
  },
  {
    id: "column-transform-pipeline",
    label: "Demo 22 · 批量列变换 Pipeline",
    description: "三个 Column Transform 声明通过动态 Transform Socket 按顺序作用于同一张表。",
    document: columnTransformPipeline,
  },
] as const;
