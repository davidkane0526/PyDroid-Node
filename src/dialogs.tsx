import { useEffect, useRef, useState } from "react";
import { AGENT_PRESETS, presetById, type AgentPlan, type AgentSettings } from "./agent";
import type { ExecutionResult, NodeExecutionPreview, RuntimePreference, TablePreview } from "./execution";
import type { WorkflowNode } from "./workflow";
import { DataGrid, resultPreviewText } from "./components";
import { PlotPreview } from "./ui/PlotPreview";
import { APP_VERSION } from "./app-version";
import type { AutomatedDiagnosticReport } from "./diagnostics/automated-debug";
import { CANVAS_THEMES, type CanvasThemeId } from "./canvas-theme";
import type { McpServerInfo } from "./platform";

export type HistoryEntry = { id: number; at: Date; summary: string };
export type ResultDetail = { title: string; text: string; preview?: TablePreview };
export type ReplacementCandidate = { nodeType: string; label: string; inputPorts: { valueType: string }[]; outputPorts: { valueType: string }[] };
export type ExecutionErrorView = { title: string; nodeType?: string; nodeId?: string; message: string; traceback?: string | null };


type ThemedSelectOption = { value: string; label: string };

function ThemedSelect({ value, options, onChange, ariaLabel }: { value: string; options: ThemedSelectOption[]; onChange: (value: string) => void; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return <div className={`themed-select ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="themed-select__trigger" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? value}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button>
    {open && <div className="themed-select__menu" role="listbox" aria-label={ariaLabel}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>}</button>)}</div>}
  </div>;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "确定", cancelLabel = "取消", danger = false, onConfirm, onCancel }: { open: boolean; title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return <div className="settings-backdrop modern-confirm-backdrop" role="dialog" aria-modal="true" aria-label={title} onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="modern-confirm-dialog">
      <header><span className={`modern-confirm-dialog__icon ${danger ? "danger" : ""}`} aria-hidden="true">{danger ? "!" : "◇"}</span><div><strong>{title}</strong><small>{danger ? "此操作需要确认" : "请确认后继续"}</small></div><button type="button" className="modern-confirm-dialog__close" aria-label="关闭" onClick={onCancel}>×</button></header>
      <div className="modern-confirm-dialog__content"><p>{message}</p></div>
      <footer><button type="button" className="button secondary" onClick={onCancel}>{cancelLabel}</button><button type="button" autoFocus className={`button ${danger ? "danger-confirm" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button></footer>
    </section>
  </div>;
}


export function NewWorkflowDialog({ open, onCurrentTab, onNewTab, onCancel }: { open: boolean; onCurrentTab: () => void; onNewTab: () => void; onCancel: () => void }) {
  if (!open) return null;
  return <div className="settings-backdrop modern-confirm-backdrop" role="dialog" aria-modal="true" aria-label="新建工作流" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="modern-confirm-dialog workspace-choice-dialog">
      <header><span className="modern-confirm-dialog__icon" aria-hidden="true">＋</span><div><strong>新建工作流</strong><small>选择新工作流的打开方式</small></div><button type="button" className="modern-confirm-dialog__close" aria-label="关闭" onClick={onCancel}>×</button></header>
      <div className="workspace-choice-dialog__choices">
        <button type="button" className="workspace-choice-card" onClick={onCurrentTab}><span className="workspace-choice-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z"/><path d="M9 9h6M9 13h6"/></svg></span><span><strong>当前页面新建</strong><small>保留当前标签页，在这里创建空白工作流</small></span><svg className="workspace-choice-card__arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button>
        <button type="button" className="workspace-choice-card" onClick={onNewTab}><span className="workspace-choice-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h10v12H4z"/><path d="M10 4h10v12h-2M15 7v6M12 10h6"/></svg></span><span><strong>新建标签页</strong><small>保留当前工作流，并在新的标签页中开始</small></span><svg className="workspace-choice-card__arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button>
      </div>
      <footer><button type="button" className="button secondary" onClick={onCancel}>取消</button></footer>
    </section>
  </div>;
}

export function UnsavedChangesDialog({ open, title, message, onSave, onDiscard, onCancel }: { open: boolean; title: string; message: string; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  if (!open) return null;
  return <div className="settings-backdrop modern-confirm-backdrop" role="dialog" aria-modal="true" aria-label={title} onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="modern-confirm-dialog unsaved-changes-dialog">
      <header><span className="modern-confirm-dialog__icon warning" aria-hidden="true">●</span><div><strong>{title}</strong><small>检测到尚未保存的修改</small></div><button type="button" className="modern-confirm-dialog__close" aria-label="关闭" onClick={onCancel}>×</button></header>
      <div className="modern-confirm-dialog__content"><p>{message}</p></div>
      <footer><button type="button" className="button secondary" onClick={onCancel}>取消</button><button type="button" className="button unsaved-discard" onClick={onDiscard}>不保存</button><button type="button" autoFocus className="button primary" onClick={onSave}>保存</button></footer>
    </section>
  </div>;
}

export function TextPromptDialog({ open, title, label, value, confirmLabel = "保存", onValueChange, onConfirm, onCancel }: { open: boolean; title: string; label: string; value: string; confirmLabel?: string; onValueChange: (value: string) => void; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return <div className="settings-backdrop modern-confirm-backdrop" role="dialog" aria-modal="true" aria-label={title} onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="modern-confirm-dialog modern-prompt-dialog">
      <header><span className="modern-confirm-dialog__icon" aria-hidden="true">✎</span><div><strong>{title}</strong><small>{label}</small></div><button type="button" className="modern-confirm-dialog__close" aria-label="关闭" onClick={onCancel}>×</button></header>
      <div className="modern-confirm-dialog__content"><input autoFocus value={value} aria-label={label} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim()) onConfirm(); if (event.key === "Escape") onCancel(); }} /></div>
      <footer><button type="button" className="button secondary" onClick={onCancel}>取消</button><button type="button" className="button primary" disabled={!value.trim()} onClick={onConfirm}>{confirmLabel}</button></footer>
    </section>
  </div>;
}

const BUNDLED_PACKAGES = [
  { name: "pandas", version: "2.1.3", purpose: "表格处理与 CSV" },
  { name: "matplotlib", version: "3.8.2", purpose: "绘图与热图" },
];

export function PackageManager({ open, loading, environment, requirements, requirementInput, onClose, onRequirementInputChange, onAddRequirement, onRemoveRequirement, onCopyPipCommand, onExportRequirements }: {
  open: boolean;
  loading: boolean;
  environment: { pythonVersion: string; packages: { name: string; version: string }[] } | null;
  requirements: string[];
  requirementInput: string;
  onClose: () => void;
  onRequirementInputChange: (value: string) => void;
  onAddRequirement: () => void;
  onRemoveRequirement: (requirement: string) => void;
  onCopyPipCommand: () => void;
  onExportRequirements: () => void;
}) {
  if (!open) return null;
  return (
    <div className="package-manager-backdrop" role="dialog" aria-modal="true" aria-label="Python 包管理">
      <section className="package-manager">
        <header>
          <div><strong>Python 包管理</strong><span>{loading ? "正在读取环境…" : environment ? `Python ${environment.pythonVersion} · 应用功能包 ${BUNDLED_PACKAGES.length} 个 · 运行时发行包 ${environment.packages.length} 个` : "工作流依赖会随 Notebook 一起保存"}</span></div>
          <button aria-label="关闭包管理" onClick={onClose}>×</button>
        </header>
        <div className="package-manager__body">
          <section>
            <h3>应用内置</h3>
            <div className="package-list">{BUNDLED_PACKAGES.map((item) => {
              const installed = environment?.packages.find((candidate) => candidate.name.toLocaleLowerCase() === item.name);
              return <article key={item.name}><div><strong>{item.name}</strong><span>{item.purpose}</span></div><code>{installed?.version ?? item.version}</code><em>{installed || !environment ? "可用" : "缺失"}</em></article>;
            })}</div>
            {environment && <details className="runtime-packages"><summary>查看 {environment.packages.length} 个运行时发行包</summary><div>{environment.packages.map((item) => <code key={item.name}>{item.name}=={item.version}</code>)}</div></details>}
          </section>
          <section>
            <h3>工作流额外依赖</h3>
            <div className="package-add"><input value={requirementInput} onChange={(event) => onRequirementInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onAddRequirement(); }} placeholder="例如 scipy==1.12.0" /><button onClick={onAddRequirement}>加入</button></div>
            {requirements.length ? <div className="package-list">{requirements.map((item) => {
              const name = item.split(/[<>=~![]/, 1)[0].toLocaleLowerCase();
              const installed = environment?.packages.find((candidate) => candidate.name.toLocaleLowerCase() === name);
              return <article key={item}><div><strong>{item}</strong><span>{installed ? `当前环境 ${installed.version}` : "需要在目标平台准备"}</span></div><em className={installed ? "" : "pending"}>{installed ? "已安装" : "待配置"}</em><button aria-label={`删除 ${item}`} onClick={() => onRemoveRequirement(item)}>×</button></article>;
            })}</div> : <p className="muted">当前工作流没有额外依赖。</p>}
          </section>
          <section className="pip-console">
            <h3>pip 命令预览</h3>
            <code>$ {requirements.length ? `python -m pip install ${requirements.join(" ")}` : "# 当前没有额外依赖"}</code>
            <div><button onClick={onCopyPipCommand}>复制命令</button><button onClick={onExportRequirements}>导出 requirements.txt</button></div>
            <p>桌面端动态安装和 Android 构建依赖同步将在下一阶段接入。Android 包不能直接复用桌面 wheel，安装前会先检查平台兼容性。</p>
          </section>
        </div>
      </section>
    </div>
  );
}

export function HistoryDialog({ entries, futureCount, onClose, onUndo, onRedo, onClear, onRestore }: {
  entries: HistoryEntry[];
  futureCount: number;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onRestore: (index: number) => void;
}) {
  return <div className="settings-backdrop history-backdrop" role="dialog" aria-modal="true" aria-label="历史记录">
    <section className="history-dialog">
      <header><div><strong>历史记录</strong><span>最多保留最近 50 个画布状态</span></div><button aria-label="关闭历史记录" onClick={onClose}>×</button></header>
      <div className="history-toolbar"><button disabled={!entries.length} onClick={onUndo}>撤销</button><button disabled={!futureCount} onClick={onRedo}>重做</button><button className="danger-link" disabled={!entries.length && !futureCount} onClick={onClear}>清空</button></div>
      <div className="history-list">{entries.length ? [...entries].reverse().map((entry, index) => <button key={entry.id} onClick={() => onRestore(entries.length - 1 - index)}><span>{entry.at.toLocaleTimeString()}</span><strong>{entry.summary}</strong><small>恢复到此状态</small></button>) : <p className="muted">尚无可恢复的编辑记录。</p>}</div>
    </section>
  </div>;
}

export function RenameFlowDialog({ name, value, onValueChange, onClose, onConfirm }: {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return <div className="settings-backdrop interaction-backdrop" role="dialog" aria-modal="true" aria-label="重命名流程"><section className="interaction-dialog"><header><span className="interaction-dialog__icon" aria-hidden="true">◇</span><div><strong>重命名流程</strong><small>名称将显示在流程资源列表中</small></div></header><div className="interaction-dialog__content"><p>为“{name}”设置一个清晰的名称。</p><input autoFocus value={value} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onConfirm(); }} /></div><footer><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={onConfirm}>保存名称</button></footer></section></div>;
}

export function ErrorDetailDialog({ error, open, canLocate, onClose, onLocate, onCopy }: {
  error: ExecutionErrorView | null;
  open: boolean;
  canLocate: boolean;
  onClose: () => void;
  onLocate: (nodeId: string) => void;
  onCopy: () => void;
}) {
  if (!error || !open) return null;
  return <div className="settings-backdrop error-detail-backdrop" role="dialog" aria-modal="true" aria-label="执行错误详情"><section className="error-detail-dialog"><header><div><strong>{error.title}</strong><span>{error.nodeType ? `${error.nodeType} · ${error.nodeId ?? "工作流"}` : "工作流级错误"}</span></div><button onClick={onClose}>×</button></header><div><p>{error.message}</p>{error.traceback && <details><summary>运行时调试堆栈</summary><pre>{error.traceback}</pre></details>}{error.nodeId && canLocate && <button onClick={() => onLocate(error.nodeId!)}>定位错误节点</button>}<button onClick={onCopy}>复制错误</button></div></section></div>;
}

export function ResultDetailDialog({ detail, onClose, onCopy, onTextChange }: {
  detail: ResultDetail | null;
  onClose: () => void;
  onCopy: () => void;
  onTextChange: (text: string) => void;
}) {
  if (!detail) return null;
  return <div className="code-editor-modal result-detail-modal" role="dialog" aria-modal="true" aria-label="节点结果编辑器">
    <header><div><strong>{detail.title}</strong><span>内容可编辑；修改只影响当前查看副本，不会改写节点输出</span></div><div><button onClick={onCopy}>复制</button><button onClick={onClose}>关闭</button></div></header>
    {detail.preview ? <div className="result-detail-table"><DataGrid preview={detail.preview} /><details><summary>查看 / 编辑原始 JSON</summary><textarea spellCheck={false} value={detail.text} onChange={(event) => onTextChange(event.target.value)} /></details></div> : <textarea autoFocus spellCheck={false} value={detail.text} onChange={(event) => onTextChange(event.target.value)} />}
  </div>;
}

export function PlotLightbox({ open, preview, zoom, onZoom, onClose }: {
  open: boolean;
  preview: Extract<NodeExecutionPreview, { kind: "plot" }>;
  zoom: number;
  onZoom: (value: number) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const interactive = Boolean(preview.chart);
  const safeZoom = Math.min(3, Math.max(.5, zoom));
  const rasterStageScale = Math.max(1, safeZoom);
  const rasterImageScale = safeZoom < 1 ? safeZoom : 1;
  return <div className="plot-lightbox" role="dialog" aria-modal="true" aria-label="图表放大预览">
    <header>
      <div><strong>图表预览</strong><span>{interactive ? "交互式 · 图表随面板自适应" : "Python 图像 · 100% 为适应面板"}</span></div>
      <div className="plot-lightbox__tools">
        {!interactive && <label className="plot-lightbox__zoom" title="相对于自适应尺寸缩放"><span>缩放</span><input type="range" min="50" max="300" step="5" value={Math.round(safeZoom * 100)} onChange={(event) => onZoom(Number(event.target.value) / 100)} aria-label="图表缩放"/><output>{Math.round(safeZoom * 100)}%</output></label>}
        <button onClick={onClose}>关闭</button>
      </div>
    </header>
    <div className={`plot-lightbox__body ${interactive ? "plot-lightbox__body--interactive" : "plot-lightbox__body--raster"}`}>
      {interactive ? <PlotPreview preview={preview} className="plot-lightbox__chart" /> : <div className="plot-lightbox__raster-stage" style={{ width: `${rasterStageScale * 100}%`, height: `${rasterStageScale * 100}%` }}><PlotPreview preview={preview} className="plot-lightbox__raster-image" style={{ width: `${rasterImageScale * 100}%`, height: `${rasterImageScale * 100}%` }} alt="放大的绘图结果" /></div>}
    </div>
  </div>;
}

export function DebugDialog({ open, nodes, order, result, breakpoints, pausedAt, executionError, onClose, onRunFirst, onRunNext, onClearBreakpoints, onToggleBreakpoint, onRunTo, onCopyWorkflowJson, onCopySnapshotJson }: {
  open: boolean;
  nodes: WorkflowNode[];
  order: WorkflowNode[];
  result: ExecutionResult | null;
  breakpoints: Set<string>;
  pausedAt: string | null;
  executionError: ExecutionErrorView | null;
  onClose: () => void;
  onRunFirst: () => void;
  onRunNext: () => void;
  onClearBreakpoints: () => void;
  onToggleBreakpoint: (nodeId: string) => void;
  onRunTo: (nodeId: string) => void;
  onCopyWorkflowJson: () => void;
  onCopySnapshotJson: () => void;
}) {
  if (!open) return null;
  return <div className="settings-backdrop debug-backdrop" role="dialog" aria-modal="true" aria-label="调试面板"><section className="debug-dialog"><header><div><strong>工作流调试</strong><span>断点、单步、运行到节点、耗时、部分结果与错误上下文</span></div><button onClick={onClose}>×</button></header><div className="debug-summary"><span>节点 {nodes.length}</span><span>断点 {breakpoints.size}</span><span>已完成 {result?.executionOrder?.length ?? 0}</span><span>{pausedAt ? `暂停：${nodes.find((node) => node.id === pausedAt)?.data.label ?? pausedAt}` : "未暂停"}</span></div><div className="debug-controls"><button onClick={onRunFirst}>从首节点单步</button><button disabled={!pausedAt} onClick={onRunNext}>下一节点</button><button onClick={onClearBreakpoints}>清除断点</button></div><ol>{order.map((node, index) => <li className={node.id === pausedAt ? "paused" : ""} key={node.id}><b>{index + 1}</b><label><input type="checkbox" checked={breakpoints.has(node.id)} onChange={() => onToggleBreakpoint(node.id)}/><code>{node.data.nodeType}</code><small>{node.data.label}</small></label><span>{result?.nodeTimingsMs?.[node.id]?.toFixed(2) ?? "—"} ms</span><button onClick={() => onRunTo(node.id)}>运行到此</button></li>)}</ol>{executionError && <pre className="debug-error">{executionError.traceback || executionError.message}</pre>}<footer><button onClick={onCopyWorkflowJson}>复制工作流 JSON</button><button onClick={onCopySnapshotJson}>复制运行快照</button></footer></section></div>;
}

export function RemoteAccessDialog({ open, requirePin, onRequirePin, onClose, onStart }: {
  open: boolean;
  requirePin: boolean;
  onRequirePin: (checked: boolean) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  if (!open) return null;
  return <div className="remote-access-backdrop" role="dialog" aria-modal="true" aria-label="局域网网页设置"><section className="remote-access-dialog"><header><strong>局域网网页</strong><button aria-label="关闭" onClick={onClose}>×</button></header><p>访问设备与当前计算设备连接同一局域网；工作流由当前设备的 Python 内核执行。</p><label className="remote-access-option"><input type="checkbox" checked={requirePin} onChange={(event) => onRequirePin(event.target.checked)} />访问前要求随机四位数字校验码</label><small>关闭后，知道局域网地址的设备即可访问此服务。</small><footer><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={onStart}>开启服务</button></footer></section></div>;
}

export function RemotePairDialog({ policy, error, pinInput, onPinChange, onSubmitPin }: {
  policy: { requiresPin: boolean } | null;
  error: string | null;
  pinInput: string;
  onPinChange: (value: string) => void;
  onSubmitPin: () => void;
}) {
  return <div className="remote-access-backdrop" role="dialog" aria-modal="true" aria-label="Android 计算服务配对"><section className="remote-access-dialog"><header><strong>{policy?.requiresPin ? "输入四位校验码" : "连接 Android 计算服务"}</strong></header>{error ? <p className="validation-error">{error}</p> : <p>{policy ? policy.requiresPin ? "请输入 Android 应用显示的四位数字。" : "正在建立局域网连接…" : "正在检查 Android 服务…"}</p>}{policy?.requiresPin && <><input className="remote-pin-input" autoFocus inputMode="numeric" maxLength={4} value={pinInput} onChange={(event) => onPinChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmitPin(); }} placeholder="0000" /><footer><button className="button primary" onClick={onSubmitPin}>验证并进入</button></footer></>}</section></div>;
}

function SmbIcon({ kind }: { kind: "network" | "computer" | "share" | "folder" | "file" | "up" | "refresh" | "scan" | "chevron" }) {
  let content;
  if (kind === "network") content = <><circle cx="12" cy="12" r="2.3"/><circle cx="5" cy="7" r="1.5"/><circle cx="19" cy="7" r="1.5"/><path d="M6.3 8 10 10.7M17.7 8 14 10.7M12 14.4V19"/></>;
  else if (kind === "computer") content = <><rect x="3.5" y="4" width="17" height="11" rx="1.8"/><path d="M8.5 20h7M10 15v5M14 15v5"/></>;
  else if (kind === "share") content = <><path d="M4 7.5h6l1.8 2H20v9.5H4z"/><path d="M4 9.5h16"/></>;
  else if (kind === "folder") content = <path d="M3.5 7.5h6l1.8 2H20v9H3.5z"/>;
  else if (kind === "file") content = <><path d="M6 3.5h8l4 4V20H6z"/><path d="M14 3.5V8h4"/></>;
  else if (kind === "up") content = <><path d="m7 11 5-5 5 5"/><path d="M12 6v12"/></>;
  else if (kind === "refresh") content = <><path d="M19 8a7 7 0 1 0 1 5"/><path d="M19 4v4h-4"/></>;
  else if (kind === "scan") content = <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8 12h8"/></>;
  else content = <path d="m9 6 6 6-6 6"/>;
  return <svg className="smb-icon" viewBox="0 0 24 24" aria-hidden="true">{content}</svg>;
}

type SmbFavorite = {
  id: string;
  label: string;
  server: string;
  share: string;
  domain: string;
  username: string;
  guest: boolean;
};

const SMB_FAVORITES_KEY = "pydroid-flow.smb-favorites.v1";

function smbFavoriteId(server: string, share: string): string {
  return `${server.trim().toLocaleLowerCase()}::${share.trim().toLocaleLowerCase()}`;
}

function loadSmbFavorites(): SmbFavorite[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SMB_FAVORITES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SmbFavorite => Boolean(item && typeof item === "object" && typeof (item as SmbFavorite).server === "string" && typeof (item as SmbFavorite).share === "string"))
      .map((item) => ({ ...item, id: smbFavoriteId(item.server, item.share) }));
  } catch { return []; }
}

