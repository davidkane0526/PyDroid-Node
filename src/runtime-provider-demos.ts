import { defineNodeSpec, registerNodePlugin, type NodePluginRegistration } from "./nodeSpecSdk";

let scaleRegistration: NodePluginRegistration | undefined;
let pythonTableRegistration: NodePluginRegistration | undefined;

export function activateRuntimeProviderScaleDemo(): void {
  if (scaleRegistration) return;
  const spec = defineNodeSpec({
    nodeType: "demo.runtime_provider_scale",
    label: "Provider Scale",
    description: "Demo runtime provider node registered through the public NodeSpec SDK.",
    tags: ["provider", "sdk", "demo", "scale"],
    category: "自定义",
    runtimeSupport: ["python", "javascript"],
    defaults: { factor: 2 },
    parameters: [{ key: "factor", label: "Factor", kind: "number" }],
    inputPorts: [
      { id: "input", label: "Value", valueType: "number", required: true },
      { id: "factor", label: "Factor", valueType: "number", defaultParameter: "factor" },
    ],
    outputPorts: [{ id: "output", label: "Scaled", valueType: "number" }],
  });
  scaleRegistration = registerNodePlugin({
    spec,
    javascript: ({ params, upstream }) => ({
      outputs: { output: Number(upstream ?? 0) * Number(params.factor ?? 1) },
      tableResult: null,
      plotResult: null,
      exportResult: null,
    }),
    python: {
      source: "def execute(params, upstream, context):\n    return {'output': float(upstream or 0) * float(params.get('factor', 1))}\n",
    },
  });
}

export function activatePythonTableProviderDemo(): void {
  if (pythonTableRegistration) return;
  const spec = defineNodeSpec({
    nodeType: "demo.python_provider_table",
    label: "Python Provider Table",
    description: "Python runtime provider that generates a DataFrame from serializable provider source.",
    tags: ["provider", "sdk", "demo", "python", "table"],
    category: "自定义",
    runtimeSupport: ["python"],
    defaults: { start: 1, step: 2, count: 6 },
    parameters: [
      { key: "start", label: "Start", kind: "number" },
      { key: "step", label: "Step", kind: "number" },
      { key: "count", label: "Count", kind: "number", min: 1, max: 1000, step: 1 },
    ],
    inputPorts: [
      { id: "start", label: "Start", valueType: "number", defaultParameter: "start" },
      { id: "step", label: "Step", valueType: "number", defaultParameter: "step" },
      { id: "count", label: "Count", valueType: "number", defaultParameter: "count" },
    ],
    outputPorts: [{ id: "output", label: "Table", valueType: "table" }],
  });
  pythonTableRegistration = registerNodePlugin({
    spec,
    python: {
      source: [
        "def execute(params, upstream, context):",
        "    count = max(1, int(params.get('count', 6)))",
        "    start = float(params.get('start', 1))",
        "    step = float(params.get('step', 2))",
        "    values = [start + index * step for index in range(count)]",
        "    return pd.DataFrame({'index': list(range(count)), 'value': values})",
        "",
      ].join("\n"),
    },
  });
}
