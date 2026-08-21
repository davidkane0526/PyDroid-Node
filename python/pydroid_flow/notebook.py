from __future__ import annotations

import ast
import builtins
import json
import re
import symtable
from typing import Any


METHOD_NODES = {
    "dropna": "pandas.dropna", "fillna": "pandas.fillna", "sort_values": "pandas.sort_values",
    "query": "pandas.query", "head": "pandas.head", "tail": "pandas.tail",
    "drop_duplicates": "pandas.drop_duplicates", "sample": "pandas.sample", "round": "pandas.round",
    "describe": "pandas.describe", "abs": "table.absolute", "diff": "table.difference",
    "sort_index": "table.sort_index", "reset_index": "table.reset_index",
}

CONTROL_LABELS = {"If": "If 条件", "For": "For 循环", "While": "While 循环", "With": "With 上下文", "Try": "Try 异常处理"}
CONTROL_NODES = {"If": "notebook.if_block", "For": "notebook.for_block", "While": "notebook.while_block"}

_CUSTOM_RUNTIME_GLOBALS = {"pd", "np", "math"}
_BUILTIN_NAMES = set(dir(builtins))
_CUSTOM_SAFE_BUILTINS = {
    "abs", "all", "any", "bool", "complex", "dict", "divmod", "enumerate",
    "filter", "float", "frozenset", "getattr", "hasattr", "int", "isinstance",
    "issubclass", "iter", "len", "list", "map", "max", "min", "next", "pow",
    "print", "range", "reversed", "round", "set", "slice", "sorted", "str", "sum",
    "tuple", "type", "zip", "Exception", "ArithmeticError", "LookupError",
    "ValueError", "TypeError", "KeyError", "IndexError", "OSError", "RuntimeError",
    "StopIteration", "NotImplementedError",
}


def _identifier_slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_")
    return cleaned or "function"


def _assignment_target_names(statement: ast.stmt) -> list[str]:
    target: ast.AST | None = None
    if isinstance(statement, ast.Assign) and statement.targets:
        target = statement.targets[0]
    elif isinstance(statement, ast.AnnAssign):
        target = statement.target
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)) and all(isinstance(item, ast.Name) for item in target.elts):
        return [item.id for item in target.elts if isinstance(item, ast.Name)]
    return []


def _return_arity(function: ast.FunctionDef) -> int:
    """Infer only the stable *shape* of top-level return statements."""
    arities: set[int] = set()

    class ReturnVisitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
            if node is function:
                for child in node.body:
                    self.visit(child)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
            return

        def visit_Lambda(self, node: ast.Lambda) -> None:  # noqa: N802
            return

        def visit_Return(self, node: ast.Return) -> None:  # noqa: N802
            if isinstance(node.value, ast.Tuple):
                arities.add(len(node.value.elts))
            else:
                arities.add(1)

    ReturnVisitor().visit(function)
    return next(iter(arities)) if len(arities) == 1 and next(iter(arities)) > 1 else 1



_VALUE_TYPE_ANNOTATIONS = {
    "any": "any", "typing.any": "any",
    "dataframe": "table", "pd.dataframe": "table", "pandas.dataframe": "table", "table": "table",
    "int": "number", "float": "number", "number": "number",
    "str": "text", "string": "text", "text": "text",
    "bool": "boolean", "boolean": "boolean",
    "list": "list", "typing.list": "list", "sequence": "list", "typing.sequence": "list",
    "dict": "object", "typing.dict": "object", "mapping": "object", "typing.mapping": "object", "object": "object",
}


def _annotation_value_type(annotation: ast.AST | None) -> str:
    """Normalize only annotations that map unambiguously to workflow value types."""
    if annotation is None:
        return "any"
    if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
        raw = annotation.value
    else:
        try:
            raw = ast.unparse(annotation)
        except Exception:
            return "any"
    normalized = raw.strip(" '\"").replace(" ", "").lower()
    if normalized.startswith("optional[") or normalized.startswith("typing.optional["):
        inner = normalized[normalized.find("[") + 1:-1]
        return _VALUE_TYPE_ANNOTATIONS.get(inner, "any")
    return _VALUE_TYPE_ANNOTATIONS.get(normalized, "any")


def _dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = _dotted_name(node.value)
        return f"{prefix}.{node.attr}" if prefix else None
    return None


def _infer_expression_value_type(node: ast.AST | None, known: dict[str, str]) -> str:
    """Conservative static value-type inference for function signatures.

    This deliberately recognizes only constructors and operations with stable
    workflow-level shapes.  Unknown pandas selections, arbitrary calls and
    mixed arithmetic stay ``any`` rather than reviving the old "unknown=table"
    guess.
    """
    if node is None:
        return "any"
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            return "boolean"
        if isinstance(node.value, (int, float, complex)) and not isinstance(node.value, bool):
            return "number"
        if isinstance(node.value, str):
            return "text"
        return "any"
    if isinstance(node, ast.Name):
        return known.get(node.id, "any")
    if isinstance(node, (ast.List, ast.ListComp, ast.Set, ast.SetComp)):
        return "list"
    if isinstance(node, (ast.Dict, ast.DictComp)):
        return "object"
    if isinstance(node, (ast.Compare, ast.BoolOp)) or isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return "boolean"
    if isinstance(node, ast.IfExp):
        left = _infer_expression_value_type(node.body, known)
        right = _infer_expression_value_type(node.orelse, known)
        return left if left == right else "any"
    if isinstance(node, ast.BinOp):
        left = _infer_expression_value_type(node.left, known)
        right = _infer_expression_value_type(node.right, known)
        if left == right == "number":
            return "number"
        if left == right == "text" and isinstance(node.op, ast.Add):
            return "text"
        return "any"
    if not isinstance(node, ast.Call):
        return "any"
    name = (_dotted_name(node.func) or "").lower()
    if name in {"float", "int", "len", "round"}:
        return "number"
    if name == "str":
        return "text"
    if name == "bool":
        return "boolean"
    if name in {"list", "set", "tuple"}:
        return "list"
    if name == "dict":
        return "object"
    if name in {
        "pd.dataframe", "pandas.dataframe", "pd.read_csv", "pandas.read_csv",
        "pd.read_table", "pandas.read_table", "pd.read_json", "pandas.read_json",
        "pd.concat", "pandas.concat",
    }:
        return "table"
    if isinstance(node.func, ast.Attribute):
        receiver_type = _infer_expression_value_type(node.func.value, known)
        if receiver_type == "table" and node.func.attr in {
            "copy", "dropna", "fillna", "drop_duplicates", "head", "tail",
            "query", "round", "sort_values", "sort_index", "reset_index",
            "rename", "abs", "transpose", "pivot",
        }:
            return "table"
    return "any"


