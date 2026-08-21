from __future__ import annotations

import ast
import builtins
import inspect
import json
import math
from typing import Any

import numpy as np
import pandas as pd

from .values import _decode_json_compatible, _single_value

_CUSTOM_ALLOWED_IMPORTS = {
    "numpy", "pandas", "scipy", "matplotlib", "math", "json", "re",
    "collections", "itertools", "functools", "statistics", "typing",
    "datetime", "decimal", "fractions", "random", "string", "textwrap",
    "copy", "heapq", "bisect", "operator", "numbers", "warnings",
    "sklearn", "PIL", "cv2", "openpyxl", "xlrd", "networkx",
}
_CUSTOM_FORBIDDEN_IMPORTS = {
    "os", "sys", "subprocess", "shutil", "socket", "importlib", "builtins",
    "ctypes", "multiprocessing", "threading", "pathlib", "tempfile",
}
_CUSTOM_ALLOW_ALL_IMPORTS = False
_SAFE_CUSTOM_IMPORT_ROOTS = {"math", "statistics", "decimal", "fractions", "itertools", "functools", "operator", "collections", "re", "json", "numpy", "pandas"}

def _simple_annotation_kind(name: str) -> str:
    normalized = name.strip(" '\"").replace(" ", "").lower()
    aliases = {
        "dataframe": "table", "pd.dataframe": "table", "pandas.dataframe": "table",
        "series": "table", "pd.series": "table", "pandas.series": "table",
        "ndarray": "table", "np.ndarray": "table", "numpy.ndarray": "table",
        "table": "table", "int": "number", "float": "number", "number": "number",
        "str": "text", "string": "text", "text": "text", "bool": "boolean",
        "boolean": "boolean", "plot": "plot", "image": "plot", "csv": "csv",
        "list": "list", "typing.list": "list", "sequence": "list",
        "set": "list", "typing.set": "list", "frozenset": "list",
        "dict": "object", "typing.dict": "object", "mapping": "object", "object": "object",
        "any": "any", "typing.any": "any",
    }
    return aliases.get(normalized, "")

def _annotation_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_annotation_name(node.value)}.{node.attr}"
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""

def _subscript_arguments(node: ast.Subscript) -> list[ast.AST]:
    return list(node.slice.elts) if isinstance(node.slice, ast.Tuple) else [node.slice]

def _annotation_descriptor(annotation: Any) -> dict[str, Any]:
    if annotation is inspect.Parameter.empty or annotation is inspect.Signature.empty:
        return {}
    if annotation is pd.DataFrame:
        return {"kind": "table"}
    if annotation in {int, float}:
        return {"kind": "number", "number_type": annotation.__name__}
    if annotation is str:
        return {"kind": "text"}
    if annotation is bool:
        return {"kind": "boolean"}
    raw = str(annotation).strip()
    try:
        expression = ast.parse(raw, mode="eval").body
    except SyntaxError:
        return {"kind": _simple_annotation_kind(raw)} if _simple_annotation_kind(raw) else {}

    def describe(node: ast.AST) -> dict[str, Any]:
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            members = [node.left, node.right]
            non_null = [member for member in members if _annotation_name(member).lower() not in {"none", "nonetype"}]
            if len(non_null) != 1:
                return {}
            return {**describe(non_null[0]), "optional": True}
        if isinstance(node, ast.Subscript):
            generic = _annotation_name(node.value).lower()
            arguments = _subscript_arguments(node)
            if generic in {"optional", "typing.optional"} and len(arguments) == 1:
                return {**describe(arguments[0]), "optional": True}
            if generic in {"union", "typing.union"}:
                non_null = [member for member in arguments if _annotation_name(member).lower() not in {"none", "nonetype"}]
                return {**describe(non_null[0]), "optional": True} if len(non_null) == 1 else {}
            if generic in {"list", "typing.list", "sequence", "typing.sequence"} and len(arguments) == 1:
                item = describe(arguments[0])
                return {"kind": "list", "item_kind": item.get("kind"), "item_number_type": item.get("number_type")}
            if generic in {"dict", "typing.dict", "mapping"}:
                return {"kind": "object"}
            if generic in {"set", "typing.set", "frozenset"}:
                return {"kind": "list"}
            if generic in {"literal", "typing.literal"}:
                try:
                    choices = [ast.literal_eval(member) for member in arguments]
                except (ValueError, TypeError):
                    return {}
                return {"kind": "literal", "choices": choices}
            if generic in {"tuple", "typing.tuple"}:
                outputs = []
                for index, member in enumerate(arguments):
                    declaration = _annotation_name(member)
                    if ":" in declaration:
                        port, annotation_name = (part.strip() for part in declaration.split(":", 1))
                        descriptor = {"kind": _simple_annotation_kind(annotation_name), "port": port}
                    else:
                        descriptor = {**describe(member), "port": f"output{index + 1}"}
                    if not descriptor.get("kind") or not descriptor["port"].isidentifier():
                        return {}
                    outputs.append(descriptor)
                if len({output["port"] for output in outputs}) != len(outputs):
                    return {}
                return {"kind": "tuple", "outputs": outputs} if all(output.get("kind") for output in outputs) else {}
        name = _annotation_name(node)
        kind = _simple_annotation_kind(name)
        descriptor: dict[str, Any] = {"kind": kind} if kind else {}
        if name.strip(" '\"").lower() in {"float", "number"}:
            descriptor["number_type"] = "float"
        elif name.strip(" '\"").lower() == "int":
            descriptor["number_type"] = "int"
        return descriptor

    return describe(expression)

