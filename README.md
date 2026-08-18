> **1.4.29 (52) · dev Phase 3**：Phase 2 取消链路完成可靠性收口（等待宿主真实释放、远程执行可观测/可停止），并开始 Workflow Core 抽离 history/session/persistence/migration；`ui.alert` 首次运行显示当前上游结果，Android 构建 82% 增加细分阶段与心跳。UI 布局继续保持稳定。

> **dev 架构线**：UI 进入稳定期；Phase 1 `PlatformAdapter` 已把 SMB、文件选择、Profile、Secrets、Remote Access 和系统状态从 Runtime facade 中抽离。后续以执行可靠性和 Workflow Core 为主，详见 [docs/ARCHITECTURE_RELIABILITY_ROADMAP.md](docs/ARCHITECTURE_RELIABILITY_ROADMAP.md)。

当前 `dev` Android 调试构建版本：`1.4.29 (52)`；`main` 仍保留稳定 `1.4.27 (50)` LAN 基线。本次交付只以用户提供的 ZIP 为代码基线，不依赖 GitHub。

# PyDroid Flow

PyDroid Flow 是一个以 Android 和 Windows 桌面端为首要平台的可复用数据处理节点编辑器。
用户通过同一套可视化工作流读取数据、处理表格、绘制图表并导出结果；Python 与 JavaScript
作为可切换的执行运行时共享 UI、工作流模型和结果协议。

所有面向用户的功能、修复和版本号更新均记录在 [CHANGELOG.md](CHANGELOG.md)，并与 Android
`versionName` / `versionCode` 保持一致。

> **新会话 / Coding AI 开发入口**：先阅读根目录 [AGENTS.md](AGENTS.md) 和
> [docs/development-handoff.md](docs/development-handoff.md) 与
> [docs/ARCHITECTURE_RELIABILITY_ROADMAP.md](docs/ARCHITECTURE_RELIABILITY_ROADMAP.md)。它们记录当前 Git 分支、已完成重构、
> 云端验证状态、下一阶段计划和“只交付一个干净 Git 项目目录”的约束。

## 项目目标

1. 在不同平台提供相同或等价的节点、参数、校验、预览和导出能力。
2. 使用同一版本化工作流 JSON，使 Android 与 Windows 可以互相交换工作流。
3. 通过统一 Runtime Adapter 同时承载 Python 与 JavaScript 引擎，避免维护两套应用 UI。
4. 所有开发环境和额外工具均可追踪、可复现，并可在项目结束时统一卸载。

## 当前功能

