## 2026-08-17 — Build GUI RC10 Android PowerShell fix

- Windows desktop packaging is confirmed by user log to complete through Electron packaging plus desktop smoke tests.
- Fixed Android startup failure `无法覆盖变量 Home，因为该变量为只读变量或常量` by renaming Java helper parameters away from PowerShell automatic `$HOME`.
- Added a static build-tool regression guard for read-only `$HOME` collisions; shared tool/cache/network behavior remains based on RC9.

## 2026-08-17 — Build GUI RC9 unified shared toolchain

- Unified the RC5-RC8 launcher/network/native-pnpm fixes with the cross-project `DK_TOOL_ROOT` / `DK_CACHE_ROOT` shared toolchain.
- Shared caches now include pnpm, npm, Corepack, Electron, electron-builder, Gradle and downloads; project package versions remain local and lockfile-controlled.
- Hardened JDK selection by validating the requested major version and activating that JDK before Android `sdkmanager`; added the legacy native-`pnpm.exe` workspace compatibility patch and path-with-spaces handling for Python installation.
- Sandbox validation: build-tool Node smoke passed, all project `.mjs`/`.cjs` syntax checks passed, PowerShell lexical/balance regression checks passed, collection-output/`$args` regressions are absent, and `git diff --check` passed. Full WinForms/Electron/Android packaging still requires Windows local validation.

## 2026-08-17 — Build GUI RC8 local compile compatibility

- RC7 Windows 日志确认 `Manual` 代理 `http://127.0.0.1:7890` 已正确传入，pnpm install 直接命中缓存并在 54 ms 完成，网络层本轮通过。
- 修复 `scripts/desktop-package.mjs` 将 native `pnpm.exe` 错交给 `node.exe` 导致 `ERR_UNKNOWN_FILE_EXTENSION .exe`；包管理器启动方式现按实际 launcher 类型选择。
- 修复 `src/dialogs.tsx` 的 `<details defaultOpen>` React/TypeScript 类型错误，并增加无依赖 build-tools smoke test 防止 pnpm launcher 回归。
- Sandbox 已完成 Node 语法检查、build-tools smoke、36 个 TS/TSX 文件语法转译、`git diff --check`；依赖完整的 `desktop:build`/Electron/Android 打包仍需 Windows 本机验证。

## 2026-08-17 — Build GUI RC7 network compatibility

- RC6 local validation exposed pnpm `TimeoutError` during `pnpm install`. Root cause in the wrapper: it did not explicitly bridge the user's Windows/system proxy into pnpm/Electron child processes.
- Added Auto/Direct/Manual network modes, Windows fixed-proxy detection, manual proxy and registry fields, request timeout/network concurrency controls, persistent-store `--prefer-offline`, whole-install retry, and Electron proxy environment propagation.
- Still requires Windows local validation because this sandbox cannot run WinForms or perform the dependency-backed Windows/Android package build.


> **1.4.9o**：顶部“新建”现在可选择当前标签页新建或新建标签页；未保存修改在当前页重建与标签关闭前均提供保存/不保存/取消，保存后未修改则直接关闭。标签切换会保留当前会话内各自工作流状态。
- 1.4.9n Android：空白画布触摸改为 10 px 平移阈值 / 520 ms 长按框选的互斥手势状态机，避免框选时 viewport 继续移动；移除固定 null 的 restoredSnapshot 可选链，修复首次 TypeScript 构建的 nodes/edges/requirements `never` 错误。
# 项目进度与平台一致性

更新时间：2026-08-17

## 版本记录要求

所有用户可见功能、修复和 APK 版本更新都必须同步更新 `CHANGELOG.md`、`README.md` 与本文件；
Android 的 `versionName` / `versionCode` 必须对应同一条记录。未经记录的改动不得交付。

## 已完成