def _parse_list_parameter(raw: Any, item_kind: str, number_type: str | None = None) -> list[Any]:
    if isinstance(raw, list):
        items = raw
    else:
        text = str(raw).strip()
        if text.startswith("["):
            parsed = _decode_json_compatible(text, "列表参数")
            if not isinstance(parsed, list):
                raise ValueError("List parameter must be a JSON array or comma-separated values")
            items = parsed
        else:
            items = [item.strip() for item in text.split(",") if item.strip()]
    if item_kind == "number":
        converter = float if number_type == "float" else int
        return [converter(item) for item in items]
    if item_kind == "boolean":
        return [_as_bool(item) for item in items]
    if item_kind == "text":
        return [str(item) for item in items]
    raise ValueError("List item type is not supported")

def _convert_custom_parameter(raw: Any, descriptor: dict[str, Any]) -> Any:
    kind = descriptor.get("kind")
    if kind == "number":
        return float(raw) if descriptor.get("number_type") == "float" else int(raw)
    if kind == "boolean":
        return _as_bool(raw)
    if kind == "text":
        return str(raw)
    if kind == "object":
        if isinstance(raw, (dict, list)):
            return raw
        text = str(raw).strip()
        if not text:
            return None
        return _decode_json_compatible(text, "对象参数")
    if kind == "list":
        if not descriptor.get("item_kind"):
            # Bare list/set annotation without a concrete item type.
            return _parse_list_parameter(raw, "text")
        return _parse_list_parameter(raw, descriptor.get("item_kind", ""), descriptor.get("item_number_type"))
    if kind == "literal":
        choices = descriptor.get("choices", [])
        for choice in choices:
            if str(choice) == str(raw):
                return choice
        raise ValueError(f"Value {raw!r} is not one of {choices}")
    raise ValueError(f"Unsupported custom parameter type: {kind}")

def _coerce_custom_output(value: Any, descriptor: dict[str, Any]) -> Any:
    """Normalise annotated return values into the port type the node declares."""
    kind = descriptor.get("kind")
    if kind == "table":
        if isinstance(value, pd.Series):
            return value.to_frame()
        if isinstance(value, np.ndarray):
            return pd.DataFrame(value)
    if kind == "list" and isinstance(value, (set, frozenset)):
        return list(value)
    return value

def _validate_custom_output(value: Any, descriptor: dict[str, Any], port: str) -> None:
    kind = descriptor.get("kind")
    if kind == "table" and not isinstance(value, pd.DataFrame):
        raise ValueError(f"Output {port} declared table but did not return a DataFrame")
    if kind == "number" and not isinstance(value, (int, float)):
        raise ValueError(f"Output {port} declared number but returned {type(value).__name__}")
    if kind in {"text", "csv"} and not isinstance(value, str):
        raise ValueError(f"Output {port} declared {kind} but returned {type(value).__name__}")
    if kind == "boolean" and not isinstance(value, bool):
        raise ValueError(f"Output {port} declared boolean but returned {type(value).__name__}")
    if kind == "list" and not isinstance(value, (list, tuple, set, frozenset)):
        raise ValueError(f"Output {port} declared list but returned {type(value).__name__}")

def allow_all_custom_imports() -> None:
    """桌面端调用：放宽自定义节点 import 为仅禁止系统级危险模块。"""
    global _CUSTOM_ALLOW_ALL_IMPORTS
    _CUSTOM_ALLOW_ALL_IMPORTS = True

