import { AGENT_PRESETS, presetById, type AgentPlan, type AgentSettings } from "./agent";
import type { ExecutionResult, NodeExecutionPreview, TablePreview } from "./execution";
import type { WorkflowNode } from "./workflow";
import { DataGrid, resultPreviewText } from "./components";

export type HistoryEntry = { id: number; at: Date; summary: string };
export type ResultDetail = { title: string; text: string; preview?: TablePreview };
export type ReplacementCandidate = { nodeType: string; label: string; inputPorts: { valueType: string }[]; outputPorts: { valueType: string }[] };
export type ExecutionErrorView = { title: string; nodeType?: string; nodeId?: string; message: string; traceback?: string | null };

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
  return <div className="settings-backdrop error-detail-backdrop" role="dialog" aria-modal="true" aria-label="执行错误详情"><section className="error-detail-dialog"><header><div><strong>{error.title}</strong><span>{error.nodeType ? `${error.nodeType} · ${error.nodeId ?? "工作流"}` : "工作流级错误"}</span></div><button onClick={onClose}>×</button></header><div><p>{error.message}</p>{error.traceback && <details><summary>Python 调试堆栈</summary><pre>{error.traceback}</pre></details>}{error.nodeId && canLocate && <button onClick={() => onLocate(error.nodeId!)}>定位错误节点</button>}<button onClick={onCopy}>复制错误</button></div></section></div>;
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