- `1.4.9 (32)` 设置/SMB UI 收口（`refactor/settings-smb-ui`，待本地编译验证）：设置窗口改为宽屏双列、窄屏单列的自适应卡片布局，并统一主题滚动条；SMB 重写为设备/共享树 + 地址面包屑 + 可折叠连接设置 + 文件列表的文件管理器结构，底层 SMB API 与凭据安全模型不变。新增 `AGENTS.md` 和 `docs/development-handoff.md` 作为跨会话开发入口。
- Runtime Adapter 架构重构（`refactor/runtime-architecture`，待本地完整编译/Android 验证）：149p UI 与 Python 执行保持为基线；原 JS 分支的纯 TypeScript 数据流引擎迁回 `src/runtime/javascript/engine/`；统一运行时注册、自动兼容性回退、共享结果协议与 ECharts 交互图表已接入，旧 JS 分支不再作为第二套应用继续同步 UI。
- `1.4.9` 候选 UI 修复：参数/资源面板标题统一并显示节点名称，资源栏最小宽度固定到可完整显示三类标签；DataGrid 工具按钮按实际内容分配宽度；移动端标签指示线与顶部按钮底端对齐，桌面指示线进一步细化。
- `1.4.8 (31)`：组合接口从跨边界连线和内部未占用端口共同推导，旧 0 端点组合自动修复；完成组合与框选选择同步，框选期间隐藏连线和删除叉号；资源节点/组合增加右键操作，组合名称卡片和桌面分类拖拽动画完成重做。
- `1.4.7 (30)`：SMB 设备卡显示共享与 IP，文件选择器采用多行分步 UI，支持访客登录、密码显隐和统一可读错误；设置页只保留明确的“选择 SMB 文件”入口；桌面鼠标支持从连线端点拖到空白处断开或拖到兼容端口改接；校准断开按钮并收敛资源栏宽度与颜色。
- `1.4.6 (29)`：逻辑容器自动扩高和独立标题层、亮色逻辑/组合辨识、窄栏表格重排；连线显式断开控件；节点/组合/流程统一拖入动画；Android 与 Windows 实现局域网 SMB 设备发现、加密凭据、共享扫描、目录浏览和多文件读取。

- `1.4.5 (28)`：结果停靠图标、固定边缘手柄和窄栏表格响应式布局；逻辑结构换向重排与节点图像居中；Notebook 完整导出 If/For-each/While 并修复 Python 名称覆盖；桌面 UTF-8 与可配置字节打印；易断开的类型连线和跨容器错误定位；AI Agent 增加真实组合、断线、整理及节点化文档；桌面圆形图标与亮色细节统一。

- `1.4.4 (27)`：桌面 IPC Base64 帧修复复杂参数 JSON 解析；SMB 设置持久化、Keystore 密码与共享扫描；触屏/鼠标交互分流；端点尺寸、多类型弹窗输入、断点单步调试、失败节点红框和部分结果保留；补充五类绘图节点、桌面统一图标以及逻辑 Demo 的执行和 Notebook 往返测试。

- `1.4.3 (26)`：桌面错误协议结构化并保留部分结果/红框/调试堆栈；桌面加入局域网网页托管；Notebook 行号与逻辑 AST 容器转换；重做数据网格；加入调试模式、通用文件读取、DataFrame 转换和 print 参数；完善亮色主题与端口文字。

- `1.4.2 (25)`：修复 print stdout 污染 IPC JSON；错误可展开复制和定位且节点保持红框；表格升级为筛选/排序/分页/复制数据网格；连线按输入输出类型渐变；补齐相关亮色 UI；Notebook 支持整本和逐单元运行；扩展 AST 转换识别；增加 Android 局域网前端 HMR 脚本和设置说明。
- `1.4.1 (24)`：空流程 Notebook 不生成残留单元格；历史 Python 字面量参数安全兼容且 JSON 错误不再击穿 IPC；逻辑结构完成亮色适配；节点结果可双击编辑复制；整理后自动回到当前可见层级；打印覆盖常见 Python/pandas/NumPy 类型；连线按类型配色；增加八个可无损导出 Jupyter 的类型转换节点。
- `1.4.0 (23)`：历史入口移至底部右侧；Android 文件入口精简为文件、文件夹和内置 SMB，内置 SMB 2/3 支持目录浏览、CSV 多选及整目录导入；修复 Notebook 自动高度导致的滚动回弹及新建流程未清理 Notebook 状态；加深亮色收起文字并统一包管理字号/颜色；新增周期震荡脉冲基础节点、AST 转换和无代码块示例；新增经 Python 核心执行验证的 If/While/For 子流程 Demo。
- `1.3.9 (22)`：统一参数栏和设置界面字号；底部增加可恢复、撤销、重做和清空的历史记录；支持拖入 CSV、工作流 JSON 与 ipynb；移除桌面系统菜单并修复 Notebook 分析 IPC 和 Electron 全进程实时内存；修复侧栏收起遮挡，优化纵向节点宽高、行距、端口类型字号及 Notebook 单元格自适应高度；移除 SMB DocumentsProvider 常驻说明。
- `1.3.8 (21)`：桌面/网页框选支持右键批量组合、断线和删除，并增加 Delete/Backspace、Ctrl+A、Esc；拖入节点以指针为中心落点；节点真实尺寸、整理、方向及外观变化会强制刷新端口坐标，解决切换方向才恢复连线的问题；补齐亮色菜单、参数字体、设置滚动详情、节点大小/线宽及不含密钥的设置导入导出。共享 Web 层同步覆盖 Android。