def _function_output_types(function: ast.FunctionDef) -> list[str]:
    """Infer stable return port types without guessing through unknown code."""
    arity = _return_arity(function)
    return_types: list[list[str]] = []

    def assign_name(statement: ast.stmt, known: dict[str, str]) -> None:
        target: ast.AST | None = None
        value: ast.AST | None = None
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
            target, value = statement.targets[0], statement.value
        elif isinstance(statement, ast.AnnAssign):
            target, value = statement.target, statement.value
        if not isinstance(target, ast.Name):
            return
        inferred = _infer_expression_value_type(value, known)
        if inferred == "any":
            known.pop(target.id, None)
        else:
            known[target.id] = inferred

    def walk_block(statements: list[ast.stmt], known: dict[str, str]) -> dict[str, str]:
        current = dict(known)
        for statement in statements:
            if isinstance(statement, ast.Return):
                if arity > 1 and isinstance(statement.value, ast.Tuple) and len(statement.value.elts) == arity:
                    return_types.append([_infer_expression_value_type(item, current) for item in statement.value.elts])
                elif arity == 1:
                    return_types.append([_infer_expression_value_type(statement.value, current)])
                continue
            if isinstance(statement, (ast.Assign, ast.AnnAssign)):
                assign_name(statement, current)
                continue
            if isinstance(statement, ast.If):
                true_known = walk_block(statement.body, current)
                false_known = walk_block(statement.orelse, current) if statement.orelse else dict(current)
                merged: dict[str, str] = {}
                for name in set(true_known) | set(false_known):
                    before = current.get(name)
                    left = true_known.get(name, before)
                    right = false_known.get(name, before)
                    if left and left == right:
                        merged[name] = left
                current = merged
                continue
            if isinstance(statement, (ast.For, ast.While)):
                body_known = walk_block(statement.body, current)
                for name in list(current):
                    if body_known.get(name, current[name]) != current[name]:
                        current.pop(name, None)
                continue
            if isinstance(statement, ast.Try):
                # Returns inside try/except still contribute, but assignments are
                # too path-dependent to use for later inference.
                walk_block(statement.body, dict(current))
                for handler in statement.handlers:
                    walk_block(handler.body, dict(current))
                walk_block(statement.orelse, dict(current))
                walk_block(statement.finalbody, dict(current))
        return current

    initial: dict[str, str] = {}
    for argument in [*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs]:
        explicit = _annotation_value_type(argument.annotation)
        if explicit != "any":
            initial[argument.arg] = explicit
    walk_block(function.body, initial)
    if not return_types:
        explicit = _annotation_value_type(function.returns)
        return [explicit] if arity == 1 else ["any"] * arity
    stable: list[str] = []
    for index in range(arity):
        values = [row[index] for row in return_types if len(row) > index]
        first = values[0] if values else "any"
        stable.append(first if first != "any" and all(value == first for value in values) else "any")
    explicit = _annotation_value_type(function.returns)
    if arity == 1 and explicit != "any":
        stable[0] = explicit
    return stable

def _function_free_globals(fragment: str, function_name: str) -> list[str]:
    try:
        table = symtable.symtable(fragment, "<notebook-function>", "exec")
        child = next((item for item in table.get_children() if item.get_name() == function_name), None)
    except (SyntaxError, ValueError):
        child = None
    if child is None:
        return []
    names = []
    for symbol in child.get_symbols():
        name = symbol.get_name()
        if symbol.is_referenced() and symbol.is_global() and name not in _BUILTIN_NAMES and name not in _CUSTOM_RUNTIME_GLOBALS and name != function_name:
            names.append(name)
    return sorted(set(names))


def _compile_workflow_function(statement: ast.FunctionDef, source: str, function_id: str) -> dict[str, Any] | None:
    """Compile a top-level Python def into a reusable workflow-function kernel.

    All external values are explicit ``Any`` ports.  This avoids guessing that a
    scalar-looking argument is a UI parameter or that an unannotated return is a
    DataFrame.  The runtime value remains authoritative.
    """
    if statement.decorator_list or statement.args.vararg is not None or statement.args.kwarg is not None:
        return None
    # The promoted implementation runs through custom.python_function.  Keep
    # functions that require semantics unavailable in that runtime as ordinary
    # notebook code instead of creating a visually structured node that fails.
    if any(isinstance(node, (ast.Global, ast.Nonlocal, ast.Yield, ast.YieldFrom)) for node in ast.walk(statement)):
        return None
    loaded_builtins = {
        node.id for node in ast.walk(statement)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in _BUILTIN_NAMES
    }
    if loaded_builtins - _CUSTOM_SAFE_BUILTINS:
        return None
    fragment = ast.get_source_segment(source, statement) or ast.unparse(statement)
    try:
        tree = ast.parse(fragment)
    except SyntaxError:
        return None
    fn = tree.body[0] if tree.body and isinstance(tree.body[0], ast.FunctionDef) else None
    if fn is None:
        return None
    original_parameters = [*fn.args.posonlyargs, *fn.args.args, *fn.args.kwonlyargs]
    parameter_names = [argument.arg for argument in original_parameters]
    free_globals = [name for name in _function_free_globals(fragment, fn.name) if name not in parameter_names]

    # Every workflow function input is a data port.  Remove Python defaults from
    # the compiled kernel because call-site analysis supplies omitted defaults
    # explicitly, preserving a stable document-level function signature.
    input_types = [_annotation_value_type(argument.annotation) for argument in original_parameters]
    for argument, value_type in zip(original_parameters, input_types):
        argument.annotation = ast.Constant(value="Any" if value_type == "any" else value_type)
    fn.args.defaults = []
    fn.args.kw_defaults = [None] * len(fn.args.kwonlyargs)
    for dependency in free_globals:
        fn.args.kwonlyargs.append(ast.arg(arg=dependency, annotation=ast.Constant(value="Any")))
        fn.args.kw_defaults.append(None)

    arity = _return_arity(statement)
    output_ids = ["output"] if arity == 1 else [f"output{index + 1}" for index in range(arity)]
    output_types = _function_output_types(statement)
    if arity == 1:
        fn.returns = ast.Constant(value="Any" if output_types[0] == "any" else output_types[0])
    else:
        fn.returns = ast.Subscript(
            value=ast.Name(id="tuple", ctx=ast.Load()),
            slice=ast.Tuple(elts=[ast.Constant(value=f"{port}:{value_type}") for port, value_type in zip(output_ids, output_types)], ctx=ast.Load()),
            ctx=ast.Load(),
        )
    ast.fix_missing_locations(tree)
    return {
        "id": function_id,
        "name": statement.name,
        "code": ast.unparse(tree),
        "parameterNames": parameter_names,
        "dependencyNames": free_globals,
        "inputNames": [*parameter_names, *free_globals],
        "inputTypes": [*input_types, *(["any"] * len(free_globals))],
        "outputIds": output_ids,
        "outputTypes": output_types,
        "function": statement,
    }


def _safe_expression(node: ast.AST) -> bool:
    forbidden = (ast.Call, ast.Await, ast.Yield, ast.YieldFrom, ast.Lambda, ast.NamedExpr, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
    return not any(isinstance(item, forbidden) for item in ast.walk(node))


def _json_literal(node: ast.AST) -> Any:
    try:
        value = ast.literal_eval(node)
    except (ValueError, TypeError):
        return ...

    def compatible(item: Any) -> bool:
        if item is None or isinstance(item, (str, int, float, bool)):
            return True
        if isinstance(item, list):
            return all(compatible(child) for child in item)
        if isinstance(item, dict):
            return all(isinstance(key, str) and compatible(child) for key, child in item.items())
        return False

    if not compatible(value):
        return ...
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        return ...
    return value


def _root_name(node: ast.AST) -> str | None:
    while isinstance(node, (ast.Attribute, ast.Subscript, ast.Call)):
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Attribute):
                break
            node = node.func.value
        else:
            node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _literal(node: ast.AST) -> Any:
    try:
        value = ast.literal_eval(node)
        return value if isinstance(value, (str, int, float, bool, list, type(None))) else None
    except (ValueError, TypeError):
        return None


def _target_name(statement: ast.stmt) -> str | None:
    if isinstance(statement, (ast.Assign, ast.AnnAssign)):
        target = statement.targets[0] if isinstance(statement, ast.Assign) and statement.targets else statement.target
        return target.id if isinstance(target, ast.Name) else None
    return None


def _call(statement: ast.stmt) -> ast.Call | None:
    value: ast.AST | None = None
    if isinstance(statement, ast.Assign): value = statement.value
    elif isinstance(statement, ast.AnnAssign): value = statement.value
    elif isinstance(statement, ast.Expr): value = statement.value
    return value if isinstance(value, ast.Call) else None


def _call_root(call: ast.Call) -> str | None:
    if isinstance(call.func, ast.Attribute):
        return _root_name(call.func.value)
    if isinstance(call.func, ast.Name):
        return call.func.id
    return None