function saveSmbFavorites(favorites: SmbFavorite[]): void {
  try { localStorage.setItem(SMB_FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* storage may be unavailable */ }
}

export function SmbDialog({ open, language, servers, connection, guest, rememberPassword, passwordVisible, loading, error, path, entries, selected, scannedShares, onClose, onDiscover, onSelectServer, onConnectionChange, onGuestChange, onRememberPasswordChange, onPasswordVisibleChange, onScanShares, onSelectShare, onBrowse, onImportSelection, onToggleSelected }: {
  open: boolean;
  language: string;
  servers: { address: string; name: string; shares?: string[] }[];
  connection: { server: string; share: string; domain: string; username: string; password: string };
  guest: boolean;
  rememberPassword: boolean;
  passwordVisible: boolean;
  loading: boolean;
  error: string | null;
  path: string;
  entries: { path: string; name: string; directory: boolean; size: number }[];
  selected: string[];
  scannedShares: string[];
  onClose: () => void;
  onDiscover: () => void;
  onSelectServer: (address: string, shares: string[] | undefined) => void;
  onConnectionChange: (patch: Partial<{ server: string; share: string; domain: string; username: string; password: string }>) => void;
  onGuestChange: (checked: boolean) => void;
  onRememberPasswordChange: (checked: boolean) => void;
  onPasswordVisibleChange: () => void;
  onScanShares: () => void;
  onSelectShare: (share: string) => void;
  onBrowse: (path: string) => void;
  onImportSelection: (importAll: boolean) => void;
  onToggleSelected: (path: string, checked: boolean) => void;
}) {
  const connectionPanelRef = useRef<HTMLDetailsElement | null>(null);
  const previousLoadingRef = useRef(false);
  const autoScanServerRef = useRef("");
  const pendingFavoriteRef = useRef<SmbFavorite | null>(null);
  const onScanSharesRef = useRef(onScanShares);
  const onBrowseRef = useRef(onBrowse);
  onScanSharesRef.current = onScanShares;
  onBrowseRef.current = onBrowse;
  const [favorites, setFavorites] = useState<SmbFavorite[]>(() => loadSmbFavorites());
  const [favoritesOpen, setFavoritesOpen] = useState(false);

  useEffect(() => {
    if (!open) { setFavoritesOpen(false); return; }
    if (!connection.share && connectionPanelRef.current) connectionPanelRef.current.open = true;
  }, [open, connection.share]);

  useEffect(() => {
    const wasLoading = previousLoadingRef.current;
    previousLoadingRef.current = loading;
    if (!open || !wasLoading || loading || !connectionPanelRef.current) return;
    if (error) connectionPanelRef.current.open = true;
    else if (connection.share) connectionPanelRef.current.open = false;
  }, [open, loading, error, connection.share]);

  useEffect(() => {
    if (!open) return;
    const server = connection.server.trim();
    if (!server || connection.share.trim() || scannedShares.length || loading || autoScanServerRef.current === server) return;
    const timer = window.setTimeout(() => {
      autoScanServerRef.current = server;
      onScanSharesRef.current();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [open, connection.server, connection.share, scannedShares.length, loading]);

  useEffect(() => {
    const favorite = pendingFavoriteRef.current;
    if (!open || !favorite || loading) return;
    const ready = connection.server === favorite.server && connection.share === favorite.share && guest === favorite.guest && (favorite.guest || (connection.username === favorite.username && connection.domain === favorite.domain));
    if (!ready) return;
    pendingFavoriteRef.current = null;
    onBrowseRef.current("");
  }, [open, loading, connection.server, connection.share, connection.username, connection.domain, guest]);

  if (!open) return null;
  const L = (zh: string, en: string) => language === "en" ? en : zh;
  const activeServer = servers.find((server) => server.address === connection.server);
  const availableShares = scannedShares.length ? scannedShares : activeServer?.shares ?? [];
  const segments = path.split("/").filter(Boolean);
  const crumbs = segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join("/") }));
  const formatSize = (size: number) => size >= 1024 * 1024 * 1024 ? `${(size / 1024 / 1024 / 1024).toFixed(1)} GB` : size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : size >= 1024 ? `${Math.ceil(size / 1024)} KB` : `${size} B`;
  const fileType = (name: string) => {
    const extension = name.includes(".") ? name.split(".").pop()?.toUpperCase() : "";
    return extension ? `${extension} 文件` : "文件";
  };
  const currentFavoriteId = connection.server.trim() && connection.share.trim() ? smbFavoriteId(connection.server, connection.share) : "";
  const currentFavorited = Boolean(currentFavoriteId && favorites.some((item) => item.id === currentFavoriteId));
  const persistFavorites = (next: SmbFavorite[]) => { setFavorites(next); saveSmbFavorites(next); };
  const toggleCurrentFavorite = () => {
    if (!currentFavoriteId) return;
    if (currentFavorited) { persistFavorites(favorites.filter((item) => item.id !== currentFavoriteId)); return; }
    const favorite: SmbFavorite = {
      id: currentFavoriteId,
      label: `${activeServer?.name || connection.server} · ${connection.share}`,
      server: connection.server.trim(),
      share: connection.share.trim(),
      domain: guest ? "" : connection.domain,
      username: guest ? "" : connection.username,
      guest,
    };
    persistFavorites([favorite, ...favorites.filter((item) => item.id !== favorite.id)].slice(0, 24));
  };
  const openFavorite = (favorite: SmbFavorite) => {
    pendingFavoriteRef.current = favorite;
    autoScanServerRef.current = favorite.server;
    onGuestChange(favorite.guest);
    onConnectionChange({ server: favorite.server, share: favorite.share, domain: favorite.domain, username: favorite.username });
    setFavoritesOpen(false);
  };
  const removeFavorite = (id: string) => persistFavorites(favorites.filter((item) => item.id !== id));

  return <div className="settings-backdrop smb-backdrop" role="dialog" aria-modal="true" aria-label="内置 SMB 文件浏览器">
    <section className="smb-dialog smb-file-manager">
      <header className="smb-manager-header"><div><strong>{L("局域网文件", "Network files")}</strong><span>{L("浏览网络设备、共享和文件夹", "Browse devices, shares and folders")}</span></div><button className="dialog-close-button" aria-label="关闭 SMB 文件选择" onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></header>
      <div className="smb-manager-layout">
        <aside className="smb-navigation" aria-label="网络位置">
          <div className="smb-navigation__heading"><span><SmbIcon kind="network" /><strong>{L("网络", "Network")}</strong></span><button type="button" className="smb-icon-button" title="扫描局域网设备" disabled={loading} onClick={onDiscover}><SmbIcon kind="scan" /></button></div>
          <div className="smb-tree">
            {servers.length === 0 && <div className="smb-tree__empty"><SmbIcon kind="computer" /><span>{loading ? "正在扫描设备…" : "尚未发现设备"}</span><button type="button" onClick={onDiscover} disabled={loading}>{L("扫描设备", "Scan devices")}</button></div>}
            {servers.map((server) => {
              const active = connection.server === server.address;
              const shares = active && scannedShares.length ? scannedShares : server.shares ?? [];
              return <div className={`smb-tree__server ${active ? "active" : ""}`} key={server.address}>
                <button type="button" className="smb-tree__server-button" onClick={() => onSelectServer(server.address, server.shares)}><SmbIcon kind="computer" /><span><strong>{server.name || server.address}</strong><small>{server.name !== server.address ? server.address : "SMB 设备"}</small></span><SmbIcon kind="chevron" /></button>
                {active && <div className="smb-tree__shares">{shares.length ? shares.map((share) => <button type="button" key={share} className={connection.share === share ? "active" : ""} onClick={() => onSelectShare(share)}><SmbIcon kind="share" /><span>{share}</span></button>) : <button type="button" className="smb-tree__load-shares" disabled={loading || !connection.server.trim()} onClick={onScanShares}>{loading ? "读取中…" : "重新读取共享"}</button>}</div>}
              </div>;
            })}
          </div>
          <div className="smb-navigation__footer"><span>{servers.length} 台设备</span><button type="button" disabled={loading} onClick={onDiscover}><SmbIcon kind="refresh" />刷新</button></div>
        </aside>
        <main className="smb-browser">
          <div className="smb-browser-toolbar">
            <button type="button" className="smb-icon-button" title="上一级" disabled={!path || loading} onClick={() => onBrowse(segments.slice(0, -1).join("/"))}><SmbIcon kind="up" /></button>
            <nav className="smb-breadcrumbs" aria-label="当前位置">
              <button type="button" disabled={!connection.server} onClick={() => { if (connection.share) onBrowse(""); }}>{activeServer?.name || connection.server || "选择设备"}</button>
              {connection.share && <><SmbIcon kind="chevron" /><button type="button" onClick={() => onBrowse("")}>{connection.share}</button></>}
              {crumbs.map((crumb) => <span key={crumb.path}><SmbIcon kind="chevron" /><button type="button" onClick={() => onBrowse(crumb.path)}>{crumb.label}</button></span>)}
            </nav>
            <div className="smb-favorites">
              <button type="button" className={`smb-icon-button smb-favorite-button ${currentFavorited ? "active" : ""}`} title="收藏的网络位置" aria-label="收藏的网络位置" onClick={() => setFavoritesOpen((current) => !current)}>★</button>
              {favoritesOpen && <div className="smb-favorites__panel">
                {currentFavoriteId && <div className="smb-favorite-row smb-favorite-row--current"><button type="button" onClick={toggleCurrentFavorite}><strong>{currentFavorited ? "取消收藏当前位置" : "收藏当前位置"}</strong><small>{connection.server} / {connection.share}</small></button></div>}
                {favorites.length === 0 && !currentFavoriteId && <div className="smb-favorites__empty">连接一个共享后即可收藏。</div>}
                {favorites.map((favorite) => <div className="smb-favorite-row" key={favorite.id}><button type="button" onClick={() => openFavorite(favorite)}><strong>{favorite.label}</strong><small>{favorite.server} / {favorite.share}{favorite.guest ? " · 访客" : favorite.username ? ` · ${favorite.username}` : ""}</small></button><button type="button" className="smb-favorite-row__remove" title="移除收藏" aria-label={`移除收藏 ${favorite.label}`} onClick={() => removeFavorite(favorite.id)}>×</button></div>)}
              </div>}
            </div>
            <button type="button" className="smb-icon-button" title="刷新当前文件夹" disabled={!connection.share || loading} onClick={() => onBrowse(path)}><SmbIcon kind="refresh" /></button>
          </div>

          <details ref={connectionPanelRef} className="smb-connection-panel">
            <summary><span><strong>{L("连接设置", "Connection")}</strong><small>{guest ? "访客" : connection.username || "账号登录"}{connection.server ? ` · ${connection.server}` : " · 尚未选择设备"}</small></span><span>{L("配置", "Configure")}</span></summary>
            <div className="smb-connection-form smb-connection-form--compact">
              <label className="smb-field--server">{L("服务器", "Server")}<input placeholder={L("IP 或主机名", "IP or host name")} value={connection.server} onChange={(event) => { autoScanServerRef.current = ""; onConnectionChange({ server: event.target.value, share: "" }); }} /></label>
              <label className="smb-field--share">{L("共享名", "Share")}<input list="smb-shares" placeholder={L("自动发现或输入共享名", "Discover or enter share")} value={connection.share} onChange={(event) => onConnectionChange({ share: event.target.value })} /><datalist id="smb-shares">{availableShares.map((share) => <option key={share} value={share} />)}</datalist></label>
              <label className="smb-field--domain">{L("域", "Domain")}<input placeholder={L("可选", "Optional")} value={connection.domain} disabled={guest} onChange={(event) => onConnectionChange({ domain: event.target.value })} /></label>
              <label className="smb-field--username">{L("用户名", "Username")}<input autoComplete="username" value={connection.username} disabled={guest} onChange={(event) => onConnectionChange({ username: event.target.value })} /></label>
              <label className="smb-field--password">{L("密码", "Password")}<span className="password-field"><input type={passwordVisible ? "text" : "password"} autoComplete="current-password" value={connection.password} disabled={guest} onChange={(event) => onConnectionChange({ password: event.target.value })} /><button type="button" aria-label={passwordVisible ? L("隐藏密码", "Hide password") : L("显示密码", "Show password")} onClick={onPasswordVisibleChange}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>{passwordVisible && <path d="m4 4 16 16"/>}</svg></button></span></label>
              <div className="smb-connection-form__auth"><label className="smb-guest smb-connection-form__guest"><input type="checkbox" checked={guest} onChange={(event) => onGuestChange(event.target.checked)} /><span>{L("访客", "Guest")}</span></label><button type="button" disabled={loading || !connection.server.trim() || !connection.share.trim()} onClick={() => onBrowse("")}>{loading ? L("连接中…", "Connecting…") : L("登录", "Login")}</button></div>
            </div>
          </details>

          {error && <p className="validation-error smb-browser-error">{error}</p>}
          <div className="smb-file-list" role="table" aria-label="SMB 文件列表">
            <div className="smb-file-list__header" role="row"><span role="columnheader">{L("名称", "Name")}</span><span role="columnheader">{L("类型", "Type")}</span><span role="columnheader">{L("大小", "Size")}</span></div>
            <div className="smb-file-list__body">
              {!connection.share && <div className="smb-file-empty"><SmbIcon kind="share" /><strong>选择一个共享</strong><span>选择左侧共享，或在连接设置中输入服务器后等待自动发现。</span></div>}
              {connection.share && !loading && entries.length === 0 && !error && <div className="smb-file-empty"><SmbIcon kind="folder" /><strong>此文件夹为空</strong><span>当前位置没有可显示的文件或子文件夹。</span></div>}
              {loading && <div className="smb-file-empty"><span className="smb-loading-spinner"/><strong>正在读取…</strong><span>正在获取网络位置内容。</span></div>}
              {!loading && entries.map((entry) => entry.directory ? <button type="button" className="smb-file-row smb-file-row--folder" role="row" key={entry.path} onDoubleClick={() => onBrowse(entry.path)} onClick={() => onBrowse(entry.path)}><span className="smb-file-row__name" role="cell"><SmbIcon kind="folder" /><strong>{entry.name}</strong></span><span role="cell">文件夹</span><span role="cell">—</span></button> : <label className={`smb-file-row ${selected.includes(entry.path) ? "selected" : ""}`} role="row" key={entry.path}><span className="smb-file-row__name" role="cell"><input type="checkbox" checked={selected.includes(entry.path)} onChange={(event) => onToggleSelected(entry.path, event.target.checked)} /><SmbIcon kind="file" /><strong>{entry.name}</strong></span><span role="cell">{fileType(entry.name)}</span><span role="cell">{formatSize(entry.size)}</span></label>)}
            </div>
          </div>
        </main>
      </div>
      <footer className="smb-manager-footer"><div>{!guest && <label className="smb-remember"><input type="checkbox" checked={rememberPassword} onChange={(event) => onRememberPasswordChange(event.target.checked)} />安全保存密码</label>}<span>{selected.length ? `已选择 ${selected.length} 个文件` : connection.share ? `/${connection.share}${path ? `/${path}` : ""}` : "未连接共享"}</span></div><div><button className="button secondary" onClick={onClose}>{L("取消", "Cancel")}</button><button className="button secondary" disabled={loading || !entries.some((entry) => !entry.directory)} onClick={() => onImportSelection(true)}>{L("导入此文件夹", "Import folder")}</button><button className="button primary" disabled={loading || !selected.length} onClick={() => onImportSelection(false)}>{L("导入所选", "Import selected")}</button></div></footer>
    </section>
  </div>;
}

export function ReplacementPanel({ node, search, showAll, candidates, onSearch, onToggleShowAll, onSelect, onClose }: {
  node: { data: { label: string } } | null;
  search: string;
  showAll: boolean;
  candidates: ReplacementCandidate[];
  onSearch: (value: string) => void;
  onToggleShowAll: (checked: boolean) => void;
  onSelect: (nodeType: string) => void;
  onClose: () => void;
}) {
  if (!node) return null;
  return <div className="replacement-backdrop" role="dialog" aria-modal="true" aria-label="替换节点功能">
    <section className="replacement-panel">
      <header><div><strong>替换“{node.data.label}”</strong><span>节点 ID、位置和同名参数保持不变；不兼容连线会明确移除。</span></div><button onClick={onClose}>×</button></header>
      <div className="replacement-tools"><input autoFocus value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索节点名称、类型或标签" /><label><input type="checkbox" checked={showAll} onChange={(event) => onToggleShowAll(event.target.checked)} />显示任意节点</label></div>
      {!showAll && <p>默认仅显示输入、输出数量和数据类型兼容的节点。</p>}
      <div className="replacement-list">{candidates.map((candidate) => <button key={candidate.nodeType} onClick={() => onSelect(candidate.nodeType)}><strong>{candidate.label}</strong><span>{candidate.nodeType}</span><small>{candidate.inputPorts.map((port) => port.valueType).join(" + ") || "无输入"} → {candidate.outputPorts.map((port) => port.valueType).join(" + ") || "无输出"}</small></button>)}</div>
    </section>
  </div>;
}

export function InputDialog({ node, value, onValueChange, onSubmit, onCancel }: {
  node: { data: { parameters: Record<string, unknown> } } | null;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!node) return null;
  const kind = String(node.data.parameters.inputKind ?? "text");
  return <div className="settings-backdrop interaction-backdrop" role="dialog" aria-modal="true" aria-label={String(node.data.parameters.title ?? "输入")}><section className="interaction-dialog"><header><span className="interaction-dialog__icon" aria-hidden="true">⌁</span><div><strong>{String(node.data.parameters.title ?? "输入")}</strong><small>流程正在等待你的输入 · {kind}</small></div></header><div className="interaction-dialog__content"><p>{String(node.data.parameters.prompt ?? "请输入值")}</p>{kind === "select" ? <select autoFocus value={value} onChange={(event) => onValueChange(event.target.value)}>{String(node.data.parameters.options ?? "").split(",").map((item) => item.trim()).filter(Boolean).map((item) => <option key={item} value={item}>{item}</option>)}</select> : kind === "multiline" || kind === "json" || kind === "table" ? <textarea autoFocus rows={kind === "table" ? 9 : 6} value={value} placeholder={kind === "table" ? "粘贴 CSV 或 JSON 记录数组" : kind === "json" ? "输入 JSON 对象或数组" : "输入多行文本"} onChange={(event) => onValueChange(event.target.value)} /> : kind === "boolean" ? <label className="interaction-dialog__boolean"><input autoFocus type="checkbox" checked={value === "true"} onChange={(event) => onValueChange(String(event.target.checked))} />{value === "true" ? "True" : "False"}</label> : kind === "file" ? <><input autoFocus type="file" accept="image/*,.txt,.json,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => onValueChange(String(reader.result ?? "")); reader.readAsDataURL(file); }} />{value.startsWith("data:image/") && <img className="interaction-dialog__image-preview" src={value} alt="输入图片预览" />}</> : <input autoFocus type={["number", "date", "time", "datetime-local"].includes(kind) ? kind : "text"} value={value} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }} />}</div><footer><button className="button secondary" onClick={onCancel}>取消</button><button className="button primary" onClick={onSubmit}>确定并运行</button></footer></section></div>;
}

export function AlertDialog({ node, preview, onSubmit }: {
  node: { data: { parameters: Record<string, unknown> } } | null;
  preview: NodeExecutionPreview | undefined;
  onSubmit: (response: boolean | null) => void;
}) {
  if (!node) return null;
  return <div className="settings-backdrop interaction-backdrop" role="dialog" aria-modal="true" aria-label={String(node.data.parameters.title ?? "提示")} onKeyDown={(event) => { if (event.key === "Escape" && String(node.data.parameters.cancelLabel ?? "取消").trim()) onSubmit(null); }}><section className="interaction-dialog interaction-dialog--alert"><header><span className="interaction-dialog__icon" aria-hidden="true">!</span><div><strong>{String(node.data.parameters.title ?? "提示")}</strong><small>“内容”端口支持文本、表格、图片、时间及任意可预览值</small></div></header><div className="interaction-dialog__content"><p>{String(node.data.parameters.message ?? "流程正在执行。")}</p>{preview?.kind === "table" ? <DataGrid preview={preview.preview} /> : preview?.kind === "plot" ? <PlotPreview preview={preview} className="interaction-dialog__image-preview" alt="弹窗输入图像" /> : preview?.kind === "value" ? <pre className="interaction-dialog__value">{preview.text}</pre> : <small>首次运行时先执行上游后即可在此自适应显示内容；选择结果仍由 output 端口输出。</small>}</div><footer className="interaction-dialog__choices">{String(node.data.parameters.cancelLabel ?? "取消").trim() && <button className="button secondary" onClick={() => onSubmit(null)}>{String(node.data.parameters.cancelLabel)}</button>}{String(node.data.parameters.exitLabel ?? "退出").trim() && <button className="button alert-false" onClick={() => onSubmit(false)}>{String(node.data.parameters.exitLabel)}</button>}{String(node.data.parameters.confirmLabel ?? "确认").trim() && <button autoFocus className="button primary" onClick={() => onSubmit(true)}>{String(node.data.parameters.confirmLabel)}</button>}{!["cancelLabel", "exitLabel", "confirmLabel"].some((key) => String(node.data.parameters[key] ?? "").trim()) && <button autoFocus className="button secondary" onClick={() => onSubmit(null)}>关闭</button>}</footer><div className="interaction-dialog__result-legend"><span><b>true</b> 确认</span><span><b>false</b> 退出</span><span><b>None</b> 取消</span></div></section></div>;
}

export function CodeEditorModal({ open, code, summary, error, onClose, onCodeChange }: {
  open: boolean;
  code: string;
  summary: string;
  error: string | null | undefined;
  onClose: () => void;
  onCodeChange: (code: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="code-editor-modal" role="dialog" aria-modal="true" aria-label="Python 函数全屏编辑器">
      <header>
        <div>
          <strong>Python 函数编辑器</strong>
          <span className={error ? "error" : "valid"}>{error ?? summary}</span>
        </div>
        <button onClick={onClose}>完成</button>
      </header>
      <textarea
        autoFocus
        spellCheck={false}
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          const input = event.currentTarget;
          const start = input.selectionStart;
          onCodeChange(`${input.value.slice(0, start)}    ${input.value.slice(input.selectionEnd)}`);
          window.requestAnimationFrame(() => input.setSelectionRange(start + 4, start + 4));
        }}
      />
    </div>
  );
}

export function AgentDialog({ open, settings, apiKey, keyStorageHint, apiKeyManagedByHost = false, testing, connectionStatus, language, instruction, requesting, planText, plan, planError, audit, mcpEnabled, mcpToken, mcpInfo, mcpAvailable, onClose, onPresetSelect, onSettingsChange, onApiKeyChange, onLanguageChange, onTestConnection, onInstructionChange, onRequestPlan, onPlanTextChange, onReviewPlan, onApplyPlan, onMcpEnabledChange, onMcpTokenChange }: {
  open: boolean;
  settings: AgentSettings;
  apiKey: string;
  keyStorageHint: string;
  apiKeyManagedByHost?: boolean;
  testing: boolean;
  connectionStatus: string | null;
  language: string;
  instruction: string;
  requesting: boolean;
  planText: string;
  plan: AgentPlan | null;
  planError: string | null;
  audit: { at: string; summary: string; result: string }[];
  mcpEnabled: boolean;
  mcpToken: string;
  mcpInfo: McpServerInfo | null;
  mcpAvailable: boolean;
  onClose: () => void;
  onPresetSelect: (presetId: string) => void;
  onSettingsChange: (patch: Partial<AgentSettings>) => void;
  onApiKeyChange: (value: string) => void;
  onLanguageChange: (value: "zh-CN" | "en") => void;
  onTestConnection: () => void;
  onInstructionChange: (value: string) => void;
  onRequestPlan: () => void;
  onPlanTextChange: (value: string) => void;
  onReviewPlan: () => void;
  onApplyPlan: () => void;
  onMcpEnabledChange: (enabled: boolean) => void;
  onMcpTokenChange: (token: string) => void;
}) {
  if (!open) return null;
  const permissions = settings.permissions;
  const L = (zh: string, en: string) => language === "en" ? en : zh;
  const selectedPreset = presetById(settings.presetId);
  const deepSeekPreset = settings.presetId === "deepseek" || settings.presetId === "deepseek-anthropic";
  const protocolOptions = deepSeekPreset
    ? [{ value: settings.provider, label: settings.provider === "anthropic-messages" ? "DeepSeek Anthropic Messages" : "DeepSeek Chat Completions" }]
    : [
        { value: "openai-responses", label: "OpenAI Responses" },
        { value: "openai-compatible", label: L("OpenAI Chat Completions", "OpenAI Chat Completions") },
        { value: "anthropic-messages", label: "Anthropic Messages" },
      ];
  return <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label={L("AI Agent 设置", "AI Agent settings")}>
    <section className="settings-dialog agent-dialog">
      <header><div><strong>{L("AI Agent 设置", "AI Agent settings")}</strong><span>{L("AI 只提出计划；画布变更仍需确认", "AI proposes a plan; canvas changes still require confirmation")}</span></div><button aria-label={L("关闭 AI Agent", "Close AI Agent")} onClick={onClose}>×</button></header>
      <div className="settings-dialog__body">
        <div className="agent-main-stack"><section className="agent-connection"><h3>{L("模型与连接", "Model & connection")}</h3>
          <label><span>{L("供应商", "Provider")}</span><ThemedSelect ariaLabel={L("供应商", "Provider")} value={settings.presetId} options={AGENT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))} onChange={onPresetSelect} /></label>
          <label><span>{L("协议", "Protocol")}</span><ThemedSelect ariaLabel={L("协议", "Protocol")} value={settings.provider} options={protocolOptions} onChange={(value) => onSettingsChange({ provider: value as AgentSettings["provider"], presetId: "custom" })} /></label>
          <label>{L("接口地址", "Endpoint")}<input value={settings.endpoint} onChange={(event) => onSettingsChange({ endpoint: event.target.value, presetId: "custom" })} /></label>
          <label><span>{L("模型", "Model")}</span><ThemedSelect ariaLabel={L("模型", "Model")} value={settings.model} options={[{ value: "", label: L("选择模型", "Select a model") }, ...selectedPreset.models.map((model) => ({ value: model, label: model }))]} onChange={(value) => onSettingsChange({ model: value })} /></label>
          {settings.presetId === "custom" && <label>{L("自定义模型", "Custom model")}<input value={settings.model} placeholder="模型 ID" onChange={(event) => onSettingsChange({ model: event.target.value })} /></label>}
          <label>{L("API 密钥", "API key")}<input type="password" autoComplete="off" value={apiKeyManagedByHost ? "" : apiKey} disabled={apiKeyManagedByHost} placeholder={apiKeyManagedByHost ? L("由宿主机安全代理持有", "Managed by host proxy") : keyStorageHint} onChange={(event) => onApiKeyChange(event.target.value)} /></label>
          <label><span>{L("语言（同步界面）", "Language (synced with UI)")}</span><ThemedSelect ariaLabel={L("语言", "Language")} value={language} options={[{ value: "zh-CN", label: "中文" }, { value: "en", label: "English" }]} onChange={(value) => onLanguageChange(value as "zh-CN" | "en")} /></label>
          <div className="agent-connection-footer"><button className="button secondary agent-test-button" disabled={testing} onClick={onTestConnection}>{testing ? L("测试中…", "Testing…") : L("尝试连接", "Test connection")}</button><div className="agent-connection-meta"><small>{apiKeyManagedByHost ? L("密钥始终留在宿主机，由安全代理代发模型请求；局域网网页不会取得原始 API 密钥。", "The key stays on the host. A secure proxy sends model requests, and Remote Web never receives the raw API key.") : keyStorageHint === "keystore" ? "Android 端使用 Keystore 加密保存，应用更新后仍可读取；不会写入设置、工作流或用户文件夹。" : "桌面/网页密钥只驻留当前会话，不会写入设置、工作流或用户文件夹。"}</small>{connectionStatus && <small className={connectionStatus.startsWith("连接成功") ? "agent-success" : "agent-failure"}>{connectionStatus}</small>}</div></div>
        </section>
        <section className="agent-audit-section"><h3>{L("审计", "Audit")}</h3>{audit.length ? <ol className="agent-audit">{audit.slice(0, 5).map((entry) => <li key={`${entry.at}-${entry.summary}`}><strong>{entry.summary}</strong><span>{entry.result}</span></li>)}</ol> : <p className="muted">{L("尚无 AI 操作记录。", "No AI audit entries yet.")}</p>}</section></div>
        <div className="agent-side-stack">
        <McpConnectionSection embedded enabled={mcpEnabled} token={mcpToken} info={mcpInfo} available={mcpAvailable} language={language} onEnabledChange={onMcpEnabledChange} onTokenChange={onMcpTokenChange} />
        <section className="agent-permissions"><h3>{L("AI 权限", "AI permissions")}</h3>
          <label className="settings-check"><input type="checkbox" checked={permissions.createNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, createNodes: event.target.checked } })} />{L("创建节点", "Create nodes")}</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.groupNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, groupNodes: event.target.checked } })} />{L("组合节点", "Group nodes")}</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.updateParameters} onChange={(event) => onSettingsChange({ permissions: { ...permissions, updateParameters: event.target.checked } })} />{L("修改参数与标签", "Edit parameters and labels")}</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.deleteNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, deleteNodes: event.target.checked } })} />{L("删除节点", "Delete nodes")}</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.connectNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, connectNodes: event.target.checked } })} />{L("创建连线", "Create connections")}</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.disconnectNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, disconnectNodes: event.target.checked } })} />{L("断开连线", "Disconnect nodes")}</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.arrangeLayout} onChange={(event) => onSettingsChange({ permissions: { ...permissions, arrangeLayout: event.target.checked } })} />{L("整理布局", "Arrange layout")}</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.runWorkflow} onChange={(event) => onSettingsChange({ permissions: { ...permissions, runWorkflow: event.target.checked } })} />{L("执行工作流", "Run workflow")}</label>
        </section>
        </div>
        <section className="agent-request"><h3>{L("创建计划", "Create plan")}</h3><textarea value={instruction} placeholder="例如：读取两个 CSV，按日期合并后绘制销售额折线图" onChange={(event) => onInstructionChange(event.target.value)} /><button className="button primary" disabled={requesting} onClick={onRequestPlan}>{requesting ? L("AI 正在规划…", "Planning…") : L("请求 AI 计划", "Request AI plan")}</button><small>{L("模型不能直接执行 Python、访问文件或改写工作流 JSON。", "The model cannot directly execute Python, access files, or rewrite workflow JSON.")}</small></section>
        <section className="agent-plan"><h3>{L("计划预览", "Plan preview")}</h3><textarea spellCheck={false} value={planText} placeholder={"可粘贴或检查 AI 返回的 JSON 计划，例如：\n{\"summary\":\"添加读取节点\",\"operations\":[]}"} onChange={(event) => onPlanTextChange(event.target.value)} /><div><button className="button secondary" onClick={onReviewPlan}>{L("检查计划", "Validate plan")}</button><button className="button primary" disabled={!plan || requesting} onClick={onApplyPlan}>{L("确认并应用", "Apply plan")}</button></div>{planError && <p className="validation-error">{planError}</p>}{plan && <p>将执行：{plan.summary}（{plan.operations.length} 项操作）</p>}</section>
      </div>
    </section>
  </div>;
}

