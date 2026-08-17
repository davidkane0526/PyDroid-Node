# AI Agent workflow contract

PyDroid Node never allows an AI provider to mutate the canvas directly. The model proposes a JSON plan; the application parses, validates, previews and only then applies it after user confirmation.

## Plan operations

Supported operations are `add_node`, `set_parameter`, `connect`, `disconnect`, `group_nodes`, `arrange`, `delete_node` and `run_workflow`. Node types, parameter keys and port IDs must come from the catalog sent with each request.

For every newly added node, each input port marked `required` must have an incoming `connect` operation in the same complete plan. Source and target handles must exist and their value types must be compatible. The same validator is used for AI responses and JSON pasted manually into the Agent panel.

The planning context contains:

- node type and display label;
- role (`source`, `transform`, `sink`);
- Python / JavaScript runtime support;
- valid parameter keys and detailed defaults/options for candidate nodes;
- input/output port IDs and value types;
- `required` markers for mandatory inputs;
- the current workflow structure and runtime preference.

When the current runtime preference is JavaScript, Python-only nodes are rejected locally before the plan can reach the canvas. `custom.python_function` is a last-resort Python fallback and its annotated function signature defines its dynamic ports.

## Native source nodes

Use native sources instead of inventing an unused input solely to start a workflow:

- `generate.random_table`: no input; produces an indexed random-value table; Python + JavaScript.
- `generate.empty_table`: no input; produces an empty DataFrame/table with optional columns; Python + JavaScript.
- `generate.empty_list`: no input; produces an empty list; Python + JavaScript.

Example for “create random numbers and print them”:

```json
{
  "summary": "生成随机数并打印",
  "operations": [
    { "type": "add_node", "id": "random", "nodeType": "generate.random_table", "parameters": { "count": 10, "seed": 2024 } },
    { "type": "add_node", "id": "print", "nodeType": "python.print" },
    { "type": "connect", "source": "random", "target": "print", "sourceHandle": "output", "targetHandle": "input" }
  ]
}
```

A plan which creates `python.print` without connecting its required `input` is invalid and is automatically returned to the model for one repair attempt.

## DeepSeek

DeepSeek's OpenAI-compatible API uses `https://api.deepseek.com/chat/completions`. In PyDroid Node the DeepSeek Chat preset therefore uses Chat Completions and Tool Calls / Function Calling. If a DeepSeek response unexpectedly omits the requested tool call, the Agent performs one structured fallback request with `response_format: {"type":"json_object"}` and an explicit JSON schema example. `response_format` is JSON Output on Chat Completions; it is not the OpenAI Responses API.

DeepSeek also provides an Anthropic-compatible base URL `https://api.deepseek.com/anthropic`; PyDroid Node exposes it as the DeepSeek Anthropic preset (`/v1/messages`).

For DeepSeek presets the protocol control is locked to the matching supported protocol so an endpoint cannot accidentally be paired with OpenAI Responses.