def _slice_parameter(value: ast.AST) -> tuple[str, dict[str, Any]] | None:
    if not isinstance(value, ast.Subscript):
        return None
    root = _root_name(value.value)
    if not root:
        return None
    target = value.slice
    if not isinstance(target, ast.Tuple) or len(target.elts) != 2:
        return None
    def part(name: str, node: ast.AST) -> dict[str, Any] | None:
        if not isinstance(node, ast.Slice): return None
        def literal_or_blank(item: ast.AST | None) -> Any:
            return "" if item is None else _literal(item)
        values = {f"{name}Start": literal_or_blank(node.lower), f"{name}Stop": literal_or_blank(node.upper), f"{name}Step": 1 if node.step is None else _literal(node.step)}
        return values if all(value is not None for value in values.values()) else None
    row = part("row", target.elts[0]); column = part("column", target.elts[1])
    if row is None or column is None: return None
    return root, {**row, **column}


def _constant_int(node: ast.AST | None) -> int | None:
    value = _literal(node) if node is not None else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _modulo_equals(node: ast.AST, index_name: str, divisor: int, remainder: int = 0) -> bool:
    """匹配 `index % divisor == remainder`（含加括号形式）。"""
    if not (isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq) and len(node.comparators) == 1):
        return False
    binop = node.left
    if not (isinstance(binop, ast.BinOp) and isinstance(binop.op, ast.Mod) and isinstance(binop.left, ast.Name) and binop.left.id == index_name):
        return False
    return _constant_int(binop.right) == divisor and _literal(node.comparators[0]) == remainder


def _is_append(statement: ast.stmt, target_name: str) -> bool:
    """匹配 `target.append(value)` 表达式语句。"""
    return (isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Call)
            and isinstance(statement.value.func, ast.Attribute)
            and isinstance(statement.value.func.value, ast.Name)
            and statement.value.func.value.id == target_name
            and statement.value.func.attr == "append")


def _detect_oscillating_pulse(tree: ast.Module, assignment_values: dict[str, Any], source: str) -> dict[str, Any] | None:
    """结构化识别周期震荡脉冲代码：常量赋值 → np.arange 时间轴 → 双通道列表 → 振荡 for → zip 打印。

    替代旧的“名称集合 + 源码子串”启发式（`"i % 4" in source`），只接受真实的 AST
    结构匹配，避免把任意含相同名称或子串的代码误识别为脉冲生成器。
    """
    # 1) 时间轴赋值：time_points = np.arange(duration, total, duration)
    time_name: str | None = None
    for statement in tree.body:
        if (isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name)
                and isinstance(statement.value, ast.Call) and isinstance(statement.value.func, ast.Attribute)
                and isinstance(statement.value.func.value, ast.Name) and statement.value.func.value.id in {"np", "numpy"}
                and statement.value.func.attr == "arange" and len(statement.value.args) == 3):
            time_name = statement.targets[0].id
            break
    if time_name is None:
        return None
    # 2) 双通道列表初始化：port1, port2 = [], []
    pair: list[str] | None = None
    for statement in tree.body:
        if (isinstance(statement, ast.Assign) and len(statement.targets) == 1
                and isinstance(statement.targets[0], ast.Tuple) and len(statement.targets[0].elts) == 2
                and all(isinstance(target, ast.Name) for target in statement.targets[0].elts)
                and isinstance(statement.value, (ast.List, ast.Tuple)) and len(statement.value.elts) == 2
                and all(isinstance(element, ast.List) and not element.elts for element in statement.value.elts)):
            pair = [target.id for target in statement.targets[0].elts if isinstance(target, ast.Name)]
            break
    if not pair:
        return None
    # 3) 振荡循环：for i, t in enumerate(time_points):
    loop: ast.For | None = None
    for statement in tree.body:
        if (isinstance(statement, ast.For) and isinstance(statement.target, ast.Tuple) and len(statement.target.elts) == 2
                and isinstance(statement.iter, ast.Call) and isinstance(statement.iter.func, ast.Name)
                and statement.iter.func.id == "enumerate" and len(statement.iter.args) == 1
                and isinstance(statement.iter.args[0], ast.Name) and statement.iter.args[0].id == time_name):
            loop = statement
            break
    if not loop or len(loop.body) != 1 or not isinstance(loop.body[0], ast.If):
        return None
    index_name = loop.target.elts[0].id if isinstance(loop.target.elts[0], ast.Name) else None
    if not index_name:
        return None
    main_if = loop.body[0]
    if not _modulo_equals(main_if.test, index_name, 2, 0):
        return None
    # 偶数分支：a.append(0); b.append(常量)
    if not (len(main_if.body) == 2 and _is_append(main_if.body[0], pair[0]) and _is_append(main_if.body[1], pair[1])):
        return None
    # 奇数分支（else 平铺 4 条）：a.append(amp); b.append(0); amp = -amp; if i % 4 == 1: amp -= step
    if len(main_if.orelse) != 4 or not _is_append(main_if.orelse[0], pair[0]) or not _is_append(main_if.orelse[1], pair[1]):
        return None
    invert = main_if.orelse[2]
    if not (isinstance(invert, ast.Assign) and len(invert.targets) == 1 and isinstance(invert.targets[0], ast.Name)
            and isinstance(invert.value, ast.UnaryOp) and isinstance(invert.value.op, ast.USub)):
        return None
    amplitude_name = invert.targets[0].id
    step_if = main_if.orelse[3]
    if not (isinstance(step_if, ast.If) and _modulo_equals(step_if.test, index_name, 4, 1) and len(step_if.body) == 1):
        return None
    step_assign = step_if.body[0]
    is_step_assign = False
    if isinstance(step_assign, ast.Assign) and len(step_assign.targets) == 1:
        is_step_assign = (isinstance(step_assign.targets[0], ast.Name) and step_assign.targets[0].id == amplitude_name
                          and isinstance(step_assign.value, ast.BinOp) and isinstance(step_assign.value.op, ast.Sub)
                          and isinstance(step_assign.value.left, ast.Name) and step_assign.value.left.id == amplitude_name)
    elif isinstance(step_assign, ast.AugAssign):
        is_step_assign = (isinstance(step_assign.target, ast.Name) and step_assign.target.id == amplitude_name
                          and isinstance(step_assign.op, ast.Sub) and isinstance(step_assign.value, ast.Name))
    if not is_step_assign:
        return None
    # 4) 打印循环：for row in zip(time_points, ...): print(row)
    printed = any(
        isinstance(statement, ast.For) and isinstance(statement.iter, ast.Call)
        and isinstance(statement.iter.func, ast.Name) and statement.iter.func.id == "zip"
        and any(isinstance(arg, ast.Name) and arg.id == time_name for arg in statement.iter.args)
        and len(statement.body) == 1 and isinstance(statement.body[0], ast.Expr)
        and isinstance(statement.body[0].value, ast.Call) and isinstance(statement.body[0].value.func, ast.Name)
        and statement.body[0].value.func.id == "print"
        for statement in tree.body
    )
    if not printed:
        return None
    return {
        "recognized": True, "semantic": True, "kind": "compound", "nodeType": "notebook.code_cell",
        "label": "周期震荡脉冲 · 2 步",
        "parameters": {"source": source, "astKind": "Module"},
        "defines": ["pulse_waveform"], "uses": [],
        "operations": [
            {"index": 0, "recognized": True, "semantic": True, "kind": "pulse-pattern",
             "nodeType": "pulse.generate_oscillating_ramp", "label": "生成周期震荡脉冲",
             "parameters": {"interval": assignment_values.get("pulse_duration", 0.005), "totalTime": assignment_values.get("total_time", 10),
                            "amplitudeStep": assignment_values.get("voltage_amplitude", 0.2), "fixedVoltage": assignment_values.get("fixed_voltage", 0.6), "gateVoltage": 0},
             "defines": ["pulse_waveform"], "uses": [], "outputVariable": "pulse_waveform", "source": source},
            {"index": 1, "recognized": True, "semantic": True, "kind": "call", "nodeType": "python.print",
             "label": "打印脉冲表", "parameters": {}, "defines": [], "uses": ["pulse_waveform"],
             "inputVariable": "pulse_waveform", "outputVariable": "pulse_waveform", "source": "print(pulse_waveform)"},
        ],
    }


