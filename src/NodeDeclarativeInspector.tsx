import type { NodeSpec, ParameterSpec } from "./nodeCatalog";
import { ParameterField } from "./ParameterField";
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
  excludedParameterKeys,
  onChange,
  onExpandCode,
}: {
  spec: NodeSpec;
  values: Record<string, unknown>;
  excludedParameterKeys: Set<string>;
  onChange: (key: string, value: string | number | boolean | null) => void;
  onExpandCode?: () => void;
}) {
  const available = spec.parameters.filter((parameter) => !excludedParameterKeys.has(parameter.key));
  const byKey = new Map(available.map((parameter) => [parameter.key, parameter]));
  const groupedKeys = new Set<string>();
  const groups = (spec.ui?.parameterGroups ?? []).map((group) => {
    const parameters = group.parameters.map((key) => byKey.get(key)).filter((parameter): parameter is ParameterSpec => Boolean(parameter));
    for (const parameter of parameters) groupedKeys.add(parameter.key);
    return { ...group, parameters };
  }).filter((group) => group.parameters.length > 0);
  const remaining = available.filter((parameter) => !groupedKeys.has(parameter.key));
  const basic = remaining.filter((parameter) => !parameter.advanced);
  const advanced = remaining.filter((parameter) => parameter.advanced);
  const help = spec.ui?.help;
  const resourceHelp = help?.resource ? getNodePluginResourceText(spec.nodeType, help.resource) : null;

  const field = (parameter: ParameterSpec) => <ParameterField
    key={parameter.key}
    spec={parameter}
    value={(values[parameter.key] ?? spec.defaults[parameter.key]) as ParameterValue}
    onChange={(value) => onChange(parameter.key, value)}
    onExpand={parameter.key === "code" ? onExpandCode : undefined}
  />;

  return <>
    {(spec.ui?.status?.length ?? 0) > 0 && <section className="node-declarative-status" aria-label="节点状态">
      {spec.ui!.status!.map((item) => <div key={`${item.label}:${item.parameter}`}><span>{item.label}</span><strong>{statusValue(values[item.parameter] ?? spec.defaults[item.parameter])}</strong></div>)}
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
