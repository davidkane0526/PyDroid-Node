import { useEffect, useMemo, useRef, useState } from "react";
import { installNodePluginArchive } from "./archive";
import {
  activateInstalledNodePluginPackage,
  getNodePluginIconDataUrl,
  installNodePluginPackage,
  listInstalledNodePluginPackageDetails,
  unloadNodePluginPackage,
  uninstallNodePluginPackage,
  type NodePluginPackageDetail,
} from "./packages";
import { nodeDisplayName, pluginDisplayName, type UiLanguage } from "./displayNames";

type NodePluginManagerProps = {
  open: boolean;
  language: UiLanguage;
  onClose: () => void;
};

type StatusFilter = "all" | "active" | "inactive";
type RuntimeFilter = "all" | "python" | "javascript";

function pluginHasRuntime(plugin: NodePluginPackageDetail, runtime: Exclude<RuntimeFilter, "all">): boolean {
  return plugin.nodes.some((node) => node.runtimes.includes(runtime));
}

export function NodePluginManager({ open, language, onClose }: NodePluginManagerProps) {
  const [plugins, setPlugins] = useState<NodePluginPackageDetail[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const L = (zh: string, en: string) => language === "en" ? en : zh;

  const refresh = () => setPlugins(listInstalledNodePluginPackageDetails());
  useEffect(() => {
    if (!open) return;
    refresh();
    setError("");
  }, [open]);

  const install = async (file: File) => {
    try {
      if (file.name.toLowerCase().endsWith(".zip")) await installNodePluginArchive(await file.arrayBuffer());
      else installNodePluginPackage(await file.text());
      refresh();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const activate = (id: string) => {
    try { activateInstalledNodePluginPackage(id); refresh(); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const unload = (id: string) => { unloadNodePluginPackage(id); refresh(); };
  const uninstall = (id: string) => { uninstallNodePluginPackage(id); refresh(); };

  const stats = useMemo(() => ({
    total: plugins.length,
    active: plugins.filter((plugin) => plugin.active).length,
    nodes: plugins.reduce((sum, plugin) => sum + plugin.nodes.length, 0),
    themes: plugins.reduce((sum, plugin) => sum + plugin.themes.length, 0),
    python: plugins.filter((plugin) => pluginHasRuntime(plugin, "python")).length,
    javascript: plugins.filter((plugin) => pluginHasRuntime(plugin, "javascript")).length,
  }), [plugins]);

  const filteredPlugins = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return plugins.filter((plugin) => {
      if (statusFilter === "active" && !plugin.active) return false;
      if (statusFilter === "inactive" && plugin.active) return false;
      if (runtimeFilter !== "all" && !pluginHasRuntime(plugin, runtimeFilter)) return false;
      if (!keyword) return true;
      const searchable = [
        plugin.id,
        plugin.name,
        pluginDisplayName(plugin.id, plugin.name, language),
        plugin.description ?? "",
        ...plugin.nodes.flatMap((node) => [node.nodeType, node.label, nodeDisplayName(node.nodeType, node.label, language)]),
        ...plugin.themes.flatMap((theme) => [theme.id, theme.labelZh, theme.labelEn]),
      ].join("\n").toLocaleLowerCase();
      return searchable.includes(keyword);
    });
  }, [language, plugins, query, runtimeFilter, statusFilter]);

  if (!open) return null;
  return <div className="node-plugin-manager-backdrop" role="dialog" aria-modal="true" aria-label={L("插件管理", "Plugins")}>
    <section className="node-plugin-manager">
      <header>
        <div className="node-plugin-manager__heading"><strong>{L("插件管理", "Plugins")}</strong><span>{L("统一管理节点、运行时与界面主题扩展", "Manage node, runtime, and UI theme extensions")}</span></div>
        <div className="node-plugin-manager__header-actions">
          <button type="button" className="button primary node-plugin-manager__install" onClick={() => fileInput.current?.click()}>＋ {L("安装插件", "Install plugin")}</button>
          <button type="button" className="node-plugin-manager__close" aria-label={L("关闭插件管理", "Close plugins")} onClick={onClose}>×</button>
        </div>
        <input ref={fileInput} type="file" accept=".plugin.zip,.zip,.json,application/zip,application/json" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void install(file); }} />
      </header>

      <div className="node-plugin-manager__stats" aria-label={L("插件统计", "Plugin statistics")}>
        <div><span>{L("插件", "Plugins")}</span><strong>{stats.total}</strong></div>
        <div><span>{L("已启用", "Enabled")}</span><strong>{stats.active}</strong></div>
        <div><span>{L("节点", "Nodes")}</span><strong>{stats.nodes}</strong></div>
        <div><span>{L("主题", "Themes")}</span><strong>{stats.themes}</strong></div>
        <div><span>Python</span><strong>{stats.python}</strong></div>
        <div><span>JS</span><strong>{stats.javascript}</strong></div>
      </div>

      <div className="node-plugin-manager__filters">
        <label className="node-plugin-manager__search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={L("搜索插件、节点或 ID", "Search plugins, nodes, or IDs")} /></label>
        <div className="node-plugin-manager__filter-group" aria-label={L("状态筛选", "Status filter")}>
          {(["all", "active", "inactive"] as const).map((value) => <button key={value} type="button" className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{value === "all" ? L("全部", "All") : value === "active" ? L("已启用", "Enabled") : L("已停用", "Disabled")}</button>)}
        </div>
        <div className="node-plugin-manager__filter-group" aria-label={L("运行时筛选", "Runtime filter")}>
          {(["all", "python", "javascript"] as const).map((value) => <button key={value} type="button" className={runtimeFilter === value ? "active" : ""} onClick={() => setRuntimeFilter(value)}>{value === "all" ? L("全部运行时", "All runtimes") : value === "python" ? "Python" : "JS"}</button>)}
        </div>
      </div>

      <div className="node-plugin-manager__meta">
        {error && <pre className="node-plugin-manager__error">{error}</pre>}
        <div className="node-plugin-manager__result-bar"><span>{L(`显示 ${filteredPlugins.length} / ${plugins.length} 个插件`, `Showing ${filteredPlugins.length} / ${plugins.length} plugins`)}</span>{(query || statusFilter !== "all" || runtimeFilter !== "all") && <button type="button" onClick={() => { setQuery(""); setStatusFilter("all"); setRuntimeFilter("all"); }}>{L("清除筛选", "Clear filters")}</button>}</div>
      </div>

      <div className="node-plugin-manager__list">
        {filteredPlugins.map((plugin) => <article key={plugin.id} className={plugin.themes.length && !plugin.nodes.length ? "node-plugin-manager__theme-package" : undefined}>
          <div className="node-plugin-manager__identity">
            <div className="node-plugin-manager__title"><strong title={plugin.name}>{pluginDisplayName(plugin.id, plugin.name, language)}</strong><span>v{plugin.version}</span></div>
            <em className={plugin.active ? "active" : ""}>{plugin.active ? L("已启用", "Enabled") : L("已停用", "Disabled")}</em>
          </div>
          {plugin.description && <p className="node-plugin-manager__description">{plugin.description}</p>}
          {plugin.nodes.length > 0 && <div className="node-plugin-manager__nodes">{plugin.nodes.map((node) => <div key={node.nodeType}>
            <div className="node-plugin-manager__node-name">{node.iconDataUrl ? <img className="node-plugin-manager__node-icon" src={node.iconDataUrl} alt=""/> : <span className="node-plugin-manager__node-dot" aria-hidden="true"/>}<span title={node.label}>{nodeDisplayName(node.nodeType, node.label, language)}</span></div>
            <code title={node.nodeType}>{node.nodeType}</code>
            <small>{node.runtimes.map((runtime) => runtime === "javascript" ? "JS" : "Python").join(" · ")}</small>
          </div>)}</div>}
          {plugin.themes.length > 0 && <div className="node-plugin-manager__themes" aria-label={L("主题", "Themes")}>{plugin.themes.map((theme) => <div key={theme.id}>
            <span className="node-plugin-manager__theme-swatch" aria-hidden="true"/>
            <strong>{language === "en" ? theme.labelEn : theme.labelZh}</strong>
            <code title={theme.id}>{theme.id}</code>
          </div>)}</div>}
          <footer>
            <code className="node-plugin-manager__package-id" title={plugin.id}>{plugin.id}</code>
            <div>{plugin.active ? <button type="button" onClick={() => unload(plugin.id)}>{L("停用", "Disable")}</button> : <button type="button" onClick={() => activate(plugin.id)}>{L("启用", "Enable")}</button>}<button type="button" className="danger-link" onClick={() => uninstall(plugin.id)}>{L("卸载", "Uninstall")}</button></div>
          </footer>
        </article>)}
        {!filteredPlugins.length && <div className="node-plugin-manager__empty">{plugins.length ? L("没有符合当前筛选条件的插件", "No plugins match the current filters") : L("暂无插件", "No plugins installed")}</div>}
      </div>
    </section>
  </div>;
}

export { getNodePluginIconDataUrl };