- **PlatformAdapter Phase 1（`dev`）**：共享 UI 不变；`App.tsx` 从 `./platform` 获取 SMB、文件、Profile、Secrets、Remote Access 与系统能力，从 `./execution` 只获取 Runtime/执行能力；Android/Web 与 Desktop 均实现同一 `PlatformAdapter` contract。
- **Runtime Adapter 架构重构（当前分支，待本地完整编译验证）**：保留 149p 共享 UI 与 Python 能力，取回原 JS 分支中可复用的数据流引擎；“自动”模式仅在整个工作流兼容时选择 JS，否则回退 Python；JS 图表以 ECharts 交互式结果接入现有预览。详见 [docs/runtime-architecture.md](docs/runtime-architecture.md)。
- **1.4.9 RC2 设置与 SMB 文件管理器（当前分支，待本地验证）**：设置窗口使用宽屏双列/窄屏单列的自适应卡片布局并统一主题滚动条；SMB 改为网络设备与共享树、地址面包屑、可折叠连接设置和名称/类型/大小文件列表。详见 [docs/development-handoff.md](docs/development-handoff.md)。
- `1.4.9` 候选：修复 Android 长按画布框选与单指平移竞争，框选激活后不再推动画布；首次构建不再因固定为 `null` 的 `restoredSnapshot` 可选链访问产生 `never` 类型错误；并继续统一资源栏、参数面板和节点结果 UI。
- `1.4.8`：组合会从内部未占用端口自动生成公开输入输出并修复旧 0 端点资源；完成组合与框选计数同步，框选时隐藏连线和删除叉号；节点/组合资源增加右键菜单，组合卡片与桌面拖拽动画重做。
- `1.4.7`：SMB 文件选择器改为多行设备/登录/共享/文件流程，设备卡显示共享名与 IP，支持访客登录、密码显隐和可读错误；设置页合并为单一文件选择入口；鼠标可拖动连线端点改接或拖到空白处断开，并校准断开按钮；缩窄、减淡资源栏。
- `1.4.6`：修复逻辑结构标题/内部节点遮挡及亮色主题，组合在亮色模式保持紫色辨识；重排窄栏表格控件并加入明确的连线断开按钮；节点、组合、流程统一跨触摸/鼠标拖入动画；Android 和桌面端加入局域网 SMB 设备发现、认证、共享扫描和完整文件浏览。
- `1.4.5`：修复底部结果/参数边缘手柄、窄栏表格溢出和逻辑容器换向遮挡；Notebook 支持 If/For-each/While 子流程并避免 Python 名称覆盖；完善字节编码打印、错误定位和断线交互；AI Agent 可创建真实组合、断线与整理；统一桌面图标和亮色细节。
- `1.4.4`：桌面 IPC 改用 Base64 帧彻底隔离工作流 JSON；SMB 连接持久化并支持共享扫描；触屏禁用框选；增加端点尺寸、调试断点/单步、弹窗多类型输入、失败节点红框和部分结果保留；新增散点/柱状/直方/箱线/面积图并完成逻辑 Demo 的执行与 Notebook 往返验证。
- `1.4.3`：修复桌面工作流 JSON 异常击穿 IPC；失败节点红框、部分结果和调试堆栈均可保留；桌面端增加局域网网页服务；Notebook 增加行号并转换逻辑结构；重做全屏数据表格；增加调试模式、通用文件读取、DataFrame 转换和完整 print 参数 UI；补齐亮色主题。
- `1.4.2`：修复 print 污染桌面 JSON；增加可定位的完整错误、红色错误节点、可筛选排序分页的数据网格、渐变类型连线、Notebook 整本/逐单元运行、AST 转换识别和 Android 局域网前端热更新。
- `1.4.1`：彻底清理空白流程 Notebook，兼容历史字面量参数并避免 JSON 错误击穿桌面 IPC；补齐逻辑控制亮色主题、整理后视区回正、结果双击编辑复制、丰富打印类型、类型连线配色和八个转换节点。
- `1.4.0`：内置 SMB 2/3 文件浏览器支持目录浏览、CSV 多选和整目录导入；精简 Android 文件入口；修复 Notebook 滚动回弹和新建流程残留；完善亮色收起按钮与包管理；新增周期震荡脉冲节点及无代码块转换，并提供可执行逻辑控制 Demo。
- `1.3.9`：统一参数栏和设置字号；增加完整历史记录面板与文件拖入；修复桌面 Notebook 导入 IPC、实时内存、系统菜单、侧栏收起遮挡和 Notebook 代码区高度；优化纵向节点尺寸、行距与端口类型。
- `1.3.8`：桌面/网页精确指针模式增加框选右键批量菜单与删除、全选、取消等快捷键；修复亮色菜单、拖放落点、参数字体、设置遮挡和端口坐标未及时刷新导致的连线异常；设置增加节点大小、连线粗细及安全导入导出。
- `1.3.7`：纵向画布的已有边、新建边和拖拽预览统一使用连续贝塞尔路由，消除节点中心轻微错位时产生的短横线与直角折返，并以圆角端点改善端口衔接；同步修复 Windows Node.js 24 下桌面开发启动失败。
- `1.3.6`：Android CSV 读取增加符合 OPPO 指南的系统 Picker 与第三方/SMB Chooser 双入口；支持持久 URI、多选 100 个文件和 DocumentsProvider 文件夹；Windows 修复 OneDrive 联接造成前端页面漏打包与纯色窗口的问题，禁用易导致空白窗口的 GPU 合成，并增加成品 UI/IPC/Python 启动检查、诊断日志和恢复页。
- `1.3.5`：弹窗提示改为阻塞式交互节点；三个可编辑按钮分别输出 `true`、`false`、`None`，支持隐藏并可供后续节点判断；多个输入/提示节点按流程顺序逐个执行。
- `1.3.4`：补全 Notebook、按钮、参数控件和文字的亮色主题；弹窗提示节点执行后逐条显示；画布连线使用纵向友好的平滑折线路由并提高可见性。
- `1.3.3`：局域网网页首次同步 Android 配置，AI 密钥以 Android Keystore 加密保存并仅向已配对网页内存同步；横屏底部参数栏可调高度，资源栏标题/标签/搜索固定；新增无代码块的 Pulse 波形、三通道对齐和脉冲测量分段节点及内置组合。
- `1.3.2`：组合成为可保存、可复用且由共享执行核心展开的子流程；新增透视表节点、节点级结果检查器与完整亮/暗主题抽屉适配。
- `1.3.1`：Notebook 语义转换不再生成代码承载节点；新增实验周期数据处理节点与内置组合。
- `1.3.0`：主题化输入弹窗、流程资源长按/右键管理、逐条 print 输出与结果面板汇总。
- React Flow 可视化画布、节点工具箱、连线、添加、删除与复制
- 10 个数据处理节点，包括带命名输入端口的双表拼接节点
- 类型化参数编辑与工作流合法性校验
- 版本化工作流 JSON 导入和导出
- 本地自动恢复、50 步撤销/重做
- 节点级执行错误提示和画布高亮
- CSV 文件选择、表格预览、折线图预览和 CSV 结果导出
- 统一 Runtime Adapter：Python 保持完整兼容，内置 JavaScript 引擎可执行兼容节点并输出交互式 ECharts 图表
- 响应式 Web 界面
- AI Agent：OpenAI Responses / 兼容接口的结构化工具调用、逐项权限、确认预览与本地审计
- 节点抽屉分为“节点 / 组合 / 流程”；流程可保存到库，并扫描用户选择的 Android 文件夹
- 自定义交互节点：弹窗提示、文本/数值/下拉选择输入；可导出为可运行的 Jupyter Python 占位代码