- `1.3.7 (20)`：画布已有连线、新建连线和拖拽预览统一为连续贝塞尔路由；纵向节点中心略有偏差时不再出现短横线/直角折返，路径端点和转角使用圆角渲染。Web、Windows 和 Android 共用该修复；Windows Node.js 24 的桌面开发启动 `spawn EINVAL` 同步修复。

- `1.3.6 (19)`：依据 OPPO/金标联盟文件 Picker 指南实现系统 `OPEN_DOCUMENT` 与第三方 `GET_CONTENT` Chooser 双入口，CSV 多选支持持久 URI 和最多 100 个文件；文件夹提供系统/第三方入口并检测 SMB DocumentsProvider 树 URI；补全 Manifest Intent 查询声明。Windows 修复 OneDrive 联接令渲染文件漏出 `app.asar`、成品启动纯色无 UI 的根因，增加真实目录暂存、GPU 兼容模式、渲染日志、启动恢复页及打包后 UI/IPC/Python 强制测试。Android debug APK 已从成品 manifest 核验三类 Picker Intent 与 `1.3.6 (19)` 版本。

- `1.3.5 (18)`：弹窗提示改为可靠的执行前阻塞交互，支持可编辑/隐藏的 True、False、None 按钮，选择值成为节点输出；多个弹窗输入与提示按拓扑顺序逐个执行；Jupyter 使用纯 Python `input()` 保持三值选择语义。完整 `pnpm check` 通过（Web 33 通过/1 跳过、Python 53 通过、桌面桥接 4 通过），Android debug APK 已构建并核验 manifest 为 `1.3.5 (18)`。

- `1.3.4 (17)`：Notebook、按钮、参数控件与辅助文字完成亮色主题覆盖；弹窗提示节点执行后按顺序显示；纵向画布连线改用平滑折线路由并提升明暗主题对比度。完整 `pnpm check` 通过（Web 33 通过/1 跳过、Python 50 通过、桌面桥接 4 通过），桌面 Electron/IPC/Python 多文件启动烟雾测试通过；Android debug APK 已完成构建并核验 manifest 版本为 `1.3.4 (17)`。

- `1.3.3 (16)`：网页首次配对后同步 Android 主题/布局/AI 配置；AI 密钥使用 Android Keystore AES-GCM 加密，已配对网页仅作内存同步；横屏参数栏高度可调、资源栏固定头部、亮色按钮图标修复；Pulse 脉冲生成/三通道对齐/测量分段节点及等价 Jupyter Python 导出。完整 `pnpm check` 通过（Web 33 通过/1 跳过、Python 50 通过、桌面桥接 4 通过）；1.3.3 APK 已安装至 Android API 36 模拟器完成亮色和横屏启动检查。

- 共享 React 节点编辑器和版本 1 工作流格式
- 33 个节点及共享 pandas/Matplotlib 执行核心
- Android Capacitor 工程、Chaquopy 适配器和已同步 Web 资源
- Windows Electron 工程、受隔离的预加载 API、Python 子进程适配器和便携运行时
- Web 与 Python 单元测试、GitHub Actions Android 构建流程
- 跨设备环境台账、清理方法与项目规则
- `1.3.2 (15)`：可保存节点/组合资源与共享内核子流程展开；TER 样例无代码节点化；节点级富结果检查器；旋转侧边栏拖拽边缘和亮/暗设置抽屉适配
- `1.3.1 (14)`：186 个工作区 Notebook 批量转换为仅含默认节点的流程；新增实验周期处理节点与内置组合；设置入口改为细线滑杆图标
- `1.3.0 (13)`：重制亮/暗主题弹窗；流程资源支持长按/右键重命名、删除、锁定和跳转文件夹；print 节点逐条保留并展示输出；设置入口改为三滑杆图标
- `1.2.9 (12)`：AI 多供应商预设与连接测试、弹窗交互节点、节点/组合/流程抽屉、用户可选流程文件夹扫描、亮色主题补全