type ThemeMode = "system" | "dark" | "light";
type CanvasSettings = { theme: CanvasThemeId; nodeScale: number; endpointScale: number; edgeWidth: number; paletteWidth: number; inspectorWidth: number; inspectorHeight: number; resultHeight: number; miniMapMode: "auto" | "show" | "hide"; showNodeInsights: boolean };


export function AutomatedDiagnosticsDialog({ open, running, report, exportStatus, onClose, onRun, onCopy, onExport }: {
  open: boolean;
  running: boolean;
  report: AutomatedDiagnosticReport | null;
  exportStatus: string | null;
  onClose: () => void;
  onRun: () => void;
  onCopy: () => void;
  onExport: () => void;
}) {
  if (!open) return null;
  return <div className="settings-backdrop diagnostics-backdrop" role="dialog" aria-modal="true" aria-label="自动诊断"><section className="debug-dialog diagnostics-dialog">
    <header><div><strong>自动诊断</strong><span>隔离运行，不修改当前画布与工作区变量</span></div><button onClick={onClose}>×</button></header>
    <div className="debug-summary"><span>{running ? "正在运行…" : report ? `通过 ${report.summary.passed}/${report.summary.total}` : "尚未运行"}</span>{report && <><span>失败 {report.summary.failed}</span><span>跳过 {report.summary.skipped}</span><span>{report.platform.id}</span></>}</div>
    {report ? <ol>{report.cases.map((item) => <li className={item.status === "fail" ? "diagnostic-fail" : item.status === "pass" ? "diagnostic-pass" : ""} key={item.id}><b>{item.status === "pass" ? "✓" : item.status === "fail" ? "×" : "–"}</b><label><code>{item.runtime ?? "host"}</code><small>{item.label}</small></label><span>{item.durationMs.toFixed(2)} ms</span>{item.error ? <strong>{item.error}</strong> : <small>{item.status === "skip" ? String(item.details.reason ?? "已跳过") : "通过"}</small>}</li>)}</ol> : <p className="muted">点击“运行全部诊断”。它会自动测试 Phase 8 工作区变量跨运行持久化、函数签名端口、可复用函数在 JavaScript/Python 运行时的执行，并记录平台与当前标签页摘要。</p>}
    {exportStatus && <p className="diagnostics-export-status" role="status">{exportStatus}</p>}
    <footer><button className="button primary" disabled={running} onClick={onRun}>{running ? "诊断中…" : report ? "重新运行" : "运行全部诊断"}</button><button disabled={!report || running} onClick={onCopy}>复制完整结果</button><button disabled={!report || running} onClick={onExport}>导出 JSON</button></footer>
  </section></div>;
}


