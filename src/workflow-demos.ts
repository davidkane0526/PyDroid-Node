import scientificPipeline from "../examples/demo-01-scientific-pipeline.workflow.json?raw";
import nativeFunction from "../examples/demo-02-native-function.workflow.json?raw";
import compositeGroup from "../examples/demo-03-composite-group.workflow.json?raw";
import controlFlow from "../examples/demo-04-control-flow.workflow.json?raw";
import dynamicSockets from "../examples/demo-05-dynamic-sockets.workflow.json?raw";
import ifZone from "../examples/demo-06-if-zone.workflow.json?raw";
import dynamicTypes from "../examples/demo-07-dynamic-types.workflow.json?raw";

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
] as const;