## 平台进度

| 能力 | Android | Windows 桌面端 |
| --- | --- | --- |
| 节点编辑器与参数编辑 | 已实现 | 已实现，共用渲染层 |
| 节点快捷操作与多选 | 双击打开节点菜单；长按进入勾选多选 | 右键/双击打开节点菜单；鼠标拖框多选 |
| 类型化端口与连线校验 | 已实现；阻止类型冲突及环路 | 已实现，共用渲染层 |
| 自定义 Python 函数节点 | 已实现基础版；由函数类型标注生成端口和参数 | 已实现，共用 Python 核心 |
| 工作流导入/导出与恢复 | 已实现 | 已实现，共用渲染层 |
| Python 工作流执行 | 已实现，Chaquopy 桥接 | 已实现，Electron IPC 桥接 |
| JavaScript 工作流执行 | 已接入统一 Runtime Adapter；兼容工作流可在 WebView 内执行 | 已接入统一 Runtime Adapter；兼容工作流可在渲染层执行 |
| 局域网网页遥控 | 已实现：Android 托管同一 UI；启动后自动 SSDP/UPnP + mDNS 发现 | 已实现：Electron 托管同一 UI；启动后自动 SSDP/UPnP + mDNS 发现 |
| AI 节点规划 | 已实现：会话密钥、计划预览、权限和审计 | 已实现，共用渲染层与工作流模型 |
| 表格、图表及导出预览 | 已实现 | 已实现 |
| 自动化测试 | Web 23 项、共享 Python 30 项通过 | 桌面桥接 4 项及 Electron 多文件/多导出冒烟测试通过 |
| 安装包构建 | ARM64 debug APK 本机构建通过，待真机复验 | 自包含 Windows x64 便携包已生成并验证 |
| 物理设备/人工交互验收 | 待完成 | 新版便携包与自动化链路通过，完整人工交互待完成 |