def _statement_base(statement: ast.stmt, source: str) -> dict[str, Any]:
    """构建语句的基础描述（未映射时的默认记录）。"""
    definitions = sorted({node.id for node in ast.walk(statement) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)})
    uses = sorted({node.id for node in ast.walk(statement) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)})
    fragment = ast.get_source_segment(source, statement) or ast.unparse(statement)
    kind = type(statement).__name__
    return {"recognized": True, "semantic": False, "kind": kind, "nodeType": "notebook.code_cell", "label": CONTROL_LABELS.get(kind, kind), "parameters": {"source": fragment, "astKind": kind}, "source": fragment, "defines": definitions, "uses": uses, "reason": f"尚未将 {kind} 映射为默认节点"}


def _condition_table_variable(test: ast.AST, uses: list[str]) -> tuple[str | None, str]:
    """推导条件里的表格变量（`frame['voltage']` / `frame.voltage`），并把列引用改写为反引号形式。"""
    candidates = [name for name in uses if name not in {"True", "False", "None"}]
    table_candidates = [_root_name(item.value) for item in ast.walk(test) if isinstance(item, ast.Subscript)]
    table_variable = next((name for name in table_candidates if name), None)
    condition = ast.unparse(test)
    if table_variable:
        condition = re.sub(rf"\b{re.escape(table_variable)}\[['\"]([^'\"]+)['\"]\]", r"`\1`", condition)
        condition = re.sub(rf"\b{re.escape(table_variable)}\.([A-Za-z_]\w*)", r"\1", condition)
    return table_variable, condition


def _branch_children(statements: list[ast.stmt], source: str, branch: str, user_functions: dict[str, dict[str, Any]] | None = None) -> tuple[list[dict[str, Any]], bool]:
    """Analyze one visual-structure branch.

    A partially converted control-flow block is not semantically safe: executing
    only the recognized statements silently drops the rest of the Python body.
    Return an explicit completeness flag so callers can keep the *whole* block
    as a notebook.code_cell whenever any child is not structurally representable.
    """
    children: list[dict[str, Any]] = []
    complete = True
    for child_index, child in enumerate(statements):
        child_result = _analyze_statement(child, source, user_functions)
        if child_result.get("semantic"):
            children.append({**child_result, "branch": branch, "childIndex": child_index})
        else:
            complete = False
    return children, complete


def _analyze_function_definition(statement: ast.stmt, source: str, base: dict[str, Any], function_id: str | None = None) -> dict[str, Any] | None:
    """Recognize a Python definition without changing its execution semantics.

    ``custom.python_function`` is an *invocation/transform* node.  Treating a
    plain ``def`` statement as that node immediately calls the function and is
    therefore incorrect.  Definitions stay in the shared notebook namespace;
    later compiler passes may promote individual call sites once their complete
    signature/dependency graph is known.
    """
    if not isinstance(statement, ast.FunctionDef):
        return None
    fragment = ast.get_source_segment(source, statement) or ast.unparse(statement)
    compiled = _compile_workflow_function(statement, source, function_id or f"notebook-fn-{_identifier_slug(statement.name)}")
    function_parameters: dict[str, Any] = {"source": fragment, "astKind": "FunctionDef"}
    if compiled is not None:
        function_parameters.update({
            "workflowFunctionId": compiled["id"],
            "workflowFunctionCode": compiled["code"],
            "workflowFunctionInputsJson": json.dumps(compiled["inputNames"], ensure_ascii=False),
            "workflowFunctionInputTypesJson": json.dumps(compiled["inputTypes"], ensure_ascii=False),
            "workflowFunctionOutputsJson": json.dumps(compiled["outputIds"], ensure_ascii=False),
            "workflowFunctionOutputTypesJson": json.dumps(compiled["outputTypes"], ensure_ascii=False),
            "workflowFunctionDependenciesJson": json.dumps(compiled["dependencyNames"], ensure_ascii=False),
        })
    return {
        **base,
        "recognized": True, "semantic": False, "kind": "FunctionDef",
        "nodeType": "notebook.code_cell",
        "label": f"定义函数 · {statement.name}",
        "parameters": function_parameters,
        "defines": [statement.name],
        "uses": [],
        "reason": "函数定义保留在 Notebook 共享命名空间；调用点在确认依赖后再结构化",
    }


def _analyze_control_flow(
    statement: ast.stmt,
    source: str,
    base: dict[str, Any],
    user_functions: dict[str, dict[str, Any]] | None = None,
    function_id: str | None = None,
) -> dict[str, Any] | None:
    """识别导入、If/For/While 及暂不支持的控制结构；非控制流语句返回 None。"""
    if isinstance(statement, (ast.Import, ast.ImportFrom)):
        definitions: list[str] = []
        if isinstance(statement, ast.Import):
            definitions = [alias.asname or alias.name.split(".")[0] for alias in statement.names]
        else:
            definitions = [alias.asname or alias.name for alias in statement.names if alias.name != "*"]
        return {
            **base,
            "recognized": True,
            "semantic": False,
            "nodeType": "notebook.code_cell",
            "label": "导入模块",
            "defines": definitions,
            "reason": "导入语句保留在 Notebook 共享命名空间",
        }
    if isinstance(statement, ast.FunctionDef):
        definition = _analyze_function_definition(statement, source, base, function_id)
        if definition is not None:
            return definition
        return {**base, "recognized": False, "reason": "函数无法自动转换为自定义节点（含 *args/**kwargs 或无法解析）", "label": "函数定义"}
    if isinstance(statement, ast.If):
        return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "label": "If 条件 · 原样执行", "reason": "Python if 是标量控制流；当前 logic.if_subflow 是表格分支语义，不能自动视为等价"}
    if isinstance(statement, ast.For):
        body_has_read = any(
            isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr in {"read_csv", "read_table", "read_json", "read_excel", "read_parquet"}
            for node in ast.walk(statement)
        )
        if body_has_read:
            return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "reason": "多文件扫描循环保留原始 Python；当前表格 for_each 节点不等价于 Python iterable 语义", "label": "多文件扫描 · 原样执行"}
        return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "label": "For 循环 · 原样执行", "reason": "普通 Python for 与当前表格 for_each 子流程语义不同；仅可证明等价的函数映射模式自动提升"}
    if isinstance(statement, ast.While):
        return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "label": "While 循环 · 原样执行", "reason": "Python while 与当前表格 while_subflow 查询语义不同，保留原始 Python"}
    # Unsupported Python is deliberately kept as an explicit code carrier.  The
    # importer must never claim a partial visual graph is equivalent to the
    # original notebook while silently dropping executable statements.
    if isinstance(statement, (ast.AsyncFunctionDef, ast.With, ast.Try, ast.For, ast.While)):
        return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "reason": "尚无等价默认节点，保留原始 Python", "label": CONTROL_LABELS.get(base["kind"], base["kind"])}
    return None


def _contains_comparison(node: ast.AST) -> bool:
    return any(isinstance(item, ast.Compare) for item in ast.walk(node))


def _rewrite_query_condition(node: ast.AST, root: str) -> str | None:
    """把布尔索引条件重写为 pandas query 语法（列下标转反引号，~ 转 not）。"""
    condition = ast.unparse(node)
    if not condition:
        return None
    condition = re.sub(rf"\b{re.escape(root)}\[['\"]([^'\"]+)['\"]\]", r"`\1`", condition)
    condition = re.sub(rf"\b{re.escape(root)}\.([A-Za-z_]\w*)", r"\1", condition)
    condition = re.sub(r"~\s*", "not ", condition)
    return condition


