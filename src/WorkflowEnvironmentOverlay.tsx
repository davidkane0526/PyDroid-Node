import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowEnvironment, WorkflowParameterDefinition } from "./workflow";

type CanvasFloatingAnchor = { left: number; top: number; panelWidth: number; panelHeight: number };

type Props = {
  tabName: string;
  environment: WorkflowEnvironment;
  parameters: WorkflowParameterDefinition[];
  requirements: string[];
  workspaceVariableNames: string[];
  layoutRevision: string;
  onRemoveImport: (index: number) => void;
  onParameterExpressionChange: (index: number, expression: string) => void;
  onRemoveParameter: (index: number) => void;
  onClearWorkspaceVariables: () => void;
  onOpenPackageManager: () => void;
  ui: (zh: string, en: string) => string;
};

function resolveCanvasFloatingAnchor(panel: DOMRect, occluders: DOMRect[], width = 66, height = 34, margin = 12): CanvasFloatingAnchor {
  const localOccluders = occluders
    .map((rect) => ({
      left: Math.max(0, rect.left - panel.left),
      top: Math.max(0, rect.top - panel.top),
      right: Math.min(panel.width, rect.right - panel.left),
      bottom: Math.min(panel.height, rect.bottom - panel.top),
    }))
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
  const xs = [Math.max(margin, panel.width - margin - width)];
  const ys = [Math.max(margin, panel.height - margin - height)];
  for (const rect of localOccluders) {
    xs.push(Math.max(margin, rect.left - margin - width));
    ys.push(Math.max(margin, rect.top - margin - height));
  }
  const intersects = (left: number, top: number) => localOccluders.some((rect) => (
    left < rect.right + margin && left + width > rect.left - margin
    && top < rect.bottom + margin && top + height > rect.top - margin
  ));
  const maxLeft = Math.max(margin, panel.width - margin - width);
  const maxTop = Math.max(margin, panel.height - margin - height);
  let best = { left: maxLeft, top: maxTop, score: -Infinity };
  for (const rawLeft of xs) {
    for (const rawTop of ys) {
      const left = Math.min(maxLeft, Math.max(margin, rawLeft));
      const top = Math.min(maxTop, Math.max(margin, rawTop));
      if (intersects(left, top)) continue;
      const score = top * 10_000 + left;
      if (score > best.score) best = { left, top, score };
    }
  }
  return { left: best.left, top: best.top, panelWidth: panel.width, panelHeight: panel.height };
}

