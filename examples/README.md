# PyDroid Node built-in demos

这些工作流同时作为软件“流程 → 内置 Demo”入口的数据源，也可以直接通过顶部“导入”打开。

- `demo-01-scientific-pipeline.workflow.json`：无需外部文件，生成随机表格，进行清洗、统计和绘图。
- `demo-02-native-function.workflow.json`：展示原生 Workflow Function，函数内部只含 Python/JavaScript 双运行时节点。
- `demo-03-composite-group.workflow.json`：展示组合节点与嵌套画布，双击组合后可检查内部节点。
- `demo-04-control-flow.workflow.json`：展示 If / For / While 原生结构。
- `demo-05-dynamic-sockets.workflow.json` ～ `demo-09-loop-zones.workflow.json`：展示动态 Socket、Compare/Switch、If/For/While Zone。
- `demo-10-parameter-sockets.workflow.json`：展示普通节点参数由连线覆盖，含随机表 Count 与 Head N。
- `demo-11-dynamic-data-nodes.workflow.json`：展示数值序列表与周期统计的参数 Socket 组合。
- `demo-12-dynamic-table-parameters.workflow.json` ～ `demo-16-dynamic-pulse-channels.workflow.json`：展示动态表格/绘图参数、Pulse 参数、多输入 Concat、多聚合与多通道组合。
- `demo-17-column-math-pipeline.workflow.json`：展示可链式列运算与动态标量。
- `demo-18-series-registry.workflow.json`：展示结构化 `Series → Registry → Plot`。
- `demo-19-series-groups.workflow.json`：展示 Series `group/visible` 与 Registry include/exclude 筛选。
- `demo-20-scientific-column-transforms.workflow.json`：展示 `Clip → Sqrt → Min-Max Normalize` 科学列变换。
- `demo-21-legend-group-solo.workflow.json` ～ `demo-24-legend-state.workflow.json`：展示 Legend Group/Solo、声明式 Column Pipeline、条件 Transform 与 Legend State。
- `demo-25-runtime-provider-scale.workflow.json` ～ `demo-26-python-provider-table.workflow.json`：展示底层 Runtime Provider SDK。
- `demo-27-manifest-plugin-package.workflow.json`：展示单节点双 Runtime Manifest 插件包。
- `demo-28-manifest-multi-node-package.workflow.json`：展示一个 Manifest 原子装载多个节点并连接原生 Plot。
- `plugins/*.plugin.json`：Demo 27/28 实际使用的可序列化插件 Manifest。
- `logic-control-demo.workflow.json`、`periodic-oscillating-pulse.workflow.json`、`ter-matrix.workflow.json`：保留的专项示例。

建议验收时在 **Soft + Light**、**Soft + Dark**、**Classic + Light/Dark** 之间切换，重点观察节点厚度、文字层级、端口、运行按钮、函数/组合/控制流区分以及 hover 是否稳定。
