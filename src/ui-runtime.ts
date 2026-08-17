type UiLanguage = "zh-CN" | "en";

const SETTINGS_KEY = "pydroid-flow.settings.v1";

const ENGLISH: Record<string, string> = {
  "设置": "Settings",
  "界面、运行时与平台配置": "Interface, runtime and platform configuration",
  "外观": "Appearance",
  "主题与语言": "Theme and language",
  "主题": "Theme",
  "语言": "Language",
  "跟随系统": "Follow system",
  "暗色模式": "Dark",
  "亮色模式": "Light",
  "中文": "Chinese",
  "当前生效：暗色": "Active: dark",
  "当前生效：亮色": "Active: light",
  "执行引擎": "Execution engine",
  "选择工作流默认运行环境": "Choose the default workflow runtime",
  "工作流运行时": "Workflow runtime",
  "自动选择（推荐）": "Auto (recommended)",
  "完整兼容": "full compatibility",
  "实验": "experimental",
  "画布": "Canvas",
  "尺寸、线条与面板布局": "Size, lines and panel layout",
  "节点尺寸": "Node size",
  "端点大小": "Endpoint size",
  "连线粗细": "Edge width",
  "左侧节点栏": "Left palette",
  "右侧参数栏": "Right inspector",
  "横屏参数栏": "Landscape inspector",
  "结果区高度": "Result height",
  "缩略图": "Minimap",
  "默认隐藏": "Hidden by default",
  "自动显示": "Auto",
  "始终显示": "Always show",
  "显示节点运行结果": "Show node results",
  "调试": "Debug",
  "网络文件": "Network files",
  "局域网文件": "LAN files",
  "浏览网络设备、共享和文件夹": "Browse network devices, shares and folders",
  "网络": "Network",
  "扫描设备": "Scan devices",
  "尚未发现设备": "No devices found",
  "正在扫描设备…": "Scanning devices…",
  "连接设置": "Connection",
  "配置": "Configure",
  "服务器": "Server",
  "共享名": "Share",
  "域（可选）": "Domain (optional)",
  "用户名": "Username",
  "密码": "Password",
  "访客": "Guest",
  "登录": "Login",
  "连接中…": "Connecting…",
  "重新读取共享": "Reload shares",
  "名称": "Name",
  "类型": "Type",
  "大小": "Size",
  "文件夹": "Folder",
  "刷新": "Refresh",
  "取消": "Cancel",
  "导入此文件夹": "Import this folder",
  "导入所选": "Import selected",
  "安全保存密码": "Securely save password",
  "收藏当前位置": "Favorite current location",
  "删除收藏": "Remove favorite",
  "暂无收藏": "No favorites yet",
  "本节点结果": "Node result",
  "双击展开": "Double-click to expand",
  "节点标签": "Node label",
  "加入分组": "Add to group",
  "保存为默认": "Save as default",
  "恢复内置默认": "Restore built-in defaults",
  "编辑参数": "Edit parameters",
  "保存为我的节点": "Save as my node",
  "复制节点": "Duplicate node",
  "替换功能…": "Replace function…",
  "断开连线": "Disconnect edges",
  "删除节点": "Delete node",
  "AI Agent 设置": "AI Agent settings",
  "AI 只提出计划；画布变更仍需确认": "AI proposes a plan; canvas changes still require confirmation",
  "模型与连接": "Model and connection",
  "供应商": "Provider",
  "协议": "Protocol",
  "接口地址": "Endpoint",
  "模型": "Model",
  "选择或自定义模型": "Select or enter a model",
  "自定义模型": "Custom model",
  "API 密钥": "API key",
  "规划语言": "Planning language",
  "尝试连接": "Test connection",
  "测试中…": "Testing…",
  "AI 权限": "AI permissions",
  "创建节点": "Create nodes",
  "组合节点": "Group nodes",
  "修改参数与标签": "Edit parameters and labels",
  "创建连线": "Create edges",
  "整理布局": "Arrange layout",
  "执行工作流": "Run workflow",
  "创建计划": "Create plan",
  "请求 AI 计划": "Request AI plan",
  "AI 正在规划…": "AI is planning…",
  "计划预览": "Plan preview",
  "检查计划": "Validate plan",
  "确认并应用": "Confirm and apply",
  "审计": "Audit",
  "尚无 AI 操作记录。": "No AI operations yet.",
  "运行": "Run",
  "停止": "Stop",
  "新建": "New",
  "打开": "Open",
  "保存": "Save",
  "导出": "Export",
  "关闭": "Close",
  "确定": "OK",
  "返回主流程": "Back to main flow",
  "显示节点": "Show nodes",
  "显示参数": "Show inspector",
};

const NORMALIZE_ZH: Record<string, string> = {
  "AI 规划语言": "语言",
  "界面语言": "语言",
  "主题与 AI 规划语言": "主题与语言",
  "主题与界面语言": "主题与语言",
  "打开共享": "登录",
};