当前阶段为功能原型/MVP。平台功能应保持对等；若某平台暂不支持某项能力，必须在上表
和 `docs/progress.md` 中明确记录，不得静默产生平台分叉。

### 局域网网页遥控

在 Android 或 Windows 桌面端顶部点击局域网 AirDrop 图标并启动网页访问后，现有 HTTP/Web 服务会自动同时启动 SSDP/UPnP 与 mDNS/DNS-SD 发现。应用仍显示 `http://宿主设备IP:端口/?remote=1`，同时发布稳定的 `.local` 主机名。Windows 电脑可在“文件资源管理器 → 网络”中发现 `PyDroid Node - 设备名`，双击后由 UPnP `presentationURL` 使用默认浏览器打开同一 Web UI，不需要手工输入 IP。

若启用校验则仍需输入宿主应用显示的随机四位数字。网页中的文件选择由浏览器执行，因此文件来自访问网页的设备；工作流、已选文件内容和参数会传给宿主，由 Android Chaquopy 或 Windows Python 执行，结果表格、图像、CSV 下载和节点错误再回传网页。发现协议只公开设备名称、地址、端口和 UPnP 描述，不会绕过已有 PIN/Token API 认证。

服务默认只面向局域网；启用校验时，校验成功的浏览器会获得本次服务的会话令牌，未配对者
无法调用执行、环境或 Notebook 分析接口。关闭校验可用于可信局域网，但知道地址的设备均可
访问。请勿将地址或校验码发到公网。当前服务随应用进程运行；Android 应保持前台以避免系统
暂停网络和计算，Windows 桌面窗口也应保持运行。

### AI Agent 节点编写

顶部星形按钮打开 AI Agent 设置。内置 OpenAI、Anthropic Claude、DeepSeek、Moonshot Kimi、
智谱 GLM、通义千问和自定义兼容接口预设；每个预设都可以改写模型名与接口地址，并可用
“尝试连接”发送最小测试请求。填写本次会话的 API 密钥后，可用自然语言请求节点计划。密钥只保存在内存中，不会写入
设置、工作流或导出的设置文件。为让 AI 能续写当前流程，应用只会发送节点 ID、标签、父结构、
分支、节点类型、类型化端口、可用参数键和连线结构，不会自动发送参数值、CSV 文件内容或既有用户代码。模型返回的
是受限的 `propose_workflow_plan` 工具调用：创建节点、更新已声明参数、连接/断开兼容端口、把已有节点保存为真正组合、横纵整理、删除
节点和运行工作流分别由独立开关控制。应用会
在执行前再次检查节点类型、参数键、节点 ID、端口类型、环路和当前权限，用户仍须点击
“确认并应用”。最近 30 条已应用或拒绝的计划会写入 `logs/agent-audit.json`，便于复查。

这一层使用共享的工作流和节点目录，因此 Android、Windows 与局域网网页使用相同计划语义。
AI 无法绕过该层直接访问文件、执行 Python 或改写任意工作流 JSON；如需读取电脑文件，仍通过
局域网页面的标准文件选择器授权。

完整的 Agent 操作契约、节点化约束和维护要求见 [docs/ai-agent.md](docs/ai-agent.md)。

### 自定义 Python 函数节点

