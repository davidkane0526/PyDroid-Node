import type { NodeSpec, ParameterSpec } from "./nodeCatalog";
import type { NodeExecutionPreview } from "./runtime/types";
import { ParameterField } from "./ParameterField";
import { declarativeStatusValue, declarativeUiValues, declarativeUiVisible, resolveDeclarativeParameter } from "./nodeDeclarativeUi";
import { getNodePluginResourceText } from "./nodePluginPackages";
import "./node-declarative-inspector.css";

type ParameterValue = string | number | boolean | null | undefined;

function statusValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

export function NodeDeclarativeInspector({
  spec,
  values,
  result,
  excludedParameterKeys,
  onChange,
  onExpandCode,
}: {
  spec: NodeSpec;
  values: Record<string, unknown>;
  result?: NodeExecutionPreview;
  excludedParameterKeys: Set<string>;
  onChange: (key: string, value: string | number | boolean | null) => void;
  onExpandCode?: () => void;
}) {
  const effectiveValues = declarativeUiValues(spec, values);
  const available = spec.parameters
    .filter((parameter) => !excludedParameterKeys.has(parameter.key))
    .filter((parameter) => declarativeUiVisible(parameter.visibleWhen, effectiveValues))
    .map((parameter) => resolveDeclarativeParameter(parameter, effectiveValues));
  const byKey = new Map(available.map((parameter) => [parameter.key, parameter]));
  const declaredGroupedKeys = new Set((spec.ui?.parameterGroups ?? []).flatMap((group) => group.parameters));
  const groups = (spec.ui?.parameterGroups ?? [])
    .filter((group) => declarativeUiVisible(group.when, effectiveValues))
    .map((group) => ({
      ...group,
      parameters: group.parameters.map((key) => byKey.get(key)).filter((parameter): parameter is ParameterSpec => Boolean(parameter)),
    }))
    .filter((group) => group.parameters.length > 0);
  const remaining = available.filter((parameter) => !declaredGroupedKeys.has(parameter.key));
  const basic = remaining.filter((parameter) => !parameter.advanced);
  const advanced = remaining.filter((parameter) => parameter.advanced);
  const help = declarativeUiVisible(spec.ui?.help?.when, effectiveValues) ? spec.ui?.help : undefined;
  const status = (spec.ui?.status ?? []).filter((item) => declarativeUiVisible(item.when, effectiveValues));
  const resourceHelp = help?.resource ? getNodePluginResourceText(spec.nodeType, help.resource) : null;

  const field = (parameter: ParameterSpec) => <ParameterField
    key={parameter.key}
    spec={parameter}
    value={(values[parameter.key] ?? spec.defaults[parameter.key]) as ParameterValue}
    onChange={(value) => onChange(parameter.key, value)}
    onExpand={parameter.key === "code" ? onExpandCode : undefined}
  />;

  return <>
    {status.length > 0 && <section className="node-declarative-status" aria-label="节点状态">
      {status.map((item) => <div key={`${item.label}:${item.parameter ?? item.result ?? "status"}`}><span>{item.label}</span><strong>{statusValue(declarativeStatusValue(item, effectiveValues, result))}</strong></div>)}
    </section>}
    {(help?.text || resourceHelp) && <section className="node-declarative-help">
      {help?.title && <strong>{help.title}</strong>}
      {help?.text && <p>{help.text}</p>}
      {resourceHelp && <pre>{resourceHelp}</pre>}
    </section>}
    {groups.map((group) => <section className="node-declarative-group" key={group.id}>
      <header><strong>{group.label}</strong>{group.description && <small>{group.description}</small>}</header>
      <div>{group.parameters.map(field)}</div>
    </section>)}
    {basic.map(field)}
    {advanced.length > 0 && <details className="advanced-parameters"><summary>高级参数 <span>{advanced.length}</span></summary><div className="advanced-parameters__grid">{advanced.map(field)}</div></details>}
  </>;
}