export function WorkflowEnvironmentOverlay({ tabName, environment, parameters, requirements, workspaceVariableNames, layoutRevision, onRemoveImport, onParameterExpressionChange, onRemoveParameter, onClearWorkspaceVariables, onOpenPackageManager, ui }: Props) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CanvasFloatingAnchor>({ left: 12, top: 12, panelWidth: 0, panelHeight: 0 });
  const refreshAnchor = useCallback(() => {
    const panel = buttonRef.current?.closest<HTMLElement>(".canvas-panel");
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const occluders = [".canvas-toolbar", ".canvas-breadcrumb", ".react-flow__minimap", ".react-flow__controls", ".group-interface", ".palette-toggle", ".inspector-toggle"]
      .flatMap((selector) => [...panel.querySelectorAll<HTMLElement>(selector)])
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
      })
      .map((element) => element.getBoundingClientRect());
    setAnchor(resolveCanvasFloatingAnchor(panelRect, occluders));
  }, []);

  useEffect(() => {
    const panel = buttonRef.current?.closest<HTMLElement>(".canvas-panel");
    if (!panel) return;
    let frame = window.requestAnimationFrame(refreshAnchor);
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refreshAnchor);
    });
    observer.observe(panel);
    panel.querySelectorAll<HTMLElement>(".canvas-toolbar, .canvas-breadcrumb, .react-flow__minimap, .react-flow__controls, .group-interface, .palette-toggle, .inspector-toggle").forEach((element) => observer.observe(element));
    window.addEventListener("resize", refreshAnchor);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", refreshAnchor);
    };
  }, [layoutRevision, refreshAnchor]);

  const panelWidth = Math.max(260, Math.min(380, anchor.panelWidth - 24));
  const panelMaxHeight = Math.max(180, Math.min(520, anchor.top - 22));
  const panelLeft = Math.max(12, Math.min(Math.max(12, anchor.panelWidth - panelWidth - 12), anchor.left + 66 - panelWidth));
  const panelTop = Math.max(12, anchor.top - panelMaxHeight - 8);

  return <>
    <button ref={buttonRef} type="button" className={`environment-float-button ${open ? "active" : ""}`} style={{ left: anchor.left, top: anchor.top }} title={ui(`当前标签“${tabName}”的运行环境`, `Runtime environment for “${tabName}”`)} aria-label={ui("打开当前标签环境", "Open environment for current tab")} aria-expanded={open} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}><span aria-hidden="true">◎</span>{ui("环境", "Env")}</button>
    {open && <aside className="environment-floating-panel" style={{ left: panelLeft, top: panelTop, width: panelWidth, maxHeight: panelMaxHeight }} role="dialog" aria-label={ui("工作流环境", "Workflow environment")} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <header><div><strong>{ui("环境", "Environment")}</strong><small>{tabName}</small></div><button type="button" title={ui("关闭环境", "Close environment")} onClick={() => setOpen(false)}>×</button></header>
      <div className="environment-floating-panel__body">
        <section className="workflow-environment-section"><h3>{ui("Python 环境", "Python Environment")}<small>{environment.pythonImports.length} imports</small></h3>
          {environment.sourceLanguage === "python" && <p className="workflow-environment-semantics">{ui("Python Notebook 语义 · Auto 运行时固定使用 Python", "Python Notebook semantics · Auto runtime stays on Python")}</p>}
          {environment.pythonImports.map((item, index) => <div className="workflow-environment-item" key={`${item.cellIndex ?? 0}-${item.operationIndex ?? 0}-${index}`}><code>{item.source}</code><button title={ui("移除该导入", "Remove import")} onClick={() => onRemoveImport(index)}>×</button></div>)}
          {!environment.pythonImports.length && <p className="muted">{ui("当前工作流没有托管的静态 import。", "No managed static imports in this workflow.")}</p>}
        </section>
        <section className="workflow-environment-section"><h3>{ui("工作流参数", "Workflow Parameters")}<small>{parameters.length}</small></h3>
          {parameters.map((parameter, index) => <div className="workflow-parameter-item" key={`${parameter.name}-${index}`}><span><strong>{parameter.name}</strong><small>{parameter.valueType}</small></span><input aria-label={`${parameter.name} expression`} value={parameter.expression} onChange={(event) => onParameterExpressionChange(index, event.target.value)} /><button title={ui("移除参数", "Remove parameter")} onClick={() => onRemoveParameter(index)}>×</button></div>)}
          {!parameters.length && <p className="muted">{ui("Notebook 前置静态常量会自动收纳到这里。", "Leading static Notebook constants appear here automatically.")}</p>}
        </section>
        <section className="workflow-environment-section"><h3>{ui("工作区变量", "Workspace Variables")}<small>{workspaceVariableNames.length}</small></h3>
          {workspaceVariableNames.length ? <div className="workflow-variable-list">{workspaceVariableNames.map((name) => <code key={name}>{name}</code>)}</div> : <p className="muted">{ui("当前标签还没有运行时工作区变量。", "This tab has no runtime workspace variables yet.")}</p>}
          <button className="secondary" disabled={!workspaceVariableNames.length} onClick={onClearWorkspaceVariables}>{ui("清空当前标签变量", "Clear tab variables")}</button>
        </section>
        <section className="workflow-environment-section"><h3>{ui("依赖包", "Requirements")}<small>{requirements.length}</small></h3><p className="muted requirements-summary">{requirements.length ? requirements.join(" · ") : ui("无额外依赖", "No extra requirements")}</p><button onClick={onOpenPackageManager}>{ui("管理 Python 环境", "Manage Python Environment")}</button></section>
      </div>
    </aside>}
  </>;
}