从“自定义”分组添加“Python 函数”。可从数值缩放、按行截取、填充缺失值和拆分双输出
模板起步。函数签名中的 `table`/`DataFrame` 参数会生成输入端口，`int`、`float`、
`str`、`bool`、`list[T]` 参数会生成参数控件，`Literal[...]` 会生成下拉框，
`Optional[T]`、`T | None` 会生成可选项。返回 `tuple[...]` 可生成并执行多个独立输出端口。
例如：

```python
def transform(table: "table", factor: float = 1) -> "table":
    return table * factor
```

```python
def split(table: "table", columns: list[int] = [0]) -> tuple["table", "table"]:
    other = [index for index in range(table.shape[1]) if index not in columns]
    return table.iloc[:, columns], table.iloc[:, other]
```

需要稳定、可读的多输出连线时，可在字符串标注中使用 `名称:类型`：

```python
def split(table: "table") -> tuple["selected:table", "remaining:table"]:
    return table.iloc[:, [0]], table.iloc[:, 1:]
```

自定义节点提供全屏代码编辑器和即时签名摘要。当前函数可保存为个人模板；个人模板保存在
本地，也可以导出为版本化的 `*.pydroid-node.json` 文件，在 Android 与 Windows 之间导入共享。

自定义代码随工作流保存，并在 Android 与 Windows 的共享 Python 核心执行。只应运行
可信代码；当前版本禁止导入模块以及修改全局或外层状态。多输出连线会将
`sourceHandle` 保存到同一个版本化工作流中，并在两个平台的执行核心中按端口路由。

内置节点现已包含常用 Pandas 操作（删除/填充缺失值、排序、表达式筛选）、重命名列、
可配置折线图和按行条件分支。折线图支持选择 X/Y 列、标题与坐标标签、图例、网格、
对数轴、线型、标记、尺寸和 DPI；结果图可以点击进入悬浮层缩放查看。布尔参数自动显示
为开关，有限区间数值自动显示为滑块。参数面板可收起，缩略图只会在空间充足且流程较大
时自动出现；Android 启动后会提前预热 Python 解释器，首次运行会等待初始化完成。

节点参数支持“保存为默认”，但只保存节点目录中明确标记为用户偏好的字段：例如 Plot 的
线宽、图像尺寸、DPI、线型，以及 CSV 的编码和解析习惯。列名、X/Y 列、筛选表达式等
与当前数据有关的字段不会复用；保存结果只影响以后新建的同类节点。结果面板可在右侧和
底部之间停靠，右侧可调宽度、底部可调高度，画布和参数区会自动重新排版。

`读取 CSV` 节点以 `pandas.read_csv` 签名清单生成基础和高级参数，当前提供 35 个可执行
参数；高级项默认折叠。浏览器已经负责文件输入，或会改变节点返回类型/允许执行回调的
参数（如 `filepath_or_buffer`、`iterator`、`chunksize`、`converters`）会明确列为不兼容，
不会伪装成可用控件。文件按节点选择的编码从原始字节解码后再交给共享 Python 核心。

节点库提供中文、节点类型、Python 调用名、说明和标签的模糊检索。官方签名注册器新增
`DataFrame.head`、`tail`、`drop_duplicates`、`sample`、`round`、`describe`，以及 Python
内置 `len`、`round`；每个注册节点在参数区显示官方文档入口。用户可以给画布节点添加
标签，并把节点类型加入自定义常用组。默认流程增加缺失值清洗节点；整理布局和节点结果
显隐已经移到画布左上角的工具栏，使用“网格图标 + 整理”和“眼睛图标 + 结果开/关”明确
表达动作与状态，并按当前屏幕宽度生成紧凑的蛇形网格。顶部撤销、重做使用统一 SVG 图标。

执行结果现在按节点返回：表格显示行列与列名摘要，绘图显示缩略图，标量和 CSV 显示
简短值摘要。这些信息位于对应节点上方，可通过“显示/隐藏节点结果”统一切换，不会写入
工作流文件。节点宽度按中文名称在 168–270px 间自适应，长名称允许完整换行。画布支持
横向、纵向和自动方向；纵向时输入端口移到顶部、输出端口移到底部，并重新计算连线路径。