def _import_root_allowed(root: str) -> bool:
    if root in _CUSTOM_FORBIDDEN_IMPORTS:
        return False
    if _CUSTOM_ALLOW_ALL_IMPORTS:
        return True
    return root in _CUSTOM_ALLOWED_IMPORTS

def _validate_custom_imports(tree: ast.AST) -> None:
    """移动端白名单、桌面端仅禁止危险模块；两者都拒绝系统级危险模块。"""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if not _import_root_allowed(root):
                    raise ValueError(f"自定义节点不能导入 {alias.name!r}；允许的模块：{', '.join(sorted(_CUSTOM_ALLOWED_IMPORTS))}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            root = module.split(".")[0]
            if not _import_root_allowed(root):
                raise ValueError(f"自定义节点不能从 {module!r} 导入；允许的模块：{', '.join(sorted(_CUSTOM_ALLOWED_IMPORTS))}")

def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    """供自定义函数使用的受限 __import__，按平台策略放行模块。"""
    root = name.split(".")[0]
    if not _import_root_allowed(root):
        raise ImportError(f"自定义节点不能导入 {name!r}")
    return __import__(name, globals, locals, fromlist, level)

def _execute_custom_function(code: str, upstream: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    tree = ast.parse(code, mode="exec")
    _validate_custom_imports(tree)
    if any(isinstance(node, (ast.Global, ast.Nonlocal)) for node in ast.walk(tree)):
        raise ValueError("Custom functions cannot modify global/nonlocal state")
    functions = [node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    if len(functions) != 1 or any(isinstance(node, ast.AsyncFunctionDef) for node in tree.body):
        raise ValueError("Custom node code must contain exactly one synchronous function")

    safe_builtins = {
        name: getattr(builtins, name)
        for name in (
            "abs", "all", "any", "bool", "complex", "dict", "divmod", "enumerate",
            "filter", "float", "frozenset", "getattr", "hasattr", "int", "isinstance",
            "issubclass", "iter", "len", "list", "map", "max", "min", "next", "pow",
            "print", "range", "reversed", "round", "set", "slice", "sorted", "str", "sum",
            "tuple", "type", "zip", "Exception", "ArithmeticError", "LookupError",
            "ValueError", "TypeError", "KeyError", "IndexError", "OSError", "RuntimeError",
            "StopIteration", "NotImplementedError",
        )
    }
    safe_builtins["__import__"] = _restricted_import
    # Align the custom-function namespace with the notebook cell namespace so the
    # same Python idioms work in both: pandas + numpy + math are always available.
    namespace: dict[str, Any] = {"__builtins__": safe_builtins, "pd": pd, "np": np, "math": math}
    exec(compile(tree, "<custom-node>", "exec"), namespace, namespace)
    function = namespace[functions[0]]
    signature = inspect.signature(function)
    provided: dict[str, Any] = {}
    for name, parameter in signature.parameters.items():
        if parameter.kind in {inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD}:
            raise ValueError("Custom functions do not support *args/**kwargs parameters")
        descriptor = _annotation_descriptor(parameter.annotation)
        kind = descriptor.get("kind")
        if not kind or kind == "tuple":
            raise ValueError(f"Parameter {name} has no supported type annotation; use table/plot/csv/number/text/boolean/list/Literal/Any (or Optional[...])")
        if kind in {"table", "plot", "csv", "any"}:
            if name in upstream:
                provided[name] = upstream[name]
            elif parameter.default is inspect.Parameter.empty:
                if descriptor.get("optional"):
                    provided[name] = None
                else:
                    raise ValueError(f"Required input {name} is not connected")
            continue
        if name not in params or params[name] in {None, ""}:
            if parameter.default is inspect.Parameter.empty:
                if descriptor.get("optional"):
                    provided[name] = None
                else:
                    raise ValueError(f"Required parameter {name} has no value")
            continue
        provided[name] = _convert_custom_parameter(params[name], descriptor)

    output_descriptor = _annotation_descriptor(signature.return_annotation)
    if not output_descriptor.get("kind"):
        raise ValueError("Custom function return value has no supported type annotation; use table/plot/csv/number/text/boolean/list/Any (or tuple['a:table', ...])")
    positional_arguments: list[Any] = []
    keyword_arguments: dict[str, Any] = {}
    for name, parameter in signature.parameters.items():
        if parameter.kind == inspect.Parameter.POSITIONAL_ONLY:
            if name in provided:
                positional_arguments.append(provided[name])
            elif parameter.default is not inspect.Parameter.empty:
                positional_arguments.append(parameter.default)
        elif name in provided:
            keyword_arguments[name] = provided[name]
    value = function(*positional_arguments, **keyword_arguments)
    if output_descriptor["kind"] == "tuple":
        descriptors = output_descriptor["outputs"]
        if not isinstance(value, tuple) or len(value) != len(descriptors):
            raise ValueError(f"Custom function must return a tuple with {len(descriptors)} values")
        coerced = [_coerce_custom_output(item, descriptor) for item, descriptor in zip(value, descriptors, strict=True)]
        outputs = {descriptor.get("port", f"output{index + 1}"): item for index, (descriptor, item) in enumerate(zip(descriptors, coerced, strict=True))}
        for port, item, descriptor in zip(outputs, coerced, descriptors, strict=True):
            _validate_custom_output(item, descriptor, port)
        return outputs
    value = _coerce_custom_output(value, output_descriptor)
    _validate_custom_output(value, output_descriptor, "output")
    return {"output": value}

def analyze_signature_json(code: str) -> str:
    """Parse a custom Python function signature into the same JSON shape the
    frontend's parsePythonFunctionSignature produces, so the Python runtime can
    serve as the single source of truth whenever it is reachable."""
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        return json.dumps({"error": f"syntax: {error.msg}"}, ensure_ascii=False)
    functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    if len(functions) != 1 or any(isinstance(node, ast.AsyncFunctionDef) for node in tree.body):
        return json.dumps({"error": "Custom node code must contain exactly one synchronous function"}, ensure_ascii=False)
    fn = functions[0]

    def descriptor_for(annotation: ast.AST | None) -> dict[str, Any]:
        if annotation is None:
            return {}
        return _annotation_descriptor(ast.unparse(annotation))

    input_ports: list[dict[str, Any]] = []
    parameters: list[dict[str, Any]] = []
    if fn.args.vararg or fn.args.kwarg:
        return json.dumps({"error": "自定义节点不支持 *args/**kwargs 可变参数"}, ensure_ascii=False)

    def add_argument(arg: ast.arg, default: str | None) -> str | None:
        descriptor = descriptor_for(arg.annotation)
        kind = descriptor.get("kind")
        if not kind:
            return f"参数 {arg.arg} 缺少受支持的类型标注"
        optional = bool(descriptor.get("optional"))
        required = default is None and not optional
        if kind in {"table", "plot", "csv", "any"}:
            input_ports.append({"id": arg.arg, "label": arg.arg, "valueType": kind, "required": required})
            return None
        parameter_kind = (
            "select" if kind == "literal" else
            "boolean" if kind == "boolean" else
            "number" if kind == "number" else
            "list" if kind == "list" else
            "textarea" if kind == "object" else
            "text"
        )
        parameters.append({
            "key": arg.arg, "label": arg.arg, "kind": parameter_kind,
            "required": required, "defaultValue": default,
        })
        return None

    positional_args = [*fn.args.posonlyargs, *fn.args.args]
    positional_defaults = [None] * (len(positional_args) - len(fn.args.defaults)) + [ast.unparse(default) for default in fn.args.defaults]
    for arg, default in zip(positional_args, positional_defaults, strict=True):
        if error := add_argument(arg, default):
            return json.dumps({"error": error}, ensure_ascii=False)
    for arg, default_node in zip(fn.args.kwonlyargs, fn.args.kw_defaults, strict=True):
        default = ast.unparse(default_node) if default_node is not None else None
        if error := add_argument(arg, default):
            return json.dumps({"error": error}, ensure_ascii=False)

    return_descriptor = descriptor_for(fn.returns)
    if return_descriptor.get("kind") == "tuple":
        output_ports = [
            {"id": output.get("port", f"output{index + 1}"), "label": output.get("port", f"结果 {index + 1}"), "valueType": output.get("kind")}
            for index, output in enumerate(return_descriptor.get("outputs", []))
        ]
    elif return_descriptor.get("kind"):
        output_ports = [{"id": "output", "label": "结果", "valueType": return_descriptor["kind"]}]
    else:
        return json.dumps({"error": "函数返回值缺少受支持的类型标注"}, ensure_ascii=False)

    return json.dumps({
        "functionName": fn.name,
        "inputPorts": input_ports,
        "outputPorts": output_ports,
        "outputType": output_ports[0]["valueType"],
        "parameters": parameters,
    }, ensure_ascii=False)