## 当前验证状态

- OneDrive 源码完整读取：通过，82 个源码/配置文件读取失败数为 0
- Web 单元测试：通过，38/38（另有 1 项仅在配置 `PYDROID_NOTEBOOK_CORPUS` 后启用）
- Python 单元测试：通过，66/66
- 桌面桥接专项测试：通过，6/6
- Web 与 Windows 渲染层生产构建：通过
- Windows Electron 源码端到端冒烟测试：通过
- Windows x64 自包含便携包：通过，`PyDroid Flow 1.3.7.exe`，137,831,608 字节
- Windows 打包后 Electron→IPC→内置 Python 冒烟测试：通过，退出码 0
- Windows 完整人工交互验收：待完成
- Android ARM64 debug APK 本机构建：通过，67,366,580 字节；APK 内仅含 `arm64-v8a`
- Android API 36 模拟器 ARM 转译验收：通过；ARM64-only APK 安装、冷启动及 CSV→分组→图表→导出链路成功
- 通用节点交互第一阶段：完成鼠标右键/触摸长按菜单、端口数据类型、环路与类型冲突连线校验
- 自定义 Python 函数节点基础版：完成从函数类型标注生成输入/输出端口和标量参数，并由共享 Python 核心执行
- 自定义函数签名第二阶段：支持 `Optional`/`T | None`、`list[T]`、`Literal[...]`、`tuple[...]` 多输出及四个内置模板
- Android 多输出执行验收：通过 Capacitor→Chaquopy 桥接执行双输出工作流，`sourceHandle=output2` 正确导出第二路表格
- 自定义节点第三阶段：支持 `tuple['name:type', ...]` 命名输出、全屏代码编辑和即时签名摘要
- 个人模板：支持本地保存、删除及版本化 `pydroid-flow.custom-node-template` JSON 导入/导出；Android 本地持久化验收通过
- Android 命名端口验收：`remaining` source handle 经 Capacitor→Chaquopy 正确路由并导出第二列
- 移动端易用性回归：窄屏隐藏遮挡画布的缩略图；加载工作流时自动修复非有限或超范围节点坐标
- 参数与结果易用性：节点标题/端口分区避免重叠；布尔值使用开关，有限数值支持滑块；参数面板可收起，缩略图按空间和节点数自动显隐
- 折线图配置：支持 X/Y 列、标题、坐标标签、图例、网格、对数轴、线型、标记、画布尺寸和 DPI；结果图支持悬浮层缩放
- 数据处理扩展：新增重命名列，以及 `dropna`、`fillna`、`sort_values`、`query` 四个常用 Pandas 节点
- 逻辑控制第二阶段：按行条件分支具有 `true`/`false` 强类型输出并可双路合流；新增 `for range` 参数扫描和带表达式白名单、最大次数保护的数值 `while`
- 执行体验：Android 原生插件支持启动预热 Python，运行按钮会等待预热；可选实时预览会在参数变化后防抖重算
- Android 本轮虚拟机验收：冷启动预热成功，首次单击运行即得到 2×2 表格和折线图；Plot 全部 15 项参数、实时滑块重算、图表悬浮缩放、侧栏收起/恢复及移动端缩略图自动隐藏均通过
- 节点偏好默认值：使用参数级白名单保存，仅影响以后新建的同类节点；Android 已验证 Plot 线宽/DPI 被复用而 X/Y 列保持空白
- 结果面板布局：支持右侧/底部停靠、右侧宽度和底部高度调节；窄屏自动重排参数区、画布和结果区
- 节点视觉密度：卡片由 210×72 调整为 184×62，函数名字号增至 10px、中文名增至 14px，并缩短端口留白
- `pandas.read_csv` 签名清单：提供 35 个可执行参数、基础/高级折叠分组和原始字节编码解码；不兼容的文件源、迭代器及回调参数会在界面明确说明
- 函数发现与注册：支持中文/调用名/说明/标签模糊搜索；新增 6 个官方 pandas DataFrame 方法和 2 个 Python 内置函数节点，每个节点提供签名布局和官方文档入口
- 逐节点结果：共享执行核心返回每个节点的表格、绘图或标量摘要；画布节点上方可显示并统一隐藏，不进入持久化工作流
- 组织与布局：默认流程扩展到 6 个节点；支持按屏幕宽度紧凑蛇形整理、节点自定义标签和持久化常用分组
- 响应式节点卡片：移动/常规屏幕使用 168×58、11px 函数名和 15px 中文名，宽屏自动提升到 184×62、12px/16px
- 画布工具：撤销/重做使用统一 SVG；整理布局与节点结果显隐使用图标、短标签和“结果开/关”状态，降低首次使用猜测成本
- 矩阵热图：支持行标签列、标题、轴标签、颜色条、配色、尺寸和 DPI，并返回可放大的逐节点图像结果
- TER 多文件流程：文件选择器、Android/Windows 桥接及 Python 核心支持多 CSV；批量读取节点从文件名提取 Vg，内置 TER 节点逐 Vg 识别扫描并输出长表、矩阵、双 CSV 和热图
- 多导出结果：执行协议保留每个导出节点的文件名和 CSV 内容，结果区可分别下载 `TER_long.csv` 与 `TER_matrix.csv`
- Android 新界面验收：ARM64-only APK 安装成功，冷启动显示 29 个节点及新版符号/画布工具栏；ARM 转译模拟器仍偶发 System UI 无响应，应用进程无崩溃日志
- 双视图第一阶段：节点图与 `# %%` Notebook DSL 可双向转换和编辑；节点、连线、参数、位置及依赖清单均参与 schema 校验和往返测试
- 包管理第一阶段：Windows/Android 共享接口可读取实际 Python 版本与已安装发行包；支持工作流 requirements、pip 命令预览及 requirements.txt 导出，动态安装仍待兼容策略完成
- Android 系统栏适配：主题、WebView、状态栏和导航栏统一深色；软键盘采用 resize。源码修复已完成，本轮 APK 尚待重新打包验收
- 可变节点与方向布局：节点宽度随中文名在 168–270px 自适应并完整换行；支持横向/纵向/自动方向，纵向端口切到上下并刷新连线路径
- Python Notebook 第二阶段：JSON 单元格替换为 pandas/NumPy/Matplotlib Python `# %%` 代码，支持参数回写和 nbformat 4 `.ipynb` 导出
- 包计数澄清：区分 2 个应用功能包与解释器运行时发行包，并提供完整依赖折叠清单
- CSV 入口调整：移除顶栏常驻选择按钮；读取节点参数区提供单/多文件选择，运行缺文件时自动打开选择器
- 结构化逻辑子图：For/While 子流程提供 `body`、`continue`、`done` 端口；仅允许受控回边，可逐行或按 query 条件重复执行表格节点链
- 本轮 Android 打包：待验证；当前 APK 不包含以上最新改动
- Android ARM64 真机：待复验（当前无 adb 设备）
- Windows 新版桌面基线：Web 23/23、共享 Python 30/30、桌面桥接 4/4、桌面生产构建及 Electron 源码冒烟均通过
- Windows Electron 新增协议冒烟：通过实际 IPC 验证 Python 环境读取、双 CSV 批量输入、逐节点结果及两个独立 CSV 导出
- Windows x64 新版便携包：已生成，`PyDroid Flow 1.3.7.exe`，137,831,608 字节；打包后 UI/多文件/多导出冒烟通过，并核验成品包含新版贝塞尔连线资源，完整业务交互仍待完成