画布左上角可在节点视图与 Python Notebook 代码视图之间切换。代码视图生成可运行的
`pandas`/NumPy/Matplotlib Python 和 `# %%` 单元格，不再显示工作流 JSON；参数使用 Python
字典，节点关系保存在注释中，可校验后同步回节点图。代码可导出标准 nbformat 4 `.ipynb`，
在 Jupyter 中修改输入文件路径后运行。

节点从工具箱拖入画布时会显示跟手预览并以落点动画加入。移动端长按任一节点进入多选，
随后点按节点或勾选框选择成员；桌面端可在画布空白处用左键拖框，也可按住 Ctrl 多选。
点击“组合”会将至少两个选中节点折叠成子流程，双击组合节点后可从操作菜单进入或解除组合。
主流程不再显示占位层级按钮；只有进入子流程后，画布底部才显示返回主流程的层级路径。
移动端进入多选后仍保持单指平移和双指缩放，不会把画布手势切换为框选；工具栏固定为单行
横向滚动，拖拽预览显示在触点上方，避免被手指遮挡。

画布方向按钮会循环切换“自动、横向、纵向”，每次切换都会立即整理；整理使用节点实际尺寸对齐各层，避免宽节点或结构节点错位。左右侧栏均可收起，桌面/网页端可拖动侧栏边缘调整宽度；节点列表在触屏上保持上下滑动，只有停留约 0.28 秒才会进入拖拽。网页端滚动条与深色界面统一，React Flow 的默认品牌水印已隐藏。

新安装默认采用纵向排布、自动缩放适配画布且不显示缩略图。顶部局域网服务使用 AirDrop 风格图标，运行固定在操作区末端；包管理和文件工作流操作之间以分隔线区分。新增“打印输出”节点：它会把输入值（表格显示尺寸和前五行）记录为节点结果，同时无损把原值传给后续节点。连线校验对拖拽过程中的不完整连接和异常节点定义采取安全拒绝，避免 React Flow 因校验异常卸载编辑器。

底部统一状态栏以图标显示每秒刷新的进程内存、最近一次计算耗时、节点数和连线数。顶部设置可管理主题（跟随系统、暗色、亮色）、左右栏宽度、结果区高度、缩略图和节点结果显示。Android 首次启动会在应用私有目录 `files/pydroid-flow/` 创建 `settings/`、`user-code/`、`workflows/` 和 `logs/`，并将应用设置写入 `settings/app-settings.json`、个人函数模板写入 `user-code/templates.json`；Windows 桌面端在系统应用数据目录创建同名结构。工作流自动保存仍由平台 WebView/Chromium 的用户配置存储负责。
在移动端，工具箱列表的普通上下滑动不会开始拖拽；按住节点约 0.28 秒后才进入拖拽。
节点长按进入组合多选时，左上角显示选择框、右上角显示删除按钮；多选状态不会被普通
节点点击恢复为单选。节点落到 If 的左右分区或循环结构内部时，会自动成为对应分支/循环体。

矩阵热图支持 X/Y 刻度间隔、X 标签旋转、坐标原点、纵横比、插值方式、颜色上下限、
颜色条开关与标签，以及图片尺寸和 DPI。这些参数均由 Android、桌面端和 Notebook 导出
共同执行；“刻度间隔”按矩阵列/行计数，例如 2 表示每隔一个标签显示一次。

Android CSV 读取提供两套入口：标准入口使用系统 `ACTION_OPEN_DOCUMENT`，可访问所有已注册的
`DocumentsProvider`；“第三方 / SMB 文件”使用应用 Chooser，让支持 `ACTION_GET_CONTENT` 的文件管理器参与。
文件夹模式使用 SAF 树授权，SMB 文件管理器必须实现 `DocumentsProvider` 或树选择 Intent；否则应改用
第三方文件多选。选择结果统一交给 `io.read_csv_batch`，取消选择不会阻止下一次打开选择器。