export function PlotLightbox({ open, src, zoom, onZoom, onClose }: {
  open: boolean;
  src: string;
  zoom: number;
  onZoom: (value: number) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return <div className="plot-lightbox" role="dialog" aria-modal="true" aria-label="图表放大预览">
    <header>
      <strong>图表预览</strong>
      <div>
        <button onClick={() => onZoom(Math.max(.5, zoom - .25))}>−</button>
        <button onClick={() => onZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button onClick={() => onZoom(Math.min(4, zoom + .25))}>＋</button>
        <button onClick={onClose}>关闭</button>
      </div>
    </header>
    <div className="plot-lightbox__body"><img style={{ width: zoom === 1 ? "auto" : `${zoom * 100}%`, maxWidth: zoom === 1 ? "100%" : "none" }} src={src} alt="放大的 Python 绘图结果" /></div>
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

export function SmbDialog({ open, servers, connection, guest, rememberPassword, passwordVisible, loading, error, path, entries, selected, scannedShares, onClose, onDiscover, onSelectServer, onConnectionChange, onGuestChange, onRememberPasswordChange, onPasswordVisibleChange, onScanShares, onBrowse, onImportSelection, onToggleSelected }: {
  open: boolean;
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
  onBrowse: (path: string) => void;
  onImportSelection: (importAll: boolean) => void;
  onToggleSelected: (path: string, checked: boolean) => void;
}) {
  if (!open) return null;
  return <div className="settings-backdrop smb-backdrop" role="dialog" aria-modal="true" aria-label="内置 SMB 文件浏览器"><section className="smb-dialog">
    <header><div><strong>局域网 SMB 文件选择</strong><span>选择设备和共享，登录后像文件管理器一样浏览文件</span></div><button aria-label="关闭 SMB 文件选择" onClick={onClose}>×</button></header>
    <section className="smb-discovery"><div className="smb-section-title"><div><strong>1 · 选择设备</strong><small>扫描会先使用 Windows 的 net view 发现主机名，再补充 445 端口探测；可读取的共享显示在设备卡片上。</small></div><button className="button secondary" disabled={loading} onClick={onDiscover}>{loading ? "正在扫描…" : "扫描设备"}</button></div><div className="smb-server-grid">{servers.map((server) => <button key={server.address} className={connection.server === server.address ? "active" : ""} onClick={() => onSelectServer(server.address, server.shares)}><span>▣</span><strong>{server.name || server.address}</strong><small>{server.shares?.length ? `共享：${server.shares.join("、")}` : `IP · ${server.address}`}</small>{server.name !== server.address && <em>{server.address}</em>}</button>)}</div></section>
    <section className="smb-login"><div className="smb-section-title"><div><strong>2 · 登录并选择共享</strong><small>共享名是 <code>\\主机名\共享名</code> 中反斜杠后的第一段（可能含空格，如 “Noe Lab 共享数据”）；可点“读取共享列表”自动枚举。</small></div></div><div className="smb-connection"><label>服务器<input placeholder="主机名或 IP，例如 Noe-Lab" value={connection.server} onChange={(event) => onConnectionChange({ server: event.target.value })} /></label><label>共享名<input list="smb-shares" placeholder="共享名，例如 Noe Lab 共享数据" value={connection.share} onChange={(event) => onConnectionChange({ share: event.target.value })} /><datalist id="smb-shares">{scannedShares.map((share) => <option key={share} value={share} />)}</datalist></label><label className="smb-guest"><input type="checkbox" checked={guest} onChange={(event) => onGuestChange(event.target.checked)} />访客登录</label>{!guest && <><label>域（可选）<input value={connection.domain} onChange={(event) => onConnectionChange({ domain: event.target.value })} /></label><label>用户名<input autoComplete="username" value={connection.username} onChange={(event) => onConnectionChange({ username: event.target.value })} /></label><label>密码<span className="password-field"><input type={passwordVisible ? "text" : "password"} autoComplete="current-password" value={connection.password} onChange={(event) => onConnectionChange({ password: event.target.value })} /><button type="button" aria-label={passwordVisible ? "隐藏密码" : "显示密码"} title={passwordVisible ? "隐藏密码" : "显示密码"} onClick={onPasswordVisibleChange}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>{passwordVisible && <path d="m4 4 16 16"/>}</svg></button></span></label></>}<div className="smb-login-actions"><button disabled={loading || !connection.server.trim()} onClick={onScanShares}>{loading ? "读取中…" : "读取共享列表"}</button><button className="primary" disabled={loading || !connection.server.trim() || !connection.share.trim()} onClick={() => onBrowse("")}>{loading ? "连接中…" : "进入所选共享"}</button></div></div></section>
    <div className="smb-path"><button disabled={!path || loading} onClick={() => onBrowse(path.split("/").slice(0, -1).join("/"))}>上一级</button><code>/{path}</code><button disabled={loading || !entries.some((entry) => !entry.directory)} onClick={() => onImportSelection(true)}>导入当前文件夹</button></div>
    {error && <p className="validation-error">{error}</p>}
    <div className="smb-list">{entries.map((entry) => entry.directory ? <button className="smb-folder" key={entry.path} onClick={() => onBrowse(entry.path)}><span>▸</span><strong>{entry.name}</strong><small>文件夹</small></button> : <label key={entry.path}><input type="checkbox" checked={selected.includes(entry.path)} onChange={(event) => onToggleSelected(entry.path, event.target.checked)} /><strong>{entry.name}</strong><small>{entry.size > 1024 * 1024 ? `${(entry.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(entry.size / 1024)} KB`}</small></label>)}</div>
    <footer>{!guest && <label className="smb-remember"><input type="checkbox" checked={rememberPassword} onChange={(event) => onRememberPasswordChange(event.target.checked)} />使用系统安全存储保存密码</label>}<span>已选择 {selected.length} 个文件</span><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={loading || !selected.length} onClick={() => onImportSelection(false)}>导入所选</button></footer>
  </section></div>;
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
  return <div className="settings-backdrop interaction-backdrop" role="dialog" aria-modal="true" aria-label={String(node.data.parameters.title ?? "提示")} onKeyDown={(event) => { if (event.key === "Escape" && String(node.data.parameters.cancelLabel ?? "取消").trim()) onSubmit(null); }}><section className="interaction-dialog interaction-dialog--alert"><header><span className="interaction-dialog__icon" aria-hidden="true">!</span><div><strong>{String(node.data.parameters.title ?? "提示")}</strong><small>“内容”端口支持文本、表格、图片、时间及任意可预览值</small></div></header><div className="interaction-dialog__content"><p>{String(node.data.parameters.message ?? "流程正在执行。")}</p>{preview?.kind === "table" ? <DataGrid preview={preview.preview} /> : preview?.kind === "plot" ? <img className="interaction-dialog__image-preview" src={`data:image/png;base64,${preview.plotPngBase64}`} alt="弹窗输入图像" /> : preview?.kind === "value" ? <pre className="interaction-dialog__value">{preview.text}</pre> : <small>首次运行时先执行上游后即可在此自适应显示内容；选择结果仍由 output 端口输出。</small>}</div><footer className="interaction-dialog__choices">{String(node.data.parameters.cancelLabel ?? "取消").trim() && <button className="button secondary" onClick={() => onSubmit(null)}>{String(node.data.parameters.cancelLabel)}</button>}{String(node.data.parameters.exitLabel ?? "退出").trim() && <button className="button alert-false" onClick={() => onSubmit(false)}>{String(node.data.parameters.exitLabel)}</button>}{String(node.data.parameters.confirmLabel ?? "确认").trim() && <button autoFocus className="button primary" onClick={() => onSubmit(true)}>{String(node.data.parameters.confirmLabel)}</button>}{!["cancelLabel", "exitLabel", "confirmLabel"].some((key) => String(node.data.parameters[key] ?? "").trim()) && <button autoFocus className="button secondary" onClick={() => onSubmit(null)}>关闭</button>}</footer><div className="interaction-dialog__result-legend"><span><b>true</b> 确认</span><span><b>false</b> 退出</span><span><b>None</b> 取消</span></div></section></div>;
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

export function AgentDialog({ open, settings, apiKey, keyStorageHint, testing, connectionStatus, language, instruction, requesting, planText, plan, planError, audit, onClose, onPresetSelect, onSettingsChange, onApiKeyChange, onLanguageChange, onTestConnection, onInstructionChange, onRequestPlan, onPlanTextChange, onReviewPlan, onApplyPlan }: {
  open: boolean;
  settings: AgentSettings;
  apiKey: string;
  keyStorageHint: string;
  testing: boolean;
  connectionStatus: string | null;
  language: string;
  instruction: string;
  requesting: boolean;
  planText: string;
  plan: AgentPlan | null;
  planError: string | null;
  audit: { at: string; summary: string; result: string }[];
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
}) {
  if (!open) return null;
  const permissions = settings.permissions;
  return <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="AI Agent 设置">
    <section className="settings-dialog agent-dialog">
      <header><div><strong>AI Agent 设置</strong><span>AI 只提出计划；画布变更仍需确认</span></div><button aria-label="关闭 AI Agent" onClick={onClose}>×</button></header>
      <div className="settings-dialog__body">
        <section><h3>模型与连接</h3>
          <label>供应商<select value={settings.presetId} onChange={(event) => onPresetSelect(event.target.value)}>{AGENT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
          <label>协议<select value={settings.provider} onChange={(event) => onSettingsChange({ provider: event.target.value as AgentSettings["provider"], presetId: "custom" })}><option value="openai-responses">OpenAI Responses</option><option value="openai-compatible">OpenAI 兼容 Chat</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
          <label>接口地址<input value={settings.endpoint} onChange={(event) => onSettingsChange({ endpoint: event.target.value, presetId: "custom" })} /></label>
          <label>模型<select value={settings.model} onChange={(event) => onSettingsChange({ model: event.target.value })}><option value="">选择或自定义模型</option>{presetById(settings.presetId).models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
          {presetById(settings.presetId).note && <small className="agent-preset-note">{presetById(settings.presetId).note}</small>}
          <label>自定义模型<input value={settings.model} placeholder="模型 ID，例如 deepseek-chat" onChange={(event) => onSettingsChange({ model: event.target.value })} /></label>
          <label>API 密钥<input type="password" autoComplete="off" value={apiKey} placeholder={keyStorageHint} onChange={(event) => onApiKeyChange(event.target.value)} /></label>
          <label>规划语言<select value={language} onChange={(event) => onLanguageChange(event.target.value as "zh-CN" | "en")}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
          <div className="agent-inline-actions"><button className="button secondary" disabled={testing} onClick={onTestConnection}>{testing ? "测试中…" : "尝试连接"}</button>{connectionStatus && <small className={connectionStatus.startsWith("连接成功") ? "agent-success" : "agent-failure"}>{connectionStatus}</small>}</div>
          <small>{keyStorageHint === "keystore" ? "Android 端使用 Keystore 加密保存，应用更新后仍可读取；不会写入设置、工作流或用户文件夹。" : keyStorageHint === "synced" ? "密钥来自已配对 Android 的加密密钥库，仅驻留当前网页内存；刷新页面会重新从 Android 同步。" : "桌面端密钥只驻留当前会话，不会写入设置、工作流或用户文件夹。"}</small>
        </section>
        <section><h3>AI 权限</h3>
          <label className="settings-check"><input type="checkbox" checked={permissions.createNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, createNodes: event.target.checked } })} />创建节点</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.groupNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, groupNodes: event.target.checked } })} />组合节点</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.updateParameters} onChange={(event) => onSettingsChange({ permissions: { ...permissions, updateParameters: event.target.checked } })} />修改参数与标签</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.deleteNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, deleteNodes: event.target.checked } })} />删除节点</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.connectNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, connectNodes: event.target.checked } })} />创建连线</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.disconnectNodes} onChange={(event) => onSettingsChange({ permissions: { ...permissions, disconnectNodes: event.target.checked } })} />断开连线</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.arrangeLayout} onChange={(event) => onSettingsChange({ permissions: { ...permissions, arrangeLayout: event.target.checked } })} />整理布局</label>
          <label className="settings-check"><input type="checkbox" checked={permissions.runWorkflow} onChange={(event) => onSettingsChange({ permissions: { ...permissions, runWorkflow: event.target.checked } })} />执行工作流</label>
        </section>
        <section className="agent-request"><h3>创建计划</h3><textarea value={instruction} placeholder="例如：读取两个 CSV，按日期合并后绘制销售额折线图" onChange={(event) => onInstructionChange(event.target.value)} /><button className="button primary" disabled={requesting} onClick={onRequestPlan}>{requesting ? "AI 正在规划…" : "请求 AI 计划"}</button><small>模型不能直接执行 Python、访问文件或改写工作流 JSON。</small></section>
        <section className="agent-plan"><h3>计划预览</h3><textarea spellCheck={false} value={planText} placeholder={"可粘贴或检查 AI 返回的 JSON 计划，例如：\n{\"summary\":\"添加读取节点\",\"operations\":[]}"} onChange={(event) => onPlanTextChange(event.target.value)} /><div><button className="button secondary" onClick={onReviewPlan}>检查计划</button><button className="button primary" disabled={!plan || requesting} onClick={onApplyPlan}>确认并应用</button></div>{planError && <p className="validation-error">{planError}</p>}{plan && <p>将执行：{plan.summary}（{plan.operations.length} 项操作）</p>}</section>
        <section><h3>审计</h3>{audit.length ? <ol className="agent-audit">{audit.slice(0, 5).map((entry) => <li key={`${entry.at}-${entry.summary}`}><strong>{entry.summary}</strong><span>{entry.result}</span></li>)}</ol> : <p className="muted">尚无 AI 操作记录。</p>}</section>
      </div>
    </section>
  </div>;
}