def _analyze_assignment(statement: ast.stmt, source: str, base: dict[str, Any]) -> dict[str, Any] | None:
    """识别非调用的赋值模式：布尔索引、列选择、行列切片与转置。"""
    value = statement.value
    target = _target_name(statement)
    # 布尔索引 / 列选择：df = df[条件] / df[['a','b']] / df['col']（Name 下标，区别于 df.iloc[...]）
    if isinstance(value, ast.Subscript) and isinstance(value.ctx, ast.Load) and isinstance(value.value, ast.Name):
        root = _root_name(value.value)
        if root:
            if isinstance(value.slice, ast.List):
                try:
                    columns = [ast.literal_eval(element) for element in value.slice.elts]
                except (ValueError, TypeError):
                    columns = []
                if columns and all(isinstance(column, (str, int)) for column in columns):
                    return {**base, "semantic": True, "kind": "select", "nodeType": "table.select_columns", "label": target or "选择列", "parameters": {"columns": ",".join(str(column) for column in columns)}, "inputVariable": root, "outputVariable": target or root}
            if isinstance(value.slice, ast.Constant) and isinstance(value.slice.value, str):
                return {**base, "semantic": True, "kind": "select", "nodeType": "table.select_columns", "label": target or "选择列", "parameters": {"columns": value.slice.value}, "inputVariable": root, "outputVariable": target or root}
            if _contains_comparison(value.slice):
                condition = _rewrite_query_condition(value.slice, root)
                if condition:
                    return {**base, "semantic": True, "kind": "filter", "nodeType": "pandas.query", "label": target or "条件筛选", "parameters": {"expression": condition}, "inputVariable": root, "outputVariable": target or root}
    slice_value = _slice_parameter(value)
    if slice_value:
        root, slice_parameters = slice_value
        return {**base, "semantic": True, "kind": "slice", "nodeType": "table.slice", "label": target or "行列切片", "parameters": slice_parameters, "inputVariable": root, "outputVariable": target or root}
    if isinstance(value, ast.Attribute) and value.attr == "T":
        root = _root_name(value.value)
        if root: return {**base, "semantic": True, "kind": "call", "nodeType": "table.transpose", "label": target or "转置", "parameters": {}, "inputVariable": root, "outputVariable": target or root}
    # 配置/准备代码：给出明确分类，而非笼统的"Assign 未映射"
    if isinstance(value, ast.ListComp):
        return {**base, "recognized": False, "reason": "列表推导（参数或文件路径准备，建议用变量节点承载）"}
    if isinstance(value, (ast.List, ast.Tuple, ast.Dict)):
        return {**base, "recognized": False, "reason": "参数列表/字典（配置准备，可用变量节点承载）"}
    if isinstance(value, ast.Constant):
        if isinstance(value.value, str) and ("\\" in value.value or "/" in value.value):
            return {**base, "recognized": False, "reason": "路径常量（运行时环境不可用，建议用运行时文件选择）"}
        return {**base, "recognized": False, "reason": "常量赋值（配置准备，可用变量节点承载）"}
    return None


def _column_name(node: ast.AST) -> str | None:
    """提取 df['col'] 或 df.col 的列名。"""
    if isinstance(node, ast.Subscript):
        if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
            return node.slice.value
    elif isinstance(node, ast.Attribute):
        return node.attr
    return None


def _resolve_user_function_inputs(
    call: ast.Call,
    function_info: dict[str, Any],
    *,
    mapped_name: str | None = None,
    mapped_iterable: ast.AST | None = None,
) -> dict[str, Any] | None:
    """Resolve one user-function invocation against its original signature.

    The notebook compiler uses the same binding rules for a direct call and a
    mapped/list-comprehension call.  ``mapped_name`` is deliberately strict: it
    must be passed as one plain argument and the iterable must be a named value.
    Expressions such as ``fn(item + 1)`` remain Python code until the map runtime
    can represent per-item expressions without changing evaluation order.
    """
    function = function_info.get("function")
    if not isinstance(function, ast.FunctionDef):
        return None
    if any(isinstance(argument, ast.Starred) for argument in call.args) or any(keyword.arg is None for keyword in call.keywords):
        return None

    positional_parameters = [*function.args.posonlyargs, *function.args.args]
    keyword_only_parameters = list(function.args.kwonlyargs)
    positional_defaults = [None] * (len(positional_parameters) - len(function.args.defaults)) + list(function.args.defaults)
    keyword_defaults = list(function.args.kw_defaults)
    supplied: dict[str, ast.AST] = {}
    if len(call.args) > len(positional_parameters):
        return None
    for parameter, value in zip(positional_parameters, call.args):
        supplied[parameter.arg] = value
    allowed_keywords = {parameter.arg for parameter in [*function.args.args, *keyword_only_parameters]}
    for keyword in call.keywords:
        if keyword.arg not in allowed_keywords or keyword.arg in supplied:
            return None
        supplied[keyword.arg] = keyword.value

    for parameter, default in zip(positional_parameters, positional_defaults):
        if parameter.arg not in supplied:
            if default is None:
                return None
            supplied[parameter.arg] = default
    for parameter, default in zip(keyword_only_parameters, keyword_defaults):
        if parameter.arg not in supplied:
            if default is None:
                return None
            supplied[parameter.arg] = default

    bindings: dict[str, str] = {}
    literals: dict[str, Any] = {}
    expressions: dict[str, str] = {}
    uses: list[str] = []
    mapped_parameter: str | None = None
    iterable_name = mapped_iterable.id if isinstance(mapped_iterable, ast.Name) else None
    if mapped_name is not None and iterable_name is None:
        return None

    for parameter_name in function_info.get("parameterNames", []):
        value = supplied.get(parameter_name)
        if value is None:
            return None
        if mapped_name is not None and isinstance(value, ast.Name) and value.id == mapped_name:
            if mapped_parameter is not None:
                return None
            mapped_parameter = parameter_name
            bindings[parameter_name] = iterable_name or ""
            uses.append(iterable_name or "")
            continue
        # If the loop variable appears anywhere except as one direct argument,
        # promotion would require per-item expression evaluation. Keep it as
        # Python rather than pretending a single precomputed input is equivalent.
        if mapped_name is not None and any(
            isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id == mapped_name
            for node in ast.walk(value)
        ):
            return None
        if isinstance(value, ast.Name):
            bindings[parameter_name] = value.id
            uses.append(value.id)
            continue
        literal = _json_literal(value)
        if literal is not ...:
            literals[parameter_name] = literal
            continue
        if _safe_expression(value):
            expressions[parameter_name] = ast.unparse(value)
            for node in ast.walk(value):
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                    uses.append(node.id)
            continue
        return None

    for dependency in function_info.get("dependencyNames", []):
        bindings[dependency] = dependency
        uses.append(dependency)

    if mapped_name is not None and mapped_parameter is None:
        return None
    return {
        "bindings": bindings,
        "literals": literals,
        "expressions": expressions,
        "uses": sorted({name for name in uses if name}),
        "mappedParameter": mapped_parameter,
    }