执行内核会校验工作流、节点、边、文件数量与输入体积边界，保证日期和 NumPy/Pandas 标量
可安全序列化，并在绘图成功或失败后释放 Matplotlib Figure。Android 文件桥限制单文件
64 MiB、合计 128 MiB、单次最多 100 个文件，避免 Base64 桥接造成不可控的内存峰值。

顶部包图标打开 Python 包管理第一版：显示当前解释器版本和实际已安装包、维护工作流额外
依赖、预览/复制 pip 命令并导出 `requirements.txt`。依赖清单会随工作流 JSON、自动保存和
Notebook 一起持久化。桌面动态安装与 Android 构建依赖同步尚未开放，界面会把缺失项明确
标记为“待配置”，避免把不兼容的桌面 wheel 误装到 Android。

包管理把“应用功能包”和“运行时发行包”分开统计：应用直接提供 pandas、Matplotlib 两个
功能包；解释器检测到的其他发行包是依赖或运行时组件，可在折叠列表中查看。

逻辑控制现提供按行 `if`、双分支合流、`for range` 参数扫描和受最大迭代次数保护的数值
`while`。循环输出统一为 `iteration`/`value` 表格，因此可以直接连接表格、统计和绘图节点；
`while` 仅允许数值、算术、比较和布尔表达式，不执行任意 Python。绘图新增矩阵热图节点。

结构化循环提供 `For 子流程` 和 `While 子流程`：从 `body` 连接任意表格节点链，最后一个
节点回连 `continue`，结束后从 `done` 继续。For 逐行执行节点组，While 使用 pandas query
条件重复执行；普通环路仍会被拒绝，只有结构化循环的强类型回边合法。

`examples/ter-matrix.workflow.json` 是根据 `ter_matrix.py` 生成的完整多文件测试流程：文件
选择器可一次选中多个 `vg=*.csv`，批量读取节点用正则从文件名提取 `Vg_V`；TER 节点按
Vg 分文件识别升/降压方向、自动检测全局 Vds 范围与步长、计算长表，再透视为矩阵并生成
热图。`vmin`、`vmax`、`vstep` 和 `tolerance` 保持 0 时自动检测，也可手动覆盖；单文件
解析失败可以选择停止并报告，或跳过错误文件。

## 项目结构

- `src/`：共享 React 工作流编辑器、工作流模型与运行时接口
- `src/runtime/`：统一 Runtime Adapter、Python 适配器与内置 JavaScript 数据流引擎
- `src/ui/`：跨运行时结果展示组件（包含交互式 ECharts 图表）
- `python/pydroid_flow/`：Python 执行核心与平台入口
- `android/`：现有 Android/Capacitor/Chaquopy 实现
- `desktop/`：Windows Electron 主进程、预加载脚本和桌面执行适配器
- `docs/environment.md`：工具、安装位置及统一卸载清单
- `docs/desktop-development.md`：桌面端环境、开发、验证、打包与故障恢复指南
- `docs/progress.md`：可验证的里程碑、差异和待办
- `examples/`：可直接导入的版本化示例工作流

## 开发与验证

安装项目依赖：

```powershell
pnpm install
pnpm env:windows
```

