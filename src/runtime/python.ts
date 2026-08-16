import type { RuntimeAdapter, RuntimeEnvironment, RuntimeExecutionRequest, ExecutionResult } from "./types";

export type PythonRuntimeBackend = {
  warmUp(): Promise<void>;
  getEnvironment(): Promise<{ pythonVersion: string; packages: Array<{ name: string; version: string }> }>;
  execute(request: RuntimeExecutionRequest): Promise<ExecutionResult>;
};

export function createPythonRuntime(backend: PythonRuntimeBackend): RuntimeAdapter {
  return {
    descriptor: {
      id: "python",
      label: "Python Runtime",
      shortLabel: "Python",
      description: "兼容完整节点目录、Notebook 与 Python 自定义函数的稳定执行引擎。",
      capabilities: ["workflow", "notebook-analysis", "signature-analysis", "native-packages"],
    },

    warmUp: () => backend.warmUp(),

    async getEnvironment(): Promise<RuntimeEnvironment> {
      const environment = await backend.getEnvironment();
      return {
        runtimeId: "python",
        runtimeLabel: "Python",
        version: environment.pythonVersion,
        packages: environment.packages,
      };
    },

    execute: (request) => backend.execute(request),

    canExecute: () => ({ supported: true }),
  };
}