def _analyze_user_function_call(
    call: ast.Call,
    statement: ast.stmt,
    base: dict[str, Any],
    function_info: dict[str, Any],
) -> dict[str, Any] | None:
    function = function_info.get("function")
    if not isinstance(function, ast.FunctionDef):
        return None
    resolved = _resolve_user_function_inputs(call, function_info)
    if resolved is None:
        return None
    bindings = resolved["bindings"]
    literals = resolved["literals"]
    expressions = resolved["expressions"]
    uses = resolved["uses"]

    output_ids = list(function_info.get("outputIds", ["output"]))
    targets = _assignment_target_names(statement)
    if len(output_ids) > 1 and targets and len(targets) != len(output_ids):
        return None
    if len(output_ids) == 1 and len(targets) > 1:
        return None
    defines = targets
    output_variable = targets[0] if len(targets) == 1 else None
    return {
        **base,
        "recognized": True,
        "semantic": True,
        "kind": "UserFunctionCall",
        "nodeType": "function.call",
        "label": function_info.get("name") or getattr(call.func, "id", "函数调用"),
        "parameters": {
            "functionId": function_info["id"],
            "functionVersion": 1,
            "notebookInputBindingsJson": json.dumps(bindings, ensure_ascii=False),
            "notebookLiteralInputsJson": json.dumps(literals, ensure_ascii=False),
            "notebookExpressionInputsJson": json.dumps(expressions, ensure_ascii=False),
            "notebookFunctionInputsJson": json.dumps(function_info.get("inputNames", []), ensure_ascii=False),
            "notebookFunctionInputTypesJson": json.dumps(function_info.get("inputTypes", []), ensure_ascii=False),
            "notebookFunctionOutputsJson": json.dumps(output_ids, ensure_ascii=False),
            "notebookFunctionOutputTypesJson": json.dumps(function_info.get("outputTypes", []), ensure_ascii=False),
        },
        "inputVariable": next(iter(bindings.values()), None),
        "outputVariable": output_variable,
        "defines": defines,
        "uses": sorted(set(uses)),
    }


