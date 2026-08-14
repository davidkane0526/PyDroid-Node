import type { ExecutionResult, TablePreview } from "./execution";
import type { WorkflowNode } from "./workflow";
import { DataGrid } from "./components";

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
    <section className="smb-discovery"><div className="smb-section-title"><div><strong>1 · 选择设备</strong><small>扫描设备会查找局域网中提供 SMB 服务的 IP；可读取的共享显示在设备卡片上。</small></div><button className="button secondary" disabled={loading} onClick={onDiscover}>{loading ? "正在扫描…" : "扫描设备"}</button></div><div className="smb-server-grid">{servers.map((server) => <button key={server.address} className={connection.server === server.address ? "active" : ""} onClick={() => onSelectServer(server.address, server.shares)}><span>▣</span><strong>{server.shares?.length ? server.shares.join("、") : "共享待登录后读取"}</strong><small>IP · {server.address}</small>{server.name !== server.address && <em>{server.name}</em>}</button>)}</div></section>
    <section className="smb-login"><div className="smb-section-title"><div><strong>2 · 登录并选择共享</strong><small>访客登录不发送用户名和密码；若服务器不允许访客，请切换为账号登录。</small></div></div><div className="smb-connection"><label>服务器<input placeholder="192.168.1.10 或 NAS 名称" value={connection.server} onChange={(event) => onConnectionChange({ server: event.target.value })} /></label><label>共享名<input list="smb-shares" placeholder="例如 data" value={connection.share} onChange={(event) => onConnectionChange({ share: event.target.value })} /><datalist id="smb-shares">{scannedShares.map((share) => <option key={share} value={share} />)}</datalist></label><label className="smb-guest"><input type="checkbox" checked={guest} onChange={(event) => onGuestChange(event.target.checked)} />访客登录</label>{!guest && <><label>域（可选）<input value={connection.domain} onChange={(event) => onConnectionChange({ domain: event.target.value })} /></label><label>用户名<input autoComplete="username" value={connection.username} onChange={(event) => onConnectionChange({ username: event.target.value })} /></label><label>密码<span className="password-field"><input type={passwordVisible ? "text" : "password"} autoComplete="current-password" value={connection.password} onChange={(event) => onConnectionChange({ password: event.target.value })} /><button type="button" aria-label={passwordVisible ? "隐藏密码" : "显示密码"} title={passwordVisible ? "隐藏密码" : "显示密码"} onClick={onPasswordVisibleChange}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>{passwordVisible && <path d="m4 4 16 16"/>}</svg></button></span></label></>}<div className="smb-login-actions"><button disabled={loading || !connection.server.trim()} onClick={onScanShares}>{loading ? "读取中…" : "读取共享列表"}</button><button className="primary" disabled={loading || !connection.server.trim() || !connection.share.trim()} onClick={() => onBrowse("")}>{loading ? "连接中…" : "进入所选共享"}</button></div></div></section>
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