function McpConnectionSection({ enabled, token, info, available, language, onEnabledChange, onTokenChange, embedded = false }: {
  enabled: boolean;
  token: string;
  info: McpServerInfo | null;
  available: boolean;
  language: string;
  onEnabledChange: (enabled: boolean) => void;
  onTokenChange: (token: string) => void;
  embedded?: boolean;
}) {
  const L = (zh: string, en: string) => language === "en" ? en : zh;
  const [helpOpen, setHelpOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current); }, []);
  const showCopyNotice = (text: string, error = false) => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    setCopyNotice({ text, error });
    copyTimerRef.current = window.setTimeout(() => { setCopyNotice(null); copyTimerRef.current = null; }, 1400);
  };
  const copyValue = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); showCopyNotice(L(`已复制 ${label}`, `${label} copied`)); }
    catch { showCopyNotice(L("复制失败", "Copy failed"), true); }
  };
  const localEndpoint = info?.localUrl ?? null;
  const lanEndpoint = info?.lanUrl ?? (!localEndpoint ? info?.url ?? null : null);
  const endpoint = localEndpoint ?? info?.url ?? "http://<PyDroid-IP>:8766/mcp";
  const codexConfig = `[mcp_servers.pydroid]\nurl = "${endpoint}"\nhttp_headers = { "X-PyDroid-Token" = "${token}" }\nenabled = true\ndefault_tools_approval_mode = "prompt"`;
  const displayedConfig = `[mcp_servers.pydroid]\nurl = "${endpoint}"\nhttp_headers = { "X-PyDroid-Token" = "${L("<你的 Token>", "<your Token>")}" }\nenabled = true\ndefault_tools_approval_mode = "prompt"`;
  return <>
    <section className={`settings-section ${embedded ? "agent-mcp-section" : "settings-mcp-summary"}`}><div className="settings-mcp-heading-row"><div className="settings-section__heading"><h3>{embedded ? L("PyDroid MCP", "PyDroid MCP") : "MCP Server"}</h3><small>{embedded ? L("供 AI Agent / Codex 连接当前 Core", "Expose the current Core to AI Agent / Codex") : L("完整 Core", "Full Core")}</small></div><button type="button" className="settings-help-button" aria-label={L("MCP 连接帮助", "MCP connection help")} title={L("连接帮助", "Connection help")} onClick={() => setHelpOpen(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25"/><path d="M7.9 7.55A2.25 2.25 0 0 1 10.1 6c1.35 0 2.35.78 2.35 1.92 0 1.5-1.55 1.8-2.15 2.75-.2.3-.25.55-.25 1.05"/><circle className="settings-help-button__dot" cx="10.05" cy="14.2" r=".7"/></svg></button></div>
      <label className="settings-mcp-token"><span>Token</span><div><input type="text" value={token} disabled={enabled} maxLength={256} placeholder={L("输入固定 Token", "Enter a fixed Token")} onChange={(event) => onTokenChange(event.target.value.replace(/[\r\n]/g, ""))} /><button type="button" className="settings-copy-button" disabled={!token} aria-label={L("复制 Token", "Copy Token")} title={L("复制 Token", "Copy Token")} onClick={() => void copyValue("Token", token)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.1" y="5.5" width="8.4" height="9" rx="1.4"/><path d="M5.7 12.2H4.9a1.4 1.4 0 0 1-1.4-1.4V4.9a1.4 1.4 0 0 1 1.4-1.4h5.9a1.4 1.4 0 0 1 1.4 1.4v.6"/></svg></button></div></label>
      {info && <div className="settings-mcp-values">
        {localEndpoint && <div className="settings-mcp-value"><small>Local</small><div><strong><code title={localEndpoint}>{localEndpoint}</code></strong><button type="button" className="settings-copy-button" aria-label={L("复制 Local 地址", "Copy Local URL")} title={L("复制 Local 地址", "Copy Local URL")} onClick={() => void copyValue("Local", localEndpoint)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.1" y="5.5" width="8.4" height="9" rx="1.4"/><path d="M5.7 12.2H4.9a1.4 1.4 0 0 1-1.4-1.4V4.9a1.4 1.4 0 0 1 1.4-1.4h5.9a1.4 1.4 0 0 1 1.4 1.4v.6"/></svg></button></div></div>}
        {lanEndpoint && <div className="settings-mcp-value"><small>{localEndpoint ? "LAN" : "Endpoint"}</small><div><strong><code title={lanEndpoint}>{lanEndpoint}</code></strong><button type="button" className="settings-copy-button" aria-label={L(localEndpoint ? "复制 LAN 地址" : "复制 Endpoint", localEndpoint ? "Copy LAN URL" : "Copy Endpoint")} title={L(localEndpoint ? "复制 LAN 地址" : "复制 Endpoint", localEndpoint ? "Copy LAN URL" : "Copy Endpoint")} onClick={() => void copyValue(localEndpoint ? "LAN" : "Endpoint", lanEndpoint)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.1" y="5.5" width="8.4" height="9" rx="1.4"/><path d="M5.7 12.2H4.9a1.4 1.4 0 0 1-1.4-1.4V4.9a1.4 1.4 0 0 1 1.4-1.4h5.9a1.4 1.4 0 0 1 1.4 1.4v.6"/></svg></button></div></div>}
        {!localEndpoint && !lanEndpoint && <div className="settings-mcp-value"><small>Endpoint</small><div><strong><code title={info.url}>{info.url}</code></strong><button type="button" className="settings-copy-button" aria-label={L("复制 Endpoint", "Copy Endpoint")} title={L("复制 Endpoint", "Copy Endpoint")} onClick={() => void copyValue("Endpoint", info.url)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.1" y="5.5" width="8.4" height="9" rx="1.4"/><path d="M5.7 12.2H4.9a1.4 1.4 0 0 1-1.4-1.4V4.9a1.4 1.4 0 0 1 1.4-1.4h5.9a1.4 1.4 0 0 1 1.4 1.4v.6"/></svg></button></div></div>}
        <div className={`settings-mcp-value ${localEndpoint && lanEndpoint ? "settings-mcp-value--header-span" : ""}`}><small>Header</small><div><strong><code>X-PyDroid-Token</code></strong></div></div>
      </div>}
      <label className="settings-check settings-check--inline settings-mcp-enable-row"><input type="checkbox" checked={enabled && available} disabled={!available || !token.trim()} onChange={(event) => onEnabledChange(event.target.checked)} /><span>{L("开启 MCP Server", "Enable MCP Server")}</span></label>
    </section>
    {copyNotice && <div className={`settings-copy-toast ${copyNotice.error ? "error" : ""}`} role="status" aria-live="polite"><svg viewBox="0 0 20 20" aria-hidden="true">{copyNotice.error ? <path d="m6 6 8 8m0-8-8 8"/> : <path d="m4.5 10.2 3.2 3.2 7.8-7.8"/>}</svg><span>{copyNotice.text}</span></div>}
    {helpOpen && <div className="settings-backdrop modern-confirm-backdrop mcp-help-backdrop" role="dialog" aria-modal="true" aria-label={L("MCP 连接帮助", "MCP connection help")} onPointerDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
      <section className="mcp-help-dialog">
        <header><div><strong>{L("MCP 连接帮助", "MCP connection help")}</strong><small>Streamable HTTP · 8766</small></div><button type="button" className="dialog-close-button" aria-label={L("关闭帮助", "Close help")} onClick={() => setHelpOpen(false)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></header>
        <div className="mcp-help-dialog__body">
          <ol className="mcp-help-steps"><li><span>1</span><p>{L("先填写固定 Token，再开启 MCP Server。Token 会保存在本机设置中，不会因重新编译或重启服务而变化。", "Set a fixed Token first, then enable MCP Server. It is saved in local settings and does not change after rebuilds or server restarts.")}</p></li><li><span>2</span><p>{L(localEndpoint ? "Codex 与 PyDroid 在同一台电脑时优先使用 Local（127.0.0.1），可绕开局域网和代理路由；其他设备连接使用 LAN。" : "Codex → 设置 → MCP Server → 添加 Streamable HTTP；URL 填 Endpoint。", localEndpoint ? "When Codex and PyDroid run on the same computer, prefer Local (127.0.0.1) to bypass LAN/proxy routing; use LAN for other devices." : "Codex → Settings → MCP Server → Add Streamable HTTP; use Endpoint for URL.")}</p></li><li><span>3</span><p>{L("“Bearer 令牌环境变量”留空。在“标头”中添加 X-PyDroid-Token。", "Leave “Bearer token environment variable” empty. Add X-PyDroid-Token under Headers.")}</p></li><li><span>4</span><p>{L("标头值直接填写你设置的 Token，不需要 Bearer 前缀。保存后重启 Codex。", "Use your Token directly as the header value; no Bearer prefix is required. Save, then restart Codex.")}</p></li></ol>
          <section className="mcp-help-codex"><div className="mcp-help-codex__heading"><div><strong>Codex</strong><small>~/.codex/config.toml</small></div><button type="button" className="button secondary" disabled={!info || !token} onClick={() => void copyValue(L("Codex 配置", "Codex config"), codexConfig)}>{L("复制配置", "Copy config")}</button></div><pre><code>{displayedConfig}</code></pre></section>
          <p className="mcp-help-note">{L(localEndpoint ? "MCP 实际监听 0.0.0.0:8766，因此 Local 与 LAN 指向同一服务。8765 仍用于 Remote Web。" : "8765 用于 Remote Web；8766 用于 MCP。修改 Token 时先关闭 MCP Server，修改后重新开启。", localEndpoint ? "MCP listens on 0.0.0.0:8766, so Local and LAN reach the same service. Port 8765 remains Remote Web." : "8765 is for Remote Web; 8766 is for MCP. Stop MCP Server before changing the Token, then enable it again.")}</p>
        </div>
      </section>
    </div>}
  </>;
}

export function SettingsDialog({ open, mcpEnabled, mcpToken, mcpInfo, mcpAvailable, themeMode, language, resolvedTheme, runtimePreference, canvas, smbServer, smbShare, smbGuest, smbUsername, smbDisabled, debugMode, automatedDiagnosticsEnabled, profilePath, workspaceUri, onClose, onMcpEnabledChange, onMcpTokenChange, onThemeModeChange, onLanguageChange, onRuntimePreferenceChange, onCanvasChange, onOpenSmb, onOpenAgent, onDebugModeChange, onAutomatedDiagnosticsEnabledChange, onOpenDiagnostics, onConfigureFolder, onExportSettings, onImportSettings }: {
  open: boolean;
  mcpEnabled: boolean;
  mcpToken: string;
  mcpInfo: McpServerInfo | null;
  mcpAvailable: boolean;
  themeMode: ThemeMode;
  language: string;
  resolvedTheme: "dark" | "light";
  runtimePreference: RuntimePreference;
  canvas: CanvasSettings;
  smbServer: string;
  smbShare: string;
  smbGuest: boolean;
  smbUsername: string;
  smbDisabled: boolean;
  debugMode: boolean;
  automatedDiagnosticsEnabled: boolean;
  profilePath: string | null;
  workspaceUri: string | null;
  onClose: () => void;
  onMcpEnabledChange: (enabled: boolean) => void;
  onMcpTokenChange: (token: string) => void;
  onThemeModeChange: (value: ThemeMode) => void;
  onLanguageChange: (value: "zh-CN" | "en") => void;
  onRuntimePreferenceChange: (value: RuntimePreference) => void;
  onCanvasChange: (patch: Partial<CanvasSettings>) => void;
  onOpenSmb: () => void;
  onOpenAgent: () => void;
  onDebugModeChange: (checked: boolean) => void;
  onAutomatedDiagnosticsEnabledChange: (checked: boolean) => void;
  onOpenDiagnostics: () => void;
  onConfigureFolder: () => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
}) {
  if (!open) return null;
  const L = (zh: string, en: string) => language === "en" ? en : zh;
  const range = (label: string, output: string, value: number, min: number, max: number, step: number, key: keyof CanvasSettings) => <label className="settings-range"><span><strong>{label}</strong><output>{output}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onCanvasChange({ [key]: Number(event.target.value) } as Partial<CanvasSettings>)} /></label>;
  const sectionHeading = (title: string, hint: string) => <div className="settings-section__heading"><h3>{title}</h3><small>{hint}</small></div>;
  return <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label={L("设置", "Settings")}>
    <section className="settings-dialog settings-dialog--adaptive">
      <header><div className="settings-title-line"><strong>{L("设置", "Settings")}</strong><span className="settings-version-inline" aria-label={L(`软件版本 ${APP_VERSION}`, `Software version ${APP_VERSION}`)}><i aria-hidden="true">|</i> v{APP_VERSION}</span></div><button className="dialog-close-button" aria-label={L("关闭设置", "Close settings")} onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></header>
      <div className="settings-dialog__body settings-layout">
        <section className="settings-section settings-section--appearance">{sectionHeading(L("外观", "Appearance"), L("主题与界面语言", "Theme and interface language"))}<div className="settings-control-grid"><label><span>{L("主题", "Theme")}</span><ThemedSelect ariaLabel={L("主题", "Theme")} value={themeMode} options={[{ value: "system", label: L("跟随系统", "System") }, { value: "dark", label: L("暗色模式", "Dark") }, { value: "light", label: L("亮色模式", "Light") }]} onChange={(value) => onThemeModeChange(value as ThemeMode)} /></label><label><span>{L("语言", "Language")}</span><ThemedSelect ariaLabel={L("语言", "Language")} value={language} options={[{ value: "zh-CN", label: "中文" }, { value: "en", label: "English" }]} onChange={(value) => onLanguageChange(value as "zh-CN" | "en")} /></label></div><small className="settings-section__note">{L("当前生效", "Active")}: {resolvedTheme === "dark" ? L("暗色", "Dark") : L("亮色", "Light")}</small></section>

        <section className="settings-section settings-runtime-section">{sectionHeading(L("执行引擎", "Execution engine"), L("选择工作流默认运行环境", "Choose the default workflow runtime"))}<label className="settings-primary-control"><span>{L("工作流运行时", "Workflow runtime")}</span><ThemedSelect ariaLabel={L("工作流运行时", "Workflow runtime")} value={runtimePreference} options={[{ value: "auto", label: L("自动选择（推荐）", "Auto (recommended)") }, { value: "python", label: L("Python · 完整兼容", "Python · full compatibility") }, { value: "javascript", label: L("JavaScript · 实验", "JavaScript · experimental") }]} onChange={(value) => onRuntimePreferenceChange(value as RuntimePreference)} /></label><p>{runtimePreference === "auto" ? L("Auto 会在执行前检查节点兼容性：全部支持时选择 JavaScript，否则选择 Python。", "Auto checks node compatibility before execution: JavaScript when fully supported, otherwise Python.") : runtimePreference === "javascript" ? L("纯前端执行并支持交互式图表；不兼容节点会明确提示。", "Runs fully in the frontend with interactive charts; incompatible nodes are reported explicitly.") : L("始终使用 Python，兼容 Notebook、自定义函数与完整节点目录。", "Always use Python for Notebook, custom functions, and the full node catalog.")}</p></section>

        <section className="settings-section settings-section--canvas">{sectionHeading(L("画布", "Canvas"), L("主题、尺寸、线条与面板布局", "Theme, size, lines and panel layout"))}<div className="settings-canvas-select-row"><label className="settings-canvas-select"><span>{L("画布主题", "Canvas theme")}</span><ThemedSelect ariaLabel={L("画布主题", "Canvas theme")} value={canvas.theme} options={CANVAS_THEMES.map((theme) => ({ value: theme.id, label: L(theme.labelZh, theme.labelEn) }))} onChange={(value) => onCanvasChange({ theme: value as CanvasThemeId })} /></label><label className="settings-canvas-select"><span>{L("缩略图", "Mini map")}</span><ThemedSelect ariaLabel={L("缩略图", "Mini map")} value={canvas.miniMapMode} options={[{ value: "hide", label: L("默认隐藏", "Hidden") }, { value: "auto", label: L("自动显示", "Auto") }, { value: "show", label: L("始终显示", "Always") }]} onChange={(value) => onCanvasChange({ miniMapMode: value as CanvasSettings["miniMapMode"] })} /></label></div><div className="settings-range-grid">{range(L("节点尺寸", "Node size"), `${Math.round(canvas.nodeScale * 100)}%`, canvas.nodeScale, 0.75, 1.4, 0.05, "nodeScale")}{range(L("端点大小", "Handle size"), `${Math.round(canvas.endpointScale * 100)}%`, canvas.endpointScale, 0.7, 1.8, 0.1, "endpointScale")}{range(L("连线粗细", "Edge width"), `${canvas.edgeWidth.toFixed(1)} px`, canvas.edgeWidth, 1, 5, 0.5, "edgeWidth")}{range(L("左侧节点栏", "Left palette"), `${Math.round(canvas.paletteWidth)} px`, canvas.paletteWidth, 216, 360, 4, "paletteWidth")}{range(L("右侧参数栏", "Right inspector"), `${Math.round(canvas.inspectorWidth)} px`, canvas.inspectorWidth, 250, 560, 4, "inspectorWidth")}{range(L("横屏参数栏", "Landscape inspector"), `${Math.round(canvas.inspectorHeight)} px`, canvas.inspectorHeight, 140, 440, 4, "inspectorHeight")}</div><div className="settings-canvas-result-row">{range(L("结果区高度", "Result height"), `${Math.round(canvas.resultHeight)} px`, canvas.resultHeight, 180, 520, 4, "resultHeight")}<label className="settings-check settings-node-insights"><input type="checkbox" checked={canvas.showNodeInsights} onChange={(event) => onCanvasChange({ showNodeInsights: event.target.checked })} />{L("显示节点运行结果", "Show node results")}</label></div></section>


        <section className="settings-section settings-smb-summary">{sectionHeading(L("局域网 SMB", "LAN SMB"), L("网络文件位置", "Network file locations"))}<div className="settings-summary-list"><span><small>{L("设备", "Device")}</small><strong>{smbServer || L("尚未选择", "Not selected")}</strong></span><span><small>{L("共享", "Share")}</small><strong>{smbShare || L("尚未选择", "Not selected")}</strong></span><span><small>{L("登录", "Login")}</small><strong>{smbGuest ? L("访客", "Guest") : smbUsername || L("账号未填写", "No account")}</strong></span></div><button className="button secondary" disabled={smbDisabled} onClick={onOpenSmb}>{L("打开网络文件管理器", "Open network file manager")}</button></section>

        <section className="settings-section settings-agent-summary">{sectionHeading("AI Agent", L("模型、密钥、MCP 与操作权限", "Model, key, MCP and permissions"))}<label className="settings-check settings-check--inline settings-agent-mcp-toggle"><input type="checkbox" checked={mcpEnabled && mcpAvailable} disabled={!mcpAvailable || !mcpToken.trim()} onChange={(event) => onMcpEnabledChange(event.target.checked)} />{L("开启 MCP Server", "Enable MCP Server")}</label><button onClick={onOpenAgent}>{L("AI 模型与 MCP", "AI model & MCP")}</button></section>

        <section className="settings-section settings-debug-section">{sectionHeading(L("调试与诊断", "Debug & diagnostics"), L("执行检查与诊断", "Execution inspection and diagnostics"))}<label className="settings-check"><input type="checkbox" checked={debugMode} onChange={(event) => onDebugModeChange(event.target.checked)} />{L("启用调试模式", "Enable debug mode")}</label><label className="settings-check"><input type="checkbox" checked={automatedDiagnosticsEnabled} onChange={(event) => onAutomatedDiagnosticsEnabledChange(event.target.checked)} />{L("启用自动诊断", "Enable automated diagnostics")}</label><p>{L("记录执行顺序、节点耗时、部分结果和运行时错误信息。", "Records execution order, node timings, selected results, and runtime errors.")}</p><div className="settings-inline-actions">{automatedDiagnosticsEnabled && <button className="button primary" onClick={onOpenDiagnostics}>{L("运行自动诊断", "Run diagnostics")}</button>}</div></section>

        <section className="settings-section settings-profile-section">{sectionHeading(L("配置文件", "Profile"), L("本机设置、流程与用户模板", "Local settings, workflows and templates"))}<dl><dt>应用配置目录</dt><dd>{profilePath ?? "正在读取…"}</dd><dt>用户流程文件夹</dt><dd>{workspaceUri ?? "使用应用默认流程库"}</dd></dl><div><button onClick={onConfigureFolder}>选择 / 跳转文件夹</button><button onClick={onExportSettings}>{L("导出设置", "Export settings")}</button><button onClick={onImportSettings}>{L("导入设置", "Import settings")}</button></div><small>导出文件不包含 AI API Key；密钥继续使用当前设备的加密存储。</small></section>
      </div>
    </section>
  </div>;
}
