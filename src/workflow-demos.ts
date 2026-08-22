import scientificPipeline from "../examples/demo-01-scientific-pipeline.workflow.json?raw";
import nativeFunction from "../examples/demo-02-native-function.workflow.json?raw";
import compositeGroup from "../examples/demo-03-composite-group.workflow.json?raw";
import controlFlow from "../examples/demo-04-control-flow.workflow.json?raw";

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
] as const;