Windows 上可以直接双击仓库根目录的 `Build PyDroid GUI.cmd`。RC10 构建器统一采用共享工具链：优先**只读复用** `DK_TOOL_ROOT`（推荐 `D:\Code`）中的 Node/JDK/Android SDK/Python。构建器不会向共享工具目录安装、更新或写入任何文件；缺失工具与临时运行时统一放入 `WorkRoot`（推荐 `D:\PyDroidTemp`）下的项目临时工具目录。pnpm/npm/Corepack/Electron/electron-builder/Gradle 下载缓存使用 `DK_CACHE_ROOT`；若未指定，则默认落到 `WorkRoot\cache`。网络层支持 Auto/Direct/Manual，代理会继续传给 pnpm 与 Electron；构建日志保存在输出目录的 `logs/`。Electron/electron-builder 不要求全局安装，具体版本仍由各项目 `package.json` 与 lockfile 决定。构建器同时兼容 native `pnpm.exe`、Corepack/JavaScript launcher 与传统 `pnpm.cmd`；清理 Electron/Android 构建输出时对 Windows 超长路径使用扩展长度路径与 `robocopy` 兜底，避免 PowerShell 5.1 在深层 `node_modules` 中因 `MAX_PATH` 中止构建；`pnpm check` 会先运行轻量构建工具回归测试。详见 `BUILD_TOOLCHAIN.md`。

运行全部便携检查：

```powershell
pnpm check
```

Windows 桌面端：

```powershell
pnpm desktop:dev
pnpm desktop:package
```

Windows x64 便携版输出到 `release/PyDroid Flow 0.1.0.exe`。它包含 Python 3.13、
pandas 和 Matplotlib，不要求目标电脑另行安装 Python。`release/` 是可再生成目录，不进入 Git。

Android 快速开发：

```powershell
pnpm android:live
pnpm android:live:lan
pnpm android:logs
pnpm android:sync
pnpm android:package
pnpm android:emulator
```

`pnpm desktop:dev` 对桌面 React/CSS/TypeScript 使用 Vite HMR。`pnpm android:live:lan`
会将调试 WebView 指向电脑的局域网 Vite 地址；第一次运行或原生层变化后使用
`powershell -ExecutionPolicy Bypass -File scripts/android-lan-live.ps1 -Install` 安装一次测试 APK，随后界面改动会即时推送。Android Java、Manifest、Gradle
依赖和 APK 内置 Python 不属于 Web 热更新范围，仍需增量重装；桌面 Python 每次执行使用新
子进程，可直接读取源码更新。Notebook AST 识别器位于
`python/pydroid_flow/notebook.py`，对应测试位于 `python/tests/test_notebook.py`。

Android 打包需要 JDK 21、Python 3.13、Android SDK platform 36，以及 ARM64
设备或模拟器。Windows 开发和打包使用项目内 `.tools/python313-runtime/`，该运行时会
连同桌面安装包发布；开发时也可以通过
`PYDROID_PYTHON_EXECUTABLE` 指定其他 Python 3.13 可执行文件。
`android:package` 优先使用 `JAVA_HOME`，否则使用项目内 `.tools/jdk-21/`，debug APK
输出到 `android/app/build/outputs/apk/debug/app-debug.apk`。
本机 x86_64 模拟器通过 Google APIs 镜像的 NDK translation 运行 ARM64-only APK，
不会给应用增加 x86_64 ABI。项目结束时运行 `pnpm android:emulator:remove` 删除该 AVD
及其项目本地 SDK；此操作不会删除源码或项目 JDK。

Linux/云环境可运行：

```bash
bash scripts/cloud-check.sh
```

## 跨设备开发约束

每台设备和每位开发者都必须遵守根目录 `AGENTS.md`：保持平台功能对等，不把本机路径
写入仓库，不修改桌面任务范围之外的 Android 实现，并在安装任何额外软件前维护环境
清单。环境清理方式见 `docs/environment.md`。

## Git 工作流

- 默认分支为 `main`，功能开发使用 `codex/` 前缀分支。
- 不提交密钥、本机路径、`node_modules`、`.tools`、SDK、构建产物或缓存。
- 提交前运行 `pnpm check`；平台安装包还需执行相应的本机打包与设备验收。
- 一个提交只处理一个可说明的目标，并同步更新进度与环境文档。
### Developer references

- AI Agent planning/validation contract: `docs/AI_AGENT_CONTRACT.md`