def _analyze_user_function_map_assignment(
    statement: ast.stmt,
    source: str,
    base: dict[str, Any],
    user_functions: dict[str, dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Promote the safe subset of list comprehensions to ``function.map``.

    Supported forms intentionally mirror the dominant scientific-notebook
    patterns in the regression corpus::

        values = [measure(path, sign) for path in paths]
        frame = pd.DataFrame([measure(path, sign) for path in paths])

    One generator, one plain loop variable, no filters, and a direct call to a
    previously promoted user function are required.  Everything else stays as
    lossless Python code.
    """
    if not user_functions or not isinstance(statement, (ast.Assign, ast.AnnAssign)):
        return None
    targets = _assignment_target_names(statement)
    if len(targets) != 1:
        return None
    value = statement.value
    collect_mode = "list"
    comprehension: ast.ListComp | None = None
    if isinstance(value, ast.ListComp):
        comprehension = value
    elif (
        isinstance(value, ast.Call)
        and isinstance(value.func, ast.Attribute)
        and isinstance(value.func.value, ast.Name)
        and value.func.value.id in {"pd", "pandas"}
        and value.func.attr == "DataFrame"
        and len(value.args) == 1
        and not value.keywords
        and isinstance(value.args[0], ast.ListComp)
    ):
        comprehension = value.args[0]
        collect_mode = "table"
    if comprehension is None or len(comprehension.generators) != 1:
        return None
    generator = comprehension.generators[0]
    if generator.is_async or generator.ifs or not isinstance(generator.target, ast.Name) or not isinstance(generator.iter, ast.Name):
        return None
    call = comprehension.elt
    if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name):
        return None
    function_info = user_functions.get(call.func.id)
    if not function_info:
        return None
    resolved = _resolve_user_function_inputs(
        call,
        function_info,
        mapped_name=generator.target.id,
        mapped_iterable=generator.iter,
    )
    if resolved is None or not resolved.get("mappedParameter"):
        return None
    output_ids = list(function_info.get("outputIds", ["output"]))
    return {
        **base,
        "recognized": True,
        "semantic": True,
        "kind": "UserFunctionMap",
        "nodeType": "function.map",
        "label": f"映射 · {function_info.get('name') or call.func.id}",
        "parameters": {
            "functionId": function_info["id"],
            "functionVersion": 1,
            "mapInput": resolved["mappedParameter"],
            "collectMode": collect_mode,
            "maxIterations": 100000,
            "notebookInputBindingsJson": json.dumps(resolved["bindings"], ensure_ascii=False),
            "notebookLiteralInputsJson": json.dumps(resolved["literals"], ensure_ascii=False),
            "notebookExpressionInputsJson": json.dumps(resolved["expressions"], ensure_ascii=False),
            "notebookFunctionInputsJson": json.dumps(function_info.get("inputNames", []), ensure_ascii=False),
            "notebookFunctionInputTypesJson": json.dumps(function_info.get("inputTypes", []), ensure_ascii=False),
            "notebookFunctionOutputsJson": json.dumps(output_ids, ensure_ascii=False),
            "notebookFunctionOutputTypesJson": json.dumps(function_info.get("outputTypes", []), ensure_ascii=False),
        },
        "inputVariable": generator.iter.id,
        "outputVariable": targets[0],
        "defines": targets,
        "uses": resolved["uses"],
    }


def _analyze_user_function_concat_loop(
    statement: ast.stmt,
    source: str,
    base: dict[str, Any],
    user_functions: dict[str, dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Promote one exact ``map + concat(axis=1)`` scientific loop.

    Supported forms are deliberately narrow::

        for item in items:
            frame = transform(item, factor)
            result = pd.concat([result, frame], axis=1)

        for item in items:
            result = pd.concat([result, transform(item, factor)], axis=1)

    Conditions, additional side effects, iterator-index expressions and concat
    options other than ``axis=1`` remain lossless Python code.
    """
    if not user_functions or not isinstance(statement, ast.For):
        return None
    if statement.orelse or not isinstance(statement.target, ast.Name) or not isinstance(statement.iter, ast.Name):
        return None
    if len(statement.body) not in {1, 2}:
        return None

    call: ast.Call | None = None
    temporary_name: str | None = None
    concat_statement: ast.Assign | None = None
    if len(statement.body) == 2:
        first, second = statement.body
        if not (
            isinstance(first, ast.Assign)
            and len(first.targets) == 1
            and isinstance(first.targets[0], ast.Name)
            and isinstance(first.value, ast.Call)
            and isinstance(first.value.func, ast.Name)
            and first.value.func.id in user_functions
            and isinstance(second, ast.Assign)
        ):
            return None
        temporary_name = first.targets[0].id
        call = first.value
        concat_statement = second
    else:
        only = statement.body[0]
        if not isinstance(only, ast.Assign):
            return None
        concat_statement = only

    if len(concat_statement.targets) != 1 or not isinstance(concat_statement.targets[0], ast.Name):
        return None
    accumulator = concat_statement.targets[0].id
    concat_call = concat_statement.value
    if not (
        isinstance(concat_call, ast.Call)
        and isinstance(concat_call.func, ast.Attribute)
        and isinstance(concat_call.func.value, ast.Name)
        and concat_call.func.value.id in {"pd", "pandas"}
        and concat_call.func.attr == "concat"
        and len(concat_call.args) == 1
        and isinstance(concat_call.args[0], (ast.List, ast.Tuple))
        and len(concat_call.args[0].elts) == 2
    ):
        return None
    initial_item, mapped_item = concat_call.args[0].elts
    if not isinstance(initial_item, ast.Name) or initial_item.id != accumulator:
        return None
    axis = 0
    for keyword in concat_call.keywords:
        if keyword.arg != "axis" or not isinstance(keyword.value, ast.Constant):
            return None
        axis = keyword.value.value
    if axis != 1:
        return None

    if temporary_name is not None:
        if not isinstance(mapped_item, ast.Name) or mapped_item.id != temporary_name:
            return None
    else:
        if not (
            isinstance(mapped_item, ast.Call)
            and isinstance(mapped_item.func, ast.Name)
            and mapped_item.func.id in user_functions
        ):
            return None
        call = mapped_item
    if call is None or not isinstance(call.func, ast.Name):
        return None
    function_info = user_functions.get(call.func.id)
    if not function_info or len(function_info.get("outputIds", ["output"])) != 1:
        return None
    resolved = _resolve_user_function_inputs(
        call,
        function_info,
        mapped_name=statement.target.id,
        mapped_iterable=statement.iter,
    )
    if resolved is None or not resolved.get("mappedParameter"):
        return None

    output_ids = list(function_info.get("outputIds", ["output"]))
    return {
        **base,
        "recognized": True,
        "semantic": True,
        "kind": "UserFunctionMapConcatColumns",
        "nodeType": "function.map",
        "label": f"映射合并 · {function_info.get('name') or call.func.id}",
        "parameters": {
            "functionId": function_info["id"],
            "functionVersion": 1,
            "mapInput": resolved["mappedParameter"],
            "collectMode": "concat_columns",
            "concatInitialVariable": accumulator,
            **({"lastItemVariable": temporary_name} if temporary_name else {}),
            "maxIterations": 100000,
            "notebookInputBindingsJson": json.dumps(resolved["bindings"], ensure_ascii=False),
            "notebookLiteralInputsJson": json.dumps(resolved["literals"], ensure_ascii=False),
            "notebookExpressionInputsJson": json.dumps(resolved["expressions"], ensure_ascii=False),
            "notebookFunctionInputsJson": json.dumps(function_info.get("inputNames", []), ensure_ascii=False),
            "notebookFunctionInputTypesJson": json.dumps(function_info.get("inputTypes", []), ensure_ascii=False),
            "notebookFunctionOutputsJson": json.dumps(output_ids, ensure_ascii=False),
            "notebookFunctionOutputTypesJson": json.dumps(function_info.get("outputTypes", []), ensure_ascii=False),
        },
        "inputVariable": statement.iter.id,
        "outputVariable": accumulator,
        "defines": [accumulator, *([temporary_name] if temporary_name else [])],
        "uses": sorted({*resolved["uses"], accumulator}),
    }


def _analyze_call(
    call: ast.Call,
    statement: ast.stmt,
    source: str,
    base: dict[str, Any],
    user_functions: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """把调用语句映射到节点：内置函数、专用函数、pandas/numpy 方法与转换。"""
    if isinstance(call.func, ast.Name) and user_functions and call.func.id in user_functions:
        converted = _analyze_user_function_call(call, statement, base, user_functions[call.func.id])
        if converted is not None:
            return converted
    if isinstance(call.func, ast.Attribute) and call.func.attr == "linregress" and len(call.args) >= 2:
        x_arg, y_arg = call.args[0], call.args[1]
        x_root = _root_name(x_arg)
        y_root = _root_name(y_arg)
        x_col = _column_name(x_arg)
        y_col = _column_name(y_arg)
        if x_root and x_root == y_root and x_col and y_col:
            target = _target_name(statement)
            return {**base, "semantic": True, "kind": "call", "nodeType": "analysis.linear_fit", "label": target or "线性拟合", "parameters": {"xColumn": x_col, "yColumn": y_col}, "inputVariable": x_root, "outputVariable": target or x_root}
    if isinstance(call.func, ast.Attribute) and call.func.attr == "show" and _root_name(call.func.value) in {"plt", "pyplot", "matplotlib"}:
        return {**base, "recognized": False, "reason": "绘图显示终点（绘图节点已生成图像，可忽略）"}
    if isinstance(call.func, ast.Name) and call.func.id == "print":
        input_name = _root_name(call.args[0]) if call.args else None
        if input_name:
            return {**base, "semantic": True, "kind": "call", "nodeType": "python.print", "label": "打印输出", "parameters": {}, "inputVariable": input_name, "outputVariable": input_name}
        return {**base, "recognized": False, "reason": "常量打印不需要数据流节点"}
    if isinstance(call.func, ast.Name) and call.func.id in {"str", "float", "int", "bool", "len", "round"}:
        root = _root_name(call.args[0]) if call.args else None
        target = _target_name(statement)
        if root:
            node_type = {"str": "convert.to_text", "float": "convert.to_number", "int": "convert.to_number", "bool": "convert.to_boolean", "len": "python.len", "round": "python.round"}[call.func.id]
            params: dict[str, Any] = {"integer": True} if call.func.id == "int" else {}
            if call.func.id == "round" and len(call.args) > 1 and _constant_int(call.args[1]) is not None: params["digits"] = _constant_int(call.args[1])
            return {**base, "recognized": True, "semantic": True, "kind": "call", "nodeType": node_type, "label": target or call.func.id, "parameters": params, "inputVariable": root, "outputVariable": target or root}
    if isinstance(call.func, ast.Name) and call.func.id in {"Pick_Upper", "Pick_Down"}:
        root = _root_name(call.args[0]) if call.args else None
        group_size = _constant_int(call.args[1]) if len(call.args) > 1 else None
        count = _constant_int(call.args[2]) if len(call.args) > 2 else None
        target = _target_name(statement)
        if root and group_size and count:
            return {**base, "semantic": True, "kind": "call", "nodeType": "table.periodic_window", "label": target or "周期窗口抽取", "parameters": {"groupSize": group_size, "position": "start" if call.func.id == "Pick_Upper" else "end", "offset": 0, "count": count}, "inputVariable": root, "outputVariable": target or root}
        return {**base, "recognized": False, "reason": "周期窗口参数必须是固定整数"}
    if isinstance(call.func, ast.Name) and call.func.id == "Split_count":
        root = _root_name(call.args[0]) if call.args else None
        group_size = _constant_int(call.args[1]) if len(call.args) > 1 else None
        tail_rows = _constant_int(call.args[2]) if len(call.args) > 2 else None
        target = _target_name(statement)
        if root and group_size and tail_rows:
            return {**base, "semantic": True, "kind": "call", "nodeType": "table.periodic_tail_mean", "label": target or "周期末段均值", "parameters": {"groupSize": group_size, "tailRows": tail_rows}, "inputVariable": root, "outputVariable": target or root}
        return {**base, "recognized": False, "reason": "周期均值参数必须是固定整数"}
    if not isinstance(call.func, ast.Attribute):
        return {**base, "recognized": False}
    target = _target_name(statement)
    parameter_names = {"sep": "separator", "skiprows": "skipRows", "usecols": "useColumns", "nrows": "nRows", "ascending": "ascending", "by": "columns", "logy": "logY", "logx": "logX", "xlabel": "xLabel", "ylabel": "yLabel", "linestyle": "lineStyle", "marker": "marker", "legend": "legend", "title": "title", "index": "includeIndex", "orient": "orient"}
    parameters = {parameter_names.get(keyword.arg, keyword.arg): _literal(keyword.value) for keyword in call.keywords if keyword.arg and _literal(keyword.value) is not None}
    receiver = call.func.value
    root = _root_name(receiver)
    if isinstance(receiver, ast.Name) and receiver.id in {"pd", "pandas"} and call.func.attr in {"read_csv", "read_table", "read_json"}:
        if call.args and isinstance(call.args[0], (ast.Constant, ast.Name)):
            parameters["originalFileExpression"] = ast.unparse(call.args[0])
        if call.func.attr == "read_table" and "separator" not in parameters:
            parameters["separator"] = "\\t"
        parameters["platformInput"] = True
        node_type = "io.read_csv" if call.func.attr == "read_csv" else "io.read_table"
        return {**base, "semantic": True, "kind": "call", "nodeType": node_type, "label": target or ("读取 CSV" if node_type == "io.read_csv" else "读取通用表格"), "parameters": parameters, "inputVariable": None, "outputVariable": target}
    if isinstance(receiver, ast.Name) and receiver.id in {"pd", "pandas"} and call.func.attr in {"DataFrame", "Series"}:
        root = _root_name(call.args[0]) if call.args else None
        if root: return {**base, "recognized": True, "semantic": True, "kind": "call", "nodeType": "convert.to_table", "label": target or "转为表格", "parameters": {}, "inputVariable": root, "outputVariable": target or root}
    if isinstance(receiver, ast.Name) and receiver.id in {"np", "numpy"} and call.func.attr in {"array", "asarray"}:
        root = _root_name(call.args[0]) if call.args else None
        if root: return {**base, "recognized": True, "semantic": True, "kind": "call", "nodeType": "convert.to_table", "label": target or "数组转表格", "parameters": {}, "inputVariable": root, "outputVariable": target or root}
    if isinstance(receiver, ast.Name) and receiver.id == "json" and call.func.attr in {"loads", "dumps"}:
        root = _root_name(call.args[0]) if call.args else None
        if root: return {**base, "recognized": True, "semantic": True, "kind": "call", "nodeType": "convert.json_parse" if call.func.attr == "loads" else "convert.json_stringify", "label": target or call.func.attr, "parameters": parameters, "inputVariable": root, "outputVariable": target or root}
    if isinstance(receiver, ast.Name) and receiver.id in {"pd", "pandas"} and call.func.attr in {"read_excel", "read_parquet", "read_pickle", "read_feather"}:
        return {**base, "recognized": False, "reason": f"当前默认输入仅支持 CSV，尚未映射 pandas.{call.func.attr}"}
    if isinstance(receiver, ast.Name) and receiver.id in {"pd", "pandas"} and call.func.attr == "concat":
        return {**base, "semantic": True, "kind": "call", "nodeType": "table.concat", "label": target or "合并表格", "parameters": parameters, "outputVariable": target}
    if call.func.attr == "groupby":
        return {**base, "recognized": False, "reason": "groupby 需要链式聚合（如 .mean()/.sum()）"}
    if (isinstance(call.func, ast.Attribute)
            and isinstance(call.func.value, ast.Call)
            and isinstance(call.func.value.func, ast.Attribute)
            and call.func.value.func.attr == "groupby"):
        root = _root_name(call.func.value.func.value)
        groupby_args = call.func.value.args
        if root and groupby_args:
            group_by = ",".join(str(ast.literal_eval(argument)) if isinstance(argument, ast.Constant) else ast.unparse(argument) for argument in groupby_args)
            method = call.func.attr
            if method in {"mean", "median", "sum", "min", "max", "std", "count"}:
                return {**base, "semantic": True, "kind": "call", "nodeType": "table.groupby_aggregate", "label": target or f"分组{method}", "parameters": {"groupBy": group_by, "method": method}, "inputVariable": root, "outputVariable": target or root}
    if call.func.attr == "rename":
        root = _call_root(call)
        if not root: return {**base, "recognized": False}
        columns_kw = next((keyword for keyword in call.keywords if keyword.arg == "columns"), None)
        if columns_kw is not None and isinstance(columns_kw.value, ast.Dict):
            try:
                mapping = ast.literal_eval(columns_kw.value)
            except (ValueError, TypeError):
                mapping = None
            if isinstance(mapping, dict) and all(isinstance(key, (str, int)) for key in mapping):
                names = json.dumps({str(key): value for key, value in mapping.items()}, ensure_ascii=False)
                return {**base, "semantic": True, "kind": "call", "nodeType": "table.rename_columns", "label": target or "重命名列", "parameters": {"names": names}, "inputVariable": root, "outputVariable": target or root}
        return {**base, "recognized": False}
    if call.func.attr in METHOD_NODES:
        root = _call_root(call)
        if not root: return {**base, "recognized": False}
        if call.func.attr == "diff": parameters["periods"] = parameters.get("periods", 1)
        if call.func.attr == "reset_index": parameters["drop"] = parameters.get("drop", False)
        return {**base, "semantic": True, "kind": "call", "nodeType": METHOD_NODES[call.func.attr], "label": target or call.func.attr, "parameters": parameters, "inputVariable": root, "outputVariable": target or root}
    if root and call.func.attr == "to_dict":
        orient = next((_literal(keyword.value) for keyword in call.keywords if keyword.arg == "orient"), "records")
        if orient == "records": return {**base, "recognized": True, "semantic": True, "kind": "call", "nodeType": "convert.table_to_records", "label": target or "表格转记录", "parameters": {}, "inputVariable": root, "outputVariable": target or root}
    if root and call.func.attr == "to_csv" and not call.args:
        return {**base, "recognized": True, "semantic": True, "kind": "call", "nodeType": "convert.table_to_csv", "label": target or "表格转 CSV", "parameters": {"includeIndex": parameters.get("index", False)}, "inputVariable": root, "outputVariable": target or root}
    if root and call.func.attr == "plot":
        return {**base, "semantic": True, "kind": "call", "nodeType": "plot.line", "label": target or "绘图", "parameters": parameters, "inputVariable": root, "outputVariable": target}
    if root and call.func.attr == "to_clipboard":
        return {**base, "semantic": True, "kind": "call", "nodeType": "io.export_csv", "label": "导出结果", "parameters": {"fileName": "clipboard.csv"}, "inputVariable": root, "outputVariable": target}
    return {**base, "recognized": False}


def _analyze_statement(
    statement: ast.stmt,
    source: str,
    user_functions: dict[str, dict[str, Any]] | None = None,
    function_id: str | None = None,
) -> dict[str, Any]:
    base = _statement_base(statement, source)
    mapped_loop = _analyze_user_function_concat_loop(statement, source, base, user_functions)
    if mapped_loop is not None:
        return mapped_loop
    control = _analyze_control_flow(statement, source, base, user_functions, function_id)
    if control is not None:
        return control
    mapped = _analyze_user_function_map_assignment(statement, source, base, user_functions)
    if mapped is not None:
        return mapped
    call = _call(statement)
    if call is None:
        if isinstance(statement, ast.Assign):
            assignment = _analyze_assignment(statement, source, base)
            if assignment is not None:
                return assignment
        return {**base, "recognized": False}
    return _analyze_call(call, statement, source, base, user_functions)


def analyze_python_cell(
    source: str,
    user_functions: dict[str, dict[str, Any]] | None = None,
    cell_index: int = 0,
) -> dict[str, Any]:
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return {"recognized": False, "reason": f"syntax: {error.msg}", "defines": [], "uses": [], "operations": []}
    assignment_values: dict[str, Any] = {}
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name):
            value = _literal(statement.value)
            if value is not None: assignment_values[statement.targets[0].id] = value
    pulse = _detect_oscillating_pulse(tree, assignment_values, source)
    if pulse is not None:
        return pulse
    operations = []
    function_context = user_functions if user_functions is not None else {}
    for index, statement in enumerate(tree.body):
        # _analyze_statement walks only this statement, while retaining its exact source fragment.
        function_id = None
        if isinstance(statement, ast.FunctionDef):
            function_id = f"notebook-fn-{cell_index + 1}-{index + 1}-{_identifier_slug(statement.name)}"
        operation = _analyze_statement(statement, source, function_context, function_id)
        operation["index"] = index
        operations.append(operation)
        if isinstance(statement, ast.FunctionDef):
            compiled = _compile_workflow_function(statement, source, function_id or f"notebook-fn-{_identifier_slug(statement.name)}")
            if compiled is not None:
                function_context[statement.name] = compiled
    definitions = sorted({name for operation in operations for name in operation.get("defines", [])})
    uses = sorted({name for operation in operations for name in operation.get("uses", [])})
    semantic = [operation for operation in operations if operation.get("semantic")]
    if len(operations) == 1:
        return {**operations[0], "operations": operations}
    return {"recognized": bool(semantic), "semantic": bool(semantic), "kind": "compound", "nodeType": "notebook.code_cell", "label": f"代码单元格 · {len(operations)} 步", "parameters": {"source": source, "astKind": "Module"}, "defines": definitions, "uses": uses, "operations": operations}


def analyze_notebook_json(notebook_json: str) -> str:
    notebook = json.loads(notebook_json)
    cells = notebook.get("cells", [])
    analyses = []
    user_functions: dict[str, dict[str, Any]] = {}
    for index, cell in enumerate(cells):
        source = cell.get("source", "")
        if isinstance(source, list): source = "".join(source)
        if cell.get("cell_type") == "code":
            analyses.append({**analyze_python_cell(str(source), user_functions, index), "index": index})
        else:
            analyses.append({"index": index, "recognized": False, "reason": "markdown", "defines": [], "uses": []})
    return json.dumps({"cells": analyses}, ensure_ascii=False)