## 平台一致性原则

节点目录、工作流结构和 Runtime Adapter 是功能一致性的共同来源。Python 与 JavaScript 运行时必须返回统一结果结构，平台宿主只负责文件、SMB、IPC/Native Bridge 等设备能力，不得改变节点含义。新增节点时必须声明运行时兼容性并同时验证 Android 和 Windows；无法同步交付时，要在本文件记录差异、原因和补齐计划。

## 下一里程碑

1. 本地完整编译并人工验收 `refactor/settings-smb-ui`：设置窗口、SMB 文件管理器、亮/暗主题、Android 横竖屏与 Windows 桌面端。
2. 将验证通过的设置/SMB UI 收口回 `refactor/runtime-architecture`。
3. 新建临时重构分支，引入 `PlatformAdapter`，把 SMB、文件选择、配置目录和局域网宿主能力从 `execution.ts` 兼容门面中抽离。
4. Platform Adapter 稳定后拆分 Workflow Core：文档模型、会话、多标签 dirty 状态、序列化和 transaction history。
5. 将运行时兼容性变成节点元数据，使节点添加/连线阶段即可预知 Python/JavaScript 支持情况；随后再扩展 JS parity 与调试器。

最近移动端基线：1.4.9p 已恢复双指缩放并完善标签关闭交互；本分支不应回退这些手势能力。