const originalText = new WeakMap<Text, string>();
const lastAppliedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
let currentLanguage: UiLanguage = "zh-CN";
let observer: MutationObserver | null = null;

function readLanguage(): UiLanguage {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { agent?: { language?: string } };
    return saved.agent?.language === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function translateExact(value: string, language: UiLanguage): string {
  const normalized = NORMALIZE_ZH[value] ?? value;
  return language === "en" ? ENGLISH[normalized] ?? normalized : normalized;
}

function translateTextValue(value: string, language: UiLanguage): string {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length);
  if (!core) return value;
  return `${leading}${translateExact(core, language)}${trailing}`;
}

function shouldSkipText(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest("script,style,code,pre,textarea,[contenteditable='true'],.node-result-value,.data-grid tbody"));
}

function applyTextNode(node: Text, language: UiLanguage): void {
  if (shouldSkipText(node)) return;
  if (!originalText.has(node)) originalText.set(node, node.data);
  const source = originalText.get(node) ?? node.data;
  const translated = translateTextValue(source, language);
  lastAppliedText.set(node, translated);
  if (node.data !== translated) node.data = translated;
}

const TRANSLATED_ATTRIBUTES = ["aria-label", "title", "placeholder"] as const;
function applyAttributes(element: Element, language: UiLanguage): void {
  let originals = originalAttributes.get(element);
  if (!originals) {
    originals = new Map<string, string>();
    originalAttributes.set(element, originals);
  }
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;
    if (!originals.has(attribute)) originals.set(attribute, value);
    const source = originals.get(attribute) ?? value;
    const translated = translateExact(source, language);
    if (value !== translated) element.setAttribute(attribute, translated);
  }
}

function applyTree(root: Node, language: UiLanguage): void {
  if (root.nodeType === Node.TEXT_NODE) {
    applyTextNode(root as Text, language);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment) && !(root instanceof Document)) return;
  if (root instanceof Element) applyAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let next: Node | null = walker.nextNode();
  while (next) {
    if (next.nodeType === Node.TEXT_NODE) applyTextNode(next as Text, language);
    else if (next instanceof Element) applyAttributes(next, language);
    next = walker.nextNode();
  }
}

function setUiLanguage(language: UiLanguage): void {
  currentLanguage = language;
  document.documentElement.lang = language;
  document.documentElement.dataset.uiLanguage = language;
  if (document.body) applyTree(document.body, language);
}

function languageFromOption(target: EventTarget | null): UiLanguage | null {
  const option = target instanceof Element ? target.closest("[role='option']") : null;
  if (!option) return null;
  const listbox = option.closest("[role='listbox']");
  const label = listbox?.getAttribute("aria-label") ?? "";
  if (!/(^语言$|界面语言|AI 规划语言|规划语言|^Language$|Interface language|Planning language)/i.test(label)) return null;
  const value = option.textContent?.trim() ?? "";
  if (/^English$/i.test(value)) return "en";
  if (/^(中文|Chinese)$/i.test(value)) return "zh-CN";
  return null;
}

function dismissFloatingNodeMenus(target: EventTarget | null): void {
  const element = target instanceof Element ? target : null;
  if (element?.closest(".context-menu")) return;
  document.querySelectorAll<HTMLElement>(".context-menu").forEach((menu) => menu.classList.add("runtime-dismissed"));
}

function openInteractiveNodePlotFromDoubleClick(event: MouseEvent): void {
  const element = event.target instanceof Element ? event.target : null;
  const inspector = element?.closest(".node-result-inspector");
  if (!inspector || !inspector.querySelector(".plot-view")) return;
  const button = inspector.querySelector<HTMLButtonElement>(".plot-preview-button");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
}

export function installUiRuntime(): void {
  if (typeof document === "undefined") return;
  currentLanguage = readLanguage();

  const start = () => {
    setUiLanguage(currentLanguage);
    observer?.disconnect();
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          const node = record.target as Text;
          const previousRendered = lastAppliedText.get(node);
          if (previousRendered !== undefined && node.data !== previousRendered) {
            originalText.set(node, node.data);
          }
          applyTextNode(node, currentLanguage);
        }
        for (const node of record.addedNodes) applyTree(node, currentLanguage);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  document.addEventListener("pointerdown", (event) => dismissFloatingNodeMenus(event.target), true);
  document.addEventListener("touchstart", (event) => dismissFloatingNodeMenus(event.target), { capture: true, passive: true });
  document.addEventListener("dblclick", openInteractiveNodePlotFromDoubleClick, true);
  document.addEventListener("contextmenu", () => {
    requestAnimationFrame(() => document.querySelectorAll<HTMLElement>(".context-menu").forEach((menu) => menu.classList.remove("runtime-dismissed")));
  }, true);
  document.addEventListener("click", (event) => {
    const language = languageFromOption(event.target);
    if (language) requestAnimationFrame(() => setUiLanguage(language));
  }, true);
}