type ThemeMode = "system" | "dark" | "light";
type CanvasSettings = { nodeScale: number; endpointScale: number; edgeWidth: number; paletteWidth: number; inspectorWidth: number; inspectorHeight: number; resultHeight: number; miniMapMode: "auto" | "show" | "hide"; showNodeInsights: boolean };

export function SettingsDialog({ open, themeMode, language, resolvedTheme, canvas, smbServer, smbShare, smbGuest, smbUsername, smbDisabled, debugMode, hotReloadEnabled, profilePath, workspaceUri, onClose, onThemeModeChange, onLanguageChange, onCanvasChange, onOpenSmb, onOpenAgent, onDebugModeChange, onConfigureFolder, onExportSettings, onImportSettings }: {
  open: boolean;
  themeMode: ThemeMode;
  language: string;
  resolvedTheme: "dark" | "light";
  canvas: CanvasSettings;
  smbServer: string;
  smbShare: string;
  smbGuest: boolean;
  smbUsername: string;
  smbDisabled: boolean;
  debugMode: boolean;
  hotReloadEnabled: boolean;
  profilePath: string | null;
  workspaceUri: string | null;
  onClose: () => void;
  onThemeModeChange: (value: ThemeMode) => void;
  onLanguageChange: (value: "zh-CN" | "en") => void;
  onCanvasChange: (patch: Partial<CanvasSettings>) => void;
  onOpenSmb: () => void;
  onOpenAgent: () => void;
  onDebugModeChange: (checked: boolean) => void;
  onConfigureFolder: () => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
}) {
  if (!open) return null;
  const range = (label: string, output: string, value: number, min: number, max: number, step: number, key: keyof CanvasSettings) => <label>{label} <output>{output}</output><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onCanvasChange({ [key]: Number(event.target.value) } as Partial<CanvasSettings>)} /></label>;
  return <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="设置">
    <section className="settings-dialog">
      <header><div><strong>设置</strong><span>设置会保存在本机用户配置中</span></div><button aria-label="关闭设置" onClick={onClose}>×</button></header>
      <div className="settings-dialog__body">
        <section><h3>外观</h3><label>主题<select value={themeMode} onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="dark">暗色模式</option><option value="light">亮色模式</option></select></label><label>界面语言<select value={language} onChange={(event) => onLanguageChange(event.target.value as "zh-CN" | "en")}><option value="zh-CN">中文</option><option value="en">English</option></select></label><small>当前生效：{resolvedTheme === "dark" ? "暗色" : "亮色"}。</small></section>
        <section><h3>画布</h3>{range("节点尺寸", `${Math.round(canvas.nodeScale * 100)}%`, canvas.nodeScale, 0.75, 1.4, 0.05, "nodeScale")}{range("端点大小", `${Math.round(canvas.endpointScale * 100)}%`, canvas.endpointScale, 0.7, 1.8, 0.1, "endpointScale")}{range("连线粗细", `${canvas.edgeWidth.toFixed(1)} px`, canvas.edgeWidth, 1, 5, 0.5, "edgeWidth")}{range("左侧节点栏", `${Math.round(canvas.paletteWidth)} px`, canvas.paletteWidth, 132, 360, 4, "paletteWidth")}{range("右侧参数栏", `${Math.round(canvas.inspectorWidth)} px`, canvas.inspectorWidth, 250, 560, 4, "inspectorWidth")}{range("横屏参数栏高度", `${Math.round(canvas.inspectorHeight)} px`, canvas.inspectorHeight, 140, 440, 4, "inspectorHeight")}{range("结果区高度", `${Math.round(canvas.resultHeight)} px`, canvas.resultHeight, 180, 520, 4, "resultHeight")}<label>缩略图<select value={canvas.miniMapMode} onChange={(event) => onCanvasChange({ miniMapMode: event.target.value as CanvasSettings["miniMapMode"] })}><option value="hide">默认隐藏</option><option value="auto">自动显示</option><option value="show">始终显示</option></select></label><label className="settings-check"><input type="checkbox" checked={canvas.showNodeInsights} onChange={(event) => onCanvasChange({ showNodeInsights: event.target.checked })} />显示节点运行结果</label></section>
        <section className="settings-smb-summary"><h3>局域网 SMB</h3><p>设备发现、账号或访客登录、共享选择和文件浏览集中在同一个文件选择器中。密码由 Android Keystore 或 Windows 系统安全存储加密保存。</p><dl><dt>当前设备</dt><dd>{smbServer || "尚未选择"}</dd><dt>当前共享</dt><dd>{smbShare || "尚未选择"}</dd><dt>登录方式</dt><dd>{smbGuest ? "访客" : smbUsername || "账号未填写"}</dd></dl><button className="button secondary" disabled={smbDisabled} onClick={onOpenSmb}>选择 SMB 文件</button></section>
        <section><h3>AI Agent</h3><p>通过顶部星形按钮设置模型、加密密钥及 AI 的画布权限。每次变更都需要在计划预览中确认。</p><button onClick={onOpenAgent}>AI 模型与密钥</button></section>
        <section><h3>调试与热更新</h3><label className="settings-check"><input type="checkbox" checked={debugMode} onChange={(event) => onDebugModeChange(event.target.checked)} />启用调试模式</label><p>调试模式保留节点执行顺序、单节点耗时、部分结果和 Python 堆栈；底部虫形按钮可打开调试面板。</p><p>当前前端热更新：{hotReloadEnabled ? "已连接 HMR" : "未启用（当前为构建版）"}</p><div className="settings-inline-actions"><button onClick={() => void navigator.clipboard.writeText("pnpm desktop:dev")}>桌面 HMR</button><button onClick={() => void navigator.clipboard.writeText("pnpm android:live:lan")}>Android LAN HMR</button></div><small>React、CSS 和 TypeScript 可即时更新；Electron 主进程需重启 desktop:dev，Android Java、Manifest、Gradle 和内置 Python 需要重新安装。</small></section>
        <section className="settings-profile-section"><h3>配置文件</h3><p>设置、自动保存、个人节点模板和用户代码会保存到应用用户配置目录。</p><dl><dt>应用配置目录</dt><dd>{profilePath ?? "正在读取…"}</dd><dt>用户流程文件夹</dt><dd>{workspaceUri ?? "使用应用默认流程库"}</dd></dl><div><button onClick={onConfigureFolder}>选择 / 跳转文件夹</button><button onClick={onExportSettings}>导出设置</button><button onClick={onImportSettings}>导入设置</button></div><small>导出文件不包含 AI API Key；密钥继续使用当前设备的加密存储。</small></section>
      </div>
    </section>
  </div>;
}
