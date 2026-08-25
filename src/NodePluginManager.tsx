import { useRef, useState } from "react";
import {
  activateInstalledNodePluginPackage,
  installNodePluginPackage,
  listInstalledNodePluginPackageDetails,
  unloadNodePluginPackage,
  uninstallNodePluginPackage,
  type NodePluginPackageDetail,
} from "./nodePluginPackages";

type NodePluginManagerButtonProps = {
  mode?: "icon" | "menu";
  onOpen?: () => void;
};

const pluginIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6v4h4v6h-4v6H9v-6H5V8h4z"/><path d="M9 9h6v6H9z"/></svg>;

export function NodePluginManagerButton({ mode = "icon", onOpen }: NodePluginManagerButtonProps) {
  const [open, setOpen] = useState(false);
  const [plugins, setPlugins] = useState<NodePluginPackageDetail[]>([]);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => setPlugins(listInstalledNodePluginPackageDetails());
  const show = () => {
    onOpen?.();
    refresh();
    setError("");
    setOpen(true);
  };
  const install = async (file: File) => {
    try {
      installNodePluginPackage(await file.text());
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

  return <>
    {mode === "icon"
      ? <button className="button secondary icon-button topbar-tool-action" title="节点插件" aria-label="节点插件" onClick={show}>{pluginIcon}</button>
      : <button type="button" onClick={show}>{pluginIcon}<span>节点插件</span></button>}
    {open && <div className="node-plugin-manager-backdrop" role="dialog" aria-modal="true" aria-label="节点插件">
      <section className="node-plugin-manager">
        <header><strong>节点插件</strong><button type="button" aria-label="关闭节点插件" onClick={() => setOpen(false)}>×</button></header>
        <div className="node-plugin-manager__toolbar">
          <button type="button" className="button primary" onClick={() => fileInput.current?.click()}>安装 Manifest</button>
          <input ref={fileInput} type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void install(file); }} />
        </div>
        {error && <pre className="node-plugin-manager__error">{error}</pre>}
        <div className="node-plugin-manager__list">
          {plugins.map((plugin) => <article key={plugin.id}>
            <div className="node-plugin-manager__identity"><strong>{plugin.name}</strong><span>v{plugin.version}</span><em className={plugin.active ? "active" : ""}>{plugin.active ? "已启用" : "已停用"}</em></div>
            <div className="node-plugin-manager__nodes">{plugin.nodes.map((node) => <div key={node.nodeType}><span>{node.label}</span><code>{node.nodeType}</code><small>{node.runtimes.map((runtime) => runtime === "javascript" ? "JS" : "Python").join(" · ")}</small></div>)}</div>
            <footer>{plugin.active ? <button type="button" onClick={() => unload(plugin.id)}>停用</button> : <button type="button" onClick={() => activate(plugin.id)}>启用</button>}<button type="button" className="danger-link" onClick={() => uninstall(plugin.id)}>卸载</button></footer>
          </article>)}
          {!plugins.length && <div className="node-plugin-manager__empty">暂无节点插件</div>}
        </div>
      </section>
    </div>}
  </>;
}
