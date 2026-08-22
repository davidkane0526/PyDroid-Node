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
    if "[" in normalized and normalized.endswith("]"):
        base = normalized.split("[", 1)[0]
        generic = _VALUE_TYPE_ANNOTATIONS.get(base)
        if generic in {"list", "object"}:
            return generic
    return _VALUE_TYPE_ANNOTATIONS.get(normalized, "any")


def _numeric_sequence_annotation(annotation: ast.AST | None) -> bool:
    if annotation is None:
        return False
    try:
        raw = annotation.value if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str) else ast.unparse(annotation)
    except Exception:
        return False
    normalized = str(raw).strip(" \'\"").replace(" ", "").lower()
    if "[" not in normalized or not normalized.endswith("]"):
        return False
    base, inner = normalized.split("[", 1)
    inner = inner[:-1]
    return base in {"list", "typing.list", "sequence", "typing.sequence"} and inner in {"int", "float", "number"}


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



def _json_string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(key): str(item) for key, item in parsed.items() if str(key) and isinstance(item, str) and item}


def _portable_operation_data_variables(operation: dict[str, Any]) -> set[str]:
    """Return variables represented by real workflow data inputs.

    Portable function lowering is deliberately stricter than ordinary Notebook
    lowering.  A local/function argument may only influence a native node
    through a declared data port.  Dynamic Notebook parameter bindings remain a
    Python-only feature because workflow-function graph inputs map to node data
    handles, not arbitrary NodeSpec parameters.
    """
    parameters = operation.get("parameters", {})
    if not isinstance(parameters, dict):
        parameters = {}
    explicit = _json_string_map(parameters.get("notebookInputBindingsJson"))
    if explicit:
        return set(explicit.values())
    input_variable = operation.get("inputVariable")
    return {input_variable} if isinstance(input_variable, str) and input_variable else set()


def _portable_operation_has_dynamic_parameters(operation: dict[str, Any]) -> bool:
    parameters = operation.get("parameters", {})
    if not isinstance(parameters, dict):
        return True
    for key in (
        "notebookParameterBindingsJson",
        "notebookParameterExpressionsJson",
        "notebookLiteralInputsJson",
        "notebookExpressionInputsJson",
    ):
        raw = parameters.get(key)
        if isinstance(raw, str) and raw.strip() not in {"", "{}"}:
            return True
    return False


def _analyze_portable_function_statement(statement: ast.stmt, source: str) -> dict[str, Any] | None:
    """Analyze one pure function-body statement for native graph lowering.

    Control flow, user-function calls and Python carriers intentionally remain
    out of scope here.  They can be added only after their workflow-function
    port semantics are explicit in both runtimes.
    """
    base = _statement_base(statement, source)
    operation = _analyze_statement(statement, source, None, None)
    if not operation.get("semantic") or not isinstance(operation.get("nodeType"), str):
        return None
    if str(operation["nodeType"]).startswith("notebook.") or operation.get("children"):
        return None
    if _portable_operation_has_dynamic_parameters(operation):
        return None
    return operation


def _portable_single_output(operation: dict[str, Any]) -> str | None:
    definitions = [name for name in operation.get("defines", []) if isinstance(name, str) and name]
    output = operation.get("outputVariable")
    if isinstance(output, str) and output and output not in definitions:
        definitions.append(output)
    unique = list(dict.fromkeys(definitions))
    return unique[0] if len(unique) == 1 else None


def _portable_linear_children(
    statements: list[ast.stmt],
    source: str,
    seed_name: str,
    branch: str,
) -> tuple[list[dict[str, Any]], str] | None:
    """Compile a pure single-input transform chain for one structure branch."""
    current = seed_name
    children: list[dict[str, Any]] = []
    for child_index, child_statement in enumerate(statements):
        operation = _analyze_portable_function_statement(child_statement, source)
        if operation is None:
            return None
        data_variables = _portable_operation_data_variables(operation)
        if data_variables != {current}:
            return None
        output = _portable_single_output(operation)
        if output is None:
            return None
        children.append({**operation, "branch": branch, "childIndex": child_index})
        current = output
    return (children, current) if children else None


def _portable_if_operation(
    statement: ast.If,
    source: str,
    local_names: set[str],
) -> dict[str, Any] | None:
    """Lower a strict value-selecting If to a native structure with pure branches."""
    if not statement.orelse:
        return None
    binding = _simple_boolean_binding(statement.test)
    if binding is None:
        return None
    condition_name, invert = binding
    if condition_name not in local_names:
        return None

    def first_input(statements: list[ast.stmt]) -> str | None:
        if not statements:
            return None
        first = _analyze_portable_function_statement(statements[0], source)
        if first is None:
            return None
        variables = _portable_operation_data_variables(first)
        return next(iter(variables)) if len(variables) == 1 else None

    true_seed = first_input(statement.body)
    false_seed = first_input(statement.orelse)
    if not true_seed or true_seed != false_seed or true_seed not in local_names or true_seed == condition_name:
        return None
    true_chain = _portable_linear_children(statement.body, source, true_seed, "true")
    false_chain = _portable_linear_children(statement.orelse, source, false_seed, "false")
    if true_chain is None or false_chain is None:
        return None
    true_children, true_output = true_chain
    false_children, false_output = false_chain
    if true_output != false_output:
        return None
    return {
        "recognized": True,
        "semantic": True,
        "kind": "PortableIf",
        "nodeType": "logic.if_value",
        "label": f"If 条件 · {true_output}",
        "parameters": {
            "invert": invert,
            "notebookInputBindingsJson": json.dumps({"condition": condition_name, "input": true_seed}, ensure_ascii=False),
            "notebookOutputPortBindingsJson": json.dumps({true_output: "done"}, ensure_ascii=False),
        },
        "defines": [true_output],
        "uses": [condition_name, true_seed],
        "outputVariable": true_output,
        "children": [*true_children, *false_children],
        "source": ast.get_source_segment(source, statement) or ast.unparse(statement),
        "reason": "显式布尔条件与两条纯单输入分支已提升为 Workflow Function 内原生 If 子图",
    }


def _portable_for_structure_operation(
    statement: ast.For,
    source: str,
    known_literals: dict[str, Any],
    portable_sequence_inputs: set[str],
) -> dict[str, Any] | None:
    """Lower a collect-style multi-step loop to For Each + native child graph.

    Accepted form::

        result = []
        for item in items:
            step = <native transform of item>
            result.append(<native transform of step>)

    The structure runtime already collects the final child result for every
    iteration, making it exactly equivalent to the explicit Python append list.
    """
    if statement.orelse or not isinstance(statement.target, ast.Name) or not isinstance(statement.iter, ast.Name):
        return None
    iterable_name = statement.iter.id
    if iterable_name not in portable_sequence_inputs or len(statement.body) < 2:
        return None
    final_statement = statement.body[-1]
    if not isinstance(final_statement, ast.Expr) or not isinstance(final_statement.value, ast.Call):
        return None
    append_call = final_statement.value
    if append_call.keywords or len(append_call.args) != 1:
        return None
    if not isinstance(append_call.func, ast.Attribute) or append_call.func.attr != "append" or not isinstance(append_call.func.value, ast.Name):
        return None
    result_name = append_call.func.value.id
    if known_literals.get(result_name, ...) != []:
        return None

    chain_statements = list(statement.body[:-1])
    appended = append_call.args[0]
    if isinstance(appended, ast.Name):
        expected_final = appended.id
    else:
        temporary = f"__pydroid_for_value_{statement.lineno}"
        synthetic = ast.Assign(targets=[ast.Name(id=temporary, ctx=ast.Store())], value=appended)
        ast.fix_missing_locations(synthetic)
        chain_statements.append(synthetic)
        expected_final = temporary
    chain = _portable_linear_children(chain_statements, source, statement.target.id, "body")
    if chain is None:
        return None
    children, final_output = chain
    if final_output != expected_final:
        return None
    return {
        "recognized": True,
        "semantic": True,
        "kind": "PortableFor",
        "nodeType": "logic.for_each_value",
        "label": f"For Each · {result_name}",
        "parameters": {
            "maxIterations": 10000,
            "notebookInputBindingsJson": json.dumps({"input": iterable_name}, ensure_ascii=False),
            "notebookOutputPortBindingsJson": json.dumps({result_name: "done"}, ensure_ascii=False),
        },
        "defines": [result_name],
        "uses": [iterable_name],
        "outputVariable": result_name,
        "children": children,
        "source": ast.get_source_segment(source, statement) or ast.unparse(statement),
        "reason": "显式 append 收集的多步纯变换循环已提升为 Workflow Function 内 For Each 子图",
    }


def _compile_portable_function_body(
    statement: ast.FunctionDef,
    source: str,
    compiled: dict[str, Any],
) -> dict[str, Any] | None:
    """Compile a provably portable Python ``def`` into native graph IR.

    Local literal initializers are treated as compile-time state only when a
    proven Map/Reduce/Accumulator/While/For lowering consumes them.  Structured
    If/For nodes carry pure child transforms; all other ambiguity falls back to
    the Python kernel.
    """
    if compiled.get("dependencyNames"):
        return None
    if not statement.body or any(isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) for node in statement.body):
        return None

    input_names = [str(name) for name in compiled.get("inputNames", []) if isinstance(name, str) and name]
    input_types = [str(value) for value in compiled.get("inputTypes", [])]
    portable_sequence_inputs = {
        name for name, value_type in zip(input_names, input_types)
        if value_type == "list"
    }
    original_arguments = [*statement.args.posonlyargs, *statement.args.args, *statement.args.kwonlyargs]
    portable_numeric_sequence_inputs = {
        argument.arg for argument in original_arguments
        if _numeric_sequence_annotation(argument.annotation)
    }
    local_names = set(input_names)
    known_literals: dict[str, Any] = {}
    operations: list[dict[str, Any]] = []
    return_variables: list[str] | None = None

    for body_index, body_statement in enumerate(statement.body):
        if isinstance(body_statement, ast.Return):
            if body_index != len(statement.body) - 1 or body_statement.value is None:
                return None
            values = list(body_statement.value.elts) if isinstance(body_statement.value, ast.Tuple) else [body_statement.value]
            return_variables = []
            for output_index, value in enumerate(values):
                if isinstance(value, ast.Name):
                    if value.id not in local_names:
                        return None
                    return_variables.append(value.id)
                    continue
                temporary = f"__pydroid_return_{output_index + 1}"
                synthetic = ast.Assign(targets=[ast.Name(id=temporary, ctx=ast.Store())], value=value)
                ast.fix_missing_locations(synthetic)
                operation = _analyze_portable_function_statement(synthetic, ast.unparse(synthetic))
                if operation is None:
                    return None
                loads = {
                    node.id for node in ast.walk(value)
                    if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in local_names
                }
                if not loads.issubset(_portable_operation_data_variables(operation)):
                    return None
                operation["portableFunctionBodyIndex"] = len(operations)
                operations.append(operation)
                local_names.update(name for name in operation.get("defines", []) if isinstance(name, str) and name)
                if temporary not in local_names:
                    return None
                return_variables.append(temporary)
            break

        # Literal list/identity initializers are compile-time state for strict
        # collection/reduction/while patterns.  They are never emitted as fake
        # variable nodes and must later be consumed by a native operation.
        if isinstance(body_statement, ast.Assign) and len(body_statement.targets) == 1 and isinstance(body_statement.targets[0], ast.Name):
            literal = _literal(body_statement.value)
            if literal is not None:
                target_name = body_statement.targets[0].id
                # A compile-time initializer is safe only before the variable
                # has any runtime producer.  Treating a later reassignment as
                # metadata would leave the earlier graph edge alive and could
                # return stale data instead of the Python literal.
                if target_name in input_names or any(target_name in operation.get("defines", []) for operation in operations):
                    return None
                known_literals[target_name] = literal
                local_names.add(target_name)
                continue

        base = _statement_base(body_statement, source)
        operation: dict[str, Any] | None = None
        if isinstance(body_statement, ast.While):
            operation = _analyze_numeric_while(body_statement, base, known_literals)
        elif isinstance(body_statement, ast.For):
            operation = _analyze_sequence_loop(body_statement, base, known_literals, portable_numeric_sequence_inputs)
            if operation is None:
                operation = _portable_for_structure_operation(body_statement, source, known_literals, portable_sequence_inputs)
        elif isinstance(body_statement, ast.If):
            operation = _portable_if_operation(body_statement, source, local_names)
        if operation is None:
            operation = _analyze_portable_function_statement(body_statement, source)
        if operation is None or _portable_operation_has_dynamic_parameters(operation):
            return None

        if operation.get("kind") not in {"ForMap", "ForReduce", "ForAccumulate", "WhileNumber", "PortableIf", "PortableFor"}:
            loads = {
                node.id for node in ast.walk(body_statement)
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in local_names
            }
            if not loads.issubset(_portable_operation_data_variables(operation)):
                return None
        else:
            represented = _portable_operation_data_variables(operation)
            unresolved = {
                node.id for node in ast.walk(body_statement)
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
                and node.id in local_names
                and node.id not in represented
                and node.id not in known_literals
            }
            if isinstance(body_statement, ast.For):
                unresolved.discard(body_statement.target.id)
            if unresolved:
                return None

        operation["portableFunctionBodyIndex"] = len(operations)
        operations.append(operation)
        definitions = [name for name in operation.get("defines", []) if isinstance(name, str) and name]
        local_names.update(definitions)
        for definition in definitions:
            known_literals.pop(definition, None)

    output_ids = [str(item) for item in compiled.get("outputIds", []) if isinstance(item, str) and item]
    if return_variables is None or len(return_variables) != len(output_ids) or not operations:
        return None
    defined_by_operations = {
        name for operation in operations for name in operation.get("defines", [])
        if isinstance(name, str) and name
    }
    if any(name not in defined_by_operations for name in return_variables):
        return None

    return {
        "version": 2,
        "inputNames": input_names,
        "operations": operations,
        "returns": [
            {"port": port, "variable": variable}
            for port, variable in zip(output_ids, return_variables)
        ],
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
    # ``ast.Import`` / ``ast.ImportFrom`` store imported bindings in
    # ``ast.alias`` objects rather than ``ast.Name(Store)`` nodes.  Missing
    # those bindings meant e.g. ``import pandas as pd`` never became the
    # producer of ``pd``, so later Notebook operations could execute in order
    # but had no visible dependency back to the import statement.
    if isinstance(statement, ast.Import):
        definitions = sorted({
            alias.asname or alias.name.split(".", 1)[0]
            for alias in statement.names
            if alias.name
        })
    elif isinstance(statement, ast.ImportFrom):
        definitions = sorted({
            alias.asname or alias.name
            for alias in statement.names
            if alias.name and alias.name != "*"
        })
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
        portable_body = _compile_portable_function_body(statement, source, compiled)
        if portable_body is not None:
            function_parameters["workflowFunctionPortableBodyJson"] = json.dumps(portable_body, ensure_ascii=False)
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


def _simple_boolean_binding(test: ast.AST) -> tuple[str, bool] | None:
    if isinstance(test, ast.Name):
        return test.id, False
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not) and isinstance(test.operand, ast.Name):
        return test.operand.id, True
    return None


def _safe_scalar_condition(test: ast.AST) -> bool:
    """Conservatively identify side-effect-free scalar boolean expressions.

    DataFrame/Series boolean expressions are deliberately rejected because their
    truth value is not Python scalar truth.  Pure name/arithmetic/comparison
    expressions and ``.empty`` checks are safe to evaluate from the Notebook
    namespace.
    """
    for item in ast.walk(test):
        if isinstance(item, (ast.Await, ast.Yield, ast.YieldFrom, ast.Lambda, ast.NamedExpr, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            return False
        if isinstance(item, ast.Subscript):
            return False
        if isinstance(item, ast.Attribute) and item.attr != "empty":
            return False
        if isinstance(item, ast.Call):
            if not (isinstance(item.func, ast.Name) and item.func.id == "len" and len(item.args) == 1 and not item.keywords):
                return False
    return True


def _condition_input_metadata(test: ast.AST) -> tuple[dict[str, str], list[str], bool] | None:
    binding = _simple_boolean_binding(test)
    if binding:
        name, invert = binding
        return {"notebookInputBindingsJson": json.dumps({"condition": name}, ensure_ascii=False)}, [name], invert
    if not _safe_scalar_condition(test):
        return None
    expression = ast.unparse(test)
    uses = sorted({item.id for item in ast.walk(test) if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load) and item.id != "len"})
    return {"notebookExpressionInputsJson": json.dumps({"condition": expression}, ensure_ascii=False)}, uses, False


def _safe_range_argument(node: ast.AST) -> bool:
    if _safe_expression(node):
        return True
    # ``len(name)`` / ``len(obj.attr)`` are deterministic iterable-shape reads.
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "len" and len(node.args) == 1 and not node.keywords:
        return _safe_expression(node.args[0])
    return False


def _simple_for_iterable(node: ast.AST) -> tuple[dict[str, str], dict[str, Any]] | None:
    """Return Notebook input metadata for a safe iterable expression."""
    if isinstance(node, ast.Name):
        return {"notebookInputBindingsJson": json.dumps({"input": node.id}, ensure_ascii=False)}, {"uses": [node.id]}
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        try:
            value = ast.literal_eval(node)
            # JSON carries lists portably; tuple/set ordering semantics are not
            # silently rewritten because those containers may matter to user code.
            if isinstance(value, list):
                return {"notebookLiteralInputsJson": json.dumps({"input": value}, ensure_ascii=False)}, {"uses": []}
        except (ValueError, TypeError):
            pass
        return None
    if isinstance(node, ast.Attribute) and node.attr == "columns" and _safe_expression(node.value):
        expression = ast.unparse(node)
        uses = sorted({item.id for item in ast.walk(node.value) if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load)})
        return {"notebookExpressionInputsJson": json.dumps({"input": expression}, ensure_ascii=False)}, {"uses": uses}
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "range" and not node.keywords:
        if all(_safe_range_argument(argument) for argument in node.args):
            expression = ast.unparse(node)
            uses = sorted({item.id for argument in node.args for item in ast.walk(argument) if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load) and item.id != "len"})
            return {"notebookExpressionInputsJson": json.dumps({"input": expression}, ensure_ascii=False)}, {"uses": uses}
    return None



def _portable_numeric_map_expression(node: ast.AST, item_name: str) -> str | None:
    """Translate a proven numeric loop expression into the shared map language.

    The JavaScript and Python sequence runtimes intentionally support only the
    small arithmetic/boolean expression language used by ``logicExpression``.
    Do not lower arbitrary Python calls, attributes or subscripts merely to
    increase the visual-node count.
    """
    allowed_nodes = (
        ast.Expression, ast.Constant, ast.Name, ast.BinOp, ast.UnaryOp,
        ast.BoolOp, ast.Compare, ast.Add, ast.Sub, ast.Mult, ast.Div,
        ast.FloorDiv, ast.Mod, ast.Pow, ast.UAdd, ast.USub, ast.Not,
        ast.And, ast.Or, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq,
        ast.Load,
    )
    for item in ast.walk(node):
        if not isinstance(item, allowed_nodes):
            return None
        if isinstance(item, ast.Constant) and not isinstance(item.value, (int, float, bool)):
            return None
        if isinstance(item, ast.Name) and item.id != item_name:
            return None

    class RenameItem(ast.NodeTransformer):
        def visit_Name(self, candidate: ast.Name) -> ast.AST:  # noqa: N802
            if candidate.id == item_name:
                return ast.copy_location(ast.Name(id="value", ctx=candidate.ctx), candidate)
            return candidate

    rewritten = RenameItem().visit(ast.fix_missing_locations(ast.parse(ast.unparse(node), mode="eval")))
    ast.fix_missing_locations(rewritten)
    return ast.unparse(rewritten.body) if isinstance(rewritten, ast.Expression) else None


def _numeric_literal_sequence(value: Any) -> bool:
    return isinstance(value, (list, tuple)) and all(
        isinstance(item, (int, float)) and not isinstance(item, bool)
        for item in value
    )


def _portable_sequence_iterable(
    node: ast.AST,
    known_literals: dict[str, Any],
    portable_inputs: set[str] | None = None,
) -> tuple[dict[str, str], dict[str, Any]] | None:
    """Return a sequence-node input only when numeric-list semantics are proven."""
    if isinstance(node, ast.Name):
        value = known_literals.get(node.id, ...)
        if value is ...:
            if portable_inputs and node.id in portable_inputs:
                return {"notebookInputBindingsJson": json.dumps({"input": node.id}, ensure_ascii=False)}, {"uses": [node.id]}
            return None
        if not _numeric_literal_sequence(value):
            return None
        return {"notebookInputBindingsJson": json.dumps({"input": node.id}, ensure_ascii=False)}, {"uses": [node.id]}
    if isinstance(node, ast.List):
        try:
            value = ast.literal_eval(node)
        except (ValueError, TypeError):
            return None
        if not _numeric_literal_sequence(value):
            return None
        return {"notebookLiteralInputsJson": json.dumps({"input": list(value)}, ensure_ascii=False)}, {"uses": []}
    return None


def _loop_update_method(statement: ast.stmt, accumulator: str, item_name: str) -> str | None:
    """Recognize identity-based ``sum``/``product`` scalar loop updates."""
    if isinstance(statement, ast.AugAssign):
        if not isinstance(statement.target, ast.Name) or statement.target.id != accumulator:
            return None
        if not isinstance(statement.value, ast.Name) or statement.value.id != item_name:
            return None
        if isinstance(statement.op, ast.Add):
            return "sum"
        if isinstance(statement.op, ast.Mult):
            return "product"
        return None
    if not isinstance(statement, ast.Assign) or len(statement.targets) != 1:
        return None
    if not isinstance(statement.targets[0], ast.Name) or statement.targets[0].id != accumulator:
        return None
    value = statement.value
    if not isinstance(value, ast.BinOp) or not isinstance(value.op, (ast.Add, ast.Mult)):
        return None
    pairs = ((value.left, value.right), (value.right, value.left))
    if not any(
        isinstance(left, ast.Name) and left.id == accumulator
        and isinstance(right, ast.Name) and right.id == item_name
        for left, right in pairs
    ):
        return None
    return "sum" if isinstance(value.op, ast.Add) else "product"


def _while_update_expression(statement: ast.While) -> tuple[str, ast.AST] | None:
    """Return the single scalar state update carried by a strict numeric while."""
    if statement.orelse or len(statement.body) != 1:
        return None
    update = statement.body[0]
    if isinstance(update, ast.Assign) and len(update.targets) == 1 and isinstance(update.targets[0], ast.Name):
        return update.targets[0].id, update.value
    if isinstance(update, ast.AugAssign) and isinstance(update.target, ast.Name) and isinstance(
        update.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow)
    ):
        return update.target.id, ast.BinOp(
            left=ast.Name(id=update.target.id, ctx=ast.Load()),
            op=update.op,
            right=update.value,
        )
    return None


def _prove_numeric_while_termination(
    start: int | float,
    condition: str,
    update: str,
) -> tuple[int, float] | None:
    """Simulate the exact guarded-expression runtime and prove finite termination."""
    from .engine_parts.analysis_nodes import _logic_expression

    current = float(start)
    try:
        for iteration in range(10_001):
            if not bool(_logic_expression(condition, current, iteration)):
                return iteration, current
            if iteration == 10_000:
                return None
            next_value = _logic_expression(update, current, iteration)
            if isinstance(next_value, bool):
                return None
            current = float(next_value)
            if current != current or current in {float("inf"), float("-inf")}:
                return None
    except (ArithmeticError, OverflowError, ValueError, TypeError):
        return None
    return None


def _analyze_numeric_while(
    statement: ast.stmt,
    base: dict[str, Any],
    known_literals: dict[str, Any],
) -> dict[str, Any] | None:
    """Lower only a one-state while whose finite execution is statically proven."""
    if not isinstance(statement, ast.While):
        return None
    state_update = _while_update_expression(statement)
    if state_update is None:
        return None
    state_name, update_node = state_update
    start = known_literals.get(state_name, ...)
    if start is ... or isinstance(start, bool) or not isinstance(start, (int, float)):
        return None
    try:
        start_number = float(start)
    except (TypeError, ValueError, OverflowError):
        return None
    if start_number != start_number or start_number in {float("inf"), float("-inf")}:
        return None

    condition = _portable_numeric_map_expression(statement.test, state_name)
    update = _portable_numeric_map_expression(update_node, state_name)
    if condition is None or update is None:
        return None
    proof = _prove_numeric_while_termination(start, condition, update)
    if proof is None:
        return None
    iterations, _ = proof
    return {
        **base,
        "recognized": True,
        "semantic": True,
        "kind": "WhileNumber",
        "nodeType": "logic.while_number",
        "label": f"While 数值循环 · {state_name}",
        "parameters": {
            "start": start,
            "condition": condition,
            "update": update,
            "maxIterations": max(1, iterations),
            "notebookOutputPortBindingsJson": json.dumps({state_name: "last"}, ensure_ascii=False),
        },
        "defines": [state_name],
        "uses": [],
        "outputVariable": state_name,
        "reason": f"单状态数值 While 已静态证明在 {iterations} 次迭代后终止",
    }


def _analyze_sequence_loop(
    statement: ast.stmt,
    base: dict[str, Any],
    known_literals: dict[str, Any],
    portable_inputs: set[str] | None = None,
) -> dict[str, Any] | None:
    """Classify strict Python loop idioms as Map / Reduce / Accumulator.

    This pass runs before the generic For Each lowering.  It requires explicit
    identity/empty initializers and a statically known numeric list so the
    produced node has the same Python and JavaScript contract.  Anything less
    certain falls through to generic For Each or the lossless Python carrier.
    """
    if not isinstance(statement, ast.For) or statement.orelse or not isinstance(statement.target, ast.Name):
        return None
    item_name = statement.target.id
    iterable = _portable_sequence_iterable(statement.iter, known_literals, portable_inputs)
    if iterable is None:
        return None
    input_metadata, extra = iterable

    # result = [] ; for item in values: result.append(<portable numeric expr>)
    if len(statement.body) == 1 and isinstance(statement.body[0], ast.Expr):
        call = statement.body[0].value
        if (
            isinstance(call, ast.Call) and not call.keywords and len(call.args) == 1
            and isinstance(call.func, ast.Attribute) and call.func.attr == "append"
            and isinstance(call.func.value, ast.Name)
        ):
            output_name = call.func.value.id
            if known_literals.get(output_name, ...) == []:
                expression = _portable_numeric_map_expression(call.args[0], item_name)
                if expression is not None:
                    return {
                        **base,
                        "recognized": True,
                        "semantic": True,
                        "kind": "ForMap",
                        "nodeType": "sequence.map_expression",
                        "label": f"列表映射 · {output_name}",
                        "parameters": {
                            "expression": expression,
                            "notebookOutputPortBindingsJson": json.dumps({output_name: "output"}, ensure_ascii=False),
                            **input_metadata,
                        },
                        "defines": [output_name],
                        "uses": list(extra.get("uses", [])),
                        "outputVariable": output_name,
                        "reason": "空列表 append 的纯数值逐项变换已安全分类为 Map",
                    }

    # total = 0 ; for item in values: total += item
    if len(statement.body) == 1:
        for accumulator, initial in list(known_literals.items()):
            method = _loop_update_method(statement.body[0], accumulator, item_name)
            identity = 0 if method == "sum" else 1 if method == "product" else None
            if method and initial == identity:
                return {
                    **base,
                    "recognized": True,
                    "semantic": True,
                    "kind": "ForReduce",
                    "nodeType": "sequence.reduce",
                    "label": f"列表归约 · {accumulator}",
                    "parameters": {
                        "method": method,
                        "notebookOutputPortBindingsJson": json.dumps({accumulator: "output"}, ensure_ascii=False),
                        **input_metadata,
                    },
                    "defines": [accumulator],
                    "uses": list(extra.get("uses", [])),
                    "outputVariable": accumulator,
                    "reason": "带标准单位元的标量累加/累乘循环已安全分类为 Reduce",
                }

    # running = [] ; total = 0 ; for item in values:
    #     total += item
    #     running.append(total)
    if len(statement.body) == 2:
        update = statement.body[0]
        append_statement = statement.body[1]
        if isinstance(append_statement, ast.Expr) and isinstance(append_statement.value, ast.Call):
            append_call = append_statement.value
            if (
                not append_call.keywords and len(append_call.args) == 1
                and isinstance(append_call.func, ast.Attribute) and append_call.func.attr == "append"
                and isinstance(append_call.func.value, ast.Name)
                and isinstance(append_call.args[0], ast.Name)
            ):
                history_name = append_call.func.value.id
                accumulator = append_call.args[0].id
                method = _loop_update_method(update, accumulator, item_name)
                identity = 0 if method == "sum" else 1 if method == "product" else None
                if method and known_literals.get(history_name, ...) == [] and known_literals.get(accumulator, ...) == identity:
                    return {
                        **base,
                        "recognized": True,
                        "semantic": True,
                        "kind": "ForAccumulate",
                        "nodeType": "sequence.accumulate",
                        "label": f"列表累计 · {history_name}",
                        "parameters": {
                            "method": method,
                            "notebookOutputPortBindingsJson": json.dumps({history_name: "output", accumulator: "last"}, ensure_ascii=False),
                            **input_metadata,
                        },
                        "defines": [history_name, accumulator],
                        "uses": list(extra.get("uses", [])),
                        "reason": "显式运行总量与历史列表已安全分类为 Accumulator",
                    }
    return None


def _loop_has_carried_state(statements: list[ast.stmt], item_name: str) -> bool:
    """Reject map lowering when an assignment depends on a previous iteration.

    Child AST nodes retain line offsets from the original notebook cell, so this
    analysis intentionally works directly from the AST instead of re-feeding
    ``ast.unparse(statement)`` through source-segment helpers.
    """
    all_definitions: set[str] = set()
    statement_info: list[tuple[set[str], set[str]]] = []
    for statement in statements:
        definitions = {
            node.id for node in ast.walk(statement)
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
        } - {item_name}
        uses = {
            node.id for node in ast.walk(statement)
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
        } - {item_name}
        all_definitions.update(definitions)
        statement_info.append((definitions, uses))
    defined_this_iteration = {item_name}
    for definitions, uses in statement_info:
        if (uses & all_definitions) - defined_this_iteration:
            return True
        if definitions & uses:
            return True
        defined_this_iteration.update(definitions)
    return False




def _children_definitions(children: list[dict[str, Any]]) -> set[str]:
    return {name for child in children for name in child.get("defines", []) if isinstance(name, str) and name}

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
        condition_metadata = _condition_input_metadata(statement.test)
        true_children, true_complete = _branch_children(statement.body, source, "true", user_functions)
        false_children, false_complete = _branch_children(statement.orelse, source, "false", user_functions) if statement.orelse else ([], True)
        true_definitions = _children_definitions(true_children)
        false_definitions = _children_definitions(false_children)
        # A visual If has one selected value output.  Preserve Python variable
        # semantics only when both explicit branches define the same single
        # result (or neither branch defines a result).  Branch-specific names
        # remain Python because they are not guaranteed to exist afterwards.
        branch_outputs_safe = (
            (not true_definitions and not false_definitions)
            or (bool(statement.orelse) and true_definitions == false_definitions and len(true_definitions) == 1)
        )
        if condition_metadata and true_complete and false_complete and branch_outputs_safe and (true_children or false_children):
            condition_params, condition_uses, invert = condition_metadata
            shared_definition = next(iter(true_definitions), "") if true_definitions == false_definitions else ""
            parameters = {
                "invert": invert,
                **condition_params,
                "notebookOutputPortBindingsJson": json.dumps({shared_definition: "done"} if shared_definition else {}, ensure_ascii=False),
            }
            return {
                **base, "recognized": True, "semantic": True, "nodeType": "logic.if_value",
                "label": "If 条件结构",
                "parameters": parameters,
                "defines": [shared_definition] if shared_definition else [],
                "uses": sorted(set([*base.get("uses", []), *condition_uses])),
                "children": [*true_children, *false_children],
                "reason": "简单布尔条件与完整可视分支已安全提升为通用 If 结构",
            }
        return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "label": "If 条件 · 原样执行", "reason": "条件表达式或分支体尚不能证明与通用 If 结构等价，保留原始 Python"}
    if isinstance(statement, ast.For):
        if not isinstance(statement.target, ast.Name) or statement.orelse:
            return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "label": "For 循环 · 原样执行", "reason": "多目标/else For 暂不自动提升"}
        body_has_read = any(
            isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr in {"read_csv", "read_table", "read_json", "read_excel", "read_parquet"}
            for node in ast.walk(statement)
        )
        if body_has_read:
            return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "reason": "多文件扫描循环含文件 I/O 或循环携带状态，保留原始 Python", "label": "多文件扫描 · 原样执行"}
        iterable = _simple_for_iterable(statement.iter)
        body_children, body_complete = _branch_children(statement.body, source, "body", user_functions)
        if iterable and body_complete and body_children and not _loop_has_carried_state(statement.body, statement.target.id):
            input_metadata, extra = iterable
            return {
                **base, "recognized": True, "semantic": True, "nodeType": "logic.for_each_value",
                "label": "For Each 结构",
                "parameters": {
                    "maxIterations": 10000, "itemVariable": statement.target.id,
                    # Python ``for`` does not itself assign the collected list.
                    # Body/target variables are kept in the Notebook namespace;
                    # do not pretend they are equivalent to the node's ``done``.
                    "notebookOutputPortBindingsJson": "{}",
                    **input_metadata,
                },
                "uses": sorted(set([*base.get("uses", []), *extra.get("uses", [])])),
                "children": body_children,
                "reason": "无循环携带状态的 iterable For 已安全提升为通用 For Each 结构",
            }
        return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "label": "For 循环 · 原样执行", "reason": "For 循环包含循环携带状态或无法结构化的语句，保留原始 Python"}
    if isinstance(statement, ast.While):
        return {**base, "recognized": True, "semantic": False, "nodeType": "notebook.code_cell", "label": "While 循环 · 原样执行", "reason": "当前循环状态更新尚不能证明与通用 While State 等价，保留原始 Python"}
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
    # 配置/准备代码：静态 JSON-compatible 值可以由 Workflow Parameters 承载。
    # 这里只标注候选，不在 AST 层擅自上提；Notebook 编译器会结合全局
    # 执行顺序，只提升位于计算步骤之前且尚未被使用的前置配置。
    if target and isinstance(value, (ast.Constant, ast.List, ast.Dict)):
        try:
            literal_value = ast.literal_eval(value)
            encoded = json.dumps(literal_value, ensure_ascii=False)
        except (ValueError, TypeError, OverflowError):
            encoded = ""
        if encoded:
            parameters = {
                **base.get("parameters", {}),
                "notebookParameterName": target,
                "notebookParameterExpression": ast.unparse(value),
                "notebookParameterValueJson": encoded,
            }
            if isinstance(value, ast.Constant) and isinstance(value.value, str) and ("\\" in value.value or "/" in value.value):
                reason = "路径常量：前置静态配置可提升到 Workflow Parameters；跨平台运行时仍需检查路径可用性"
            elif isinstance(value, (ast.List, ast.Dict)):
                reason = "参数列表：前置静态配置可提升到 Workflow Parameters；否则保留原始 Python"
            else:
                reason = "常量赋值：前置静态配置可提升到 Workflow Parameters；否则保留原始 Python"
            return {
                **base, "recognized": True, "semantic": False, "parameters": parameters,
                "label": f"参数 · {target}",
                "reason": reason,
            }
    if isinstance(value, ast.ListComp):
        return {**base, "recognized": False, "reason": "列表推导（参数或文件路径准备，建议用变量节点承载）"}
    if isinstance(value, (ast.List, ast.Tuple, ast.Dict)):
        return {**base, "recognized": False, "reason": "动态参数列表/字典保留原始 Python"}
    if isinstance(value, ast.Constant):
        return {**base, "recognized": False, "reason": "无法安全提升的常量赋值保留原始 Python"}
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
    if not isinstance(call.func, ast.Attribute):
        return {**base, "recognized": False}
    target = _target_name(statement)
    parameter_names = {"sep": "separator", "skiprows": "skipRows", "usecols": "useColumns", "nrows": "nRows", "ascending": "ascending", "by": "columns", "logy": "logY", "logx": "logX", "xlabel": "xLabel", "ylabel": "yLabel", "linestyle": "lineStyle", "marker": "marker", "legend": "legend", "title": "title", "index": "includeIndex", "orient": "orient"}
    parameters = {parameter_names.get(keyword.arg, keyword.arg): _literal(keyword.value) for keyword in call.keywords if keyword.arg and _literal(keyword.value) is not None}
    receiver = call.func.value
    root = _root_name(receiver)
    if isinstance(receiver, ast.Name) and receiver.id in {"pd", "pandas"} and call.func.attr in {"read_csv", "read_table", "read_json"}:
        reader = call.func.attr
        keyword_names = {keyword.arg for keyword in call.keywords if keyword.arg}
        if reader == "read_json":
            # The generic JSON table reader intentionally accepts record-like
            # JSON, but pandas.read_json also interprets column/index-oriented
            # objects. Without knowing the file contents those shapes are not
            # equivalent, so retain the original Python call losslessly.
            return {**base, "recognized": False, "reason": "pandas.read_json 的对象方向语义无法由通用 JSON 表格节点严格等价表示"}

        if reader == "read_table":
            unsupported = keyword_names - {"sep", "header"}
            if unsupported:
                return {**base, "recognized": False, "reason": f"pandas.read_table 参数暂未严格映射：{', '.join(sorted(unsupported))}"}
        else:
            # Only arguments implemented by both native runtimes are eligible
            # for Notebook source lowering. Unknown or Python-only parser
            # options stay executable Python rather than being silently ignored.
            portable_csv_keywords = {
                "sep", "header", "skiprows", "usecols", "nrows",
                "skipinitialspace", "skipfooter", "na_values",
                "keep_default_na", "na_filter", "true_values", "false_values",
                "skip_blank_lines", "thousands", "decimal", "quotechar",
                "doublequote", "escapechar", "comment", "on_bad_lines",
            }
            unsupported = keyword_names - portable_csv_keywords
            if unsupported:
                return {**base, "recognized": False, "reason": f"pandas.read_csv 参数暂未通过 Python/JavaScript 等价验证：{', '.join(sorted(unsupported))}"}

        reader_parameter_names = {
            "sep": "separator", "skiprows": "skipRows", "usecols": "useColumns", "nrows": "nRows",
            "skipinitialspace": "skipInitialSpace", "skipfooter": "skipFooter", "na_values": "naValues",
            "keep_default_na": "keepDefaultNa", "na_filter": "naFilter", "true_values": "trueValues",
            "false_values": "falseValues", "skip_blank_lines": "skipBlankLines", "quotechar": "quoteChar",
            "doublequote": "doubleQuote", "escapechar": "escapeChar", "on_bad_lines": "onBadLines",
        }
        parameters = {
            reader_parameter_names.get(keyword.arg, parameter_names.get(keyword.arg, keyword.arg)): _literal(keyword.value)
            for keyword in call.keywords
            if keyword.arg and keyword.arg != "header" and _literal(keyword.value) is not None
        }
        if call.args and isinstance(call.args[0], (ast.Constant, ast.Name)):
            parameters["originalFileExpression"] = ast.unparse(call.args[0])
        header_keyword = next((keyword for keyword in call.keywords if keyword.arg == "header"), None)
        if reader == "read_csv":
            # pandas.read_csv defaults to header='infer', while the palette node
            # intentionally defaults to no header for raw ad-hoc data. Imported
            # Notebook code must preserve pandas semantics explicitly.
            if header_keyword is None:
                parameters["header"] = "infer"
            else:
                header_value = _literal(header_keyword.value)
                if header_value not in {None, "infer", 0, 1}:
                    return {**base, "recognized": False, "reason": "pandas.read_csv 当前仅严格支持 header=None/'infer'/0/1"}
                parameters["header"] = "none" if header_value is None else header_value
            node_type = "io.read_csv"
        else:
            parameters.setdefault("separator", "\t")
            if header_keyword is None:
                parameters["header"] = True
            else:
                header_value = _literal(header_keyword.value)
                if header_value not in {None, "infer", 0}:
                    return {**base, "recognized": False, "reason": "pandas.read_table 当前仅严格支持 header=None/'infer'/0"}
                parameters["header"] = header_value is not None
            node_type = "io.read_table"
        parameters["platformInput"] = True
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
    literal_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return {"recognized": False, "reason": f"syntax: {error.msg}", "defines": [], "uses": [], "operations": []}
    if (not tree.body and source.strip()) or (tree.body and all(
        isinstance(statement, ast.Expr)
        and isinstance(statement.value, ast.Constant)
        and isinstance(statement.value.value, str)
        for statement in tree.body
    )):
        return {
            "recognized": True,
            "semantic": False,
            "kind": "AnnotationOnly",
            "label": "说明文本",
            "defines": [],
            "uses": [],
            "operations": [],
            "reason": "仅包含说明文本，不生成执行节点",
        }
    assignment_values: dict[str, Any] = dict(literal_context or {})
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name):
            value = _literal(statement.value)
            if value is not None: assignment_values[statement.targets[0].id] = value
    pulse = _detect_oscillating_pulse(tree, assignment_values, source)
    if pulse is not None:
        return pulse
    operations = []
    function_context = user_functions if user_functions is not None else {}
    known_literals: dict[str, Any] = dict(literal_context or {})
    for index, statement in enumerate(tree.body):
        # _analyze_statement walks only this statement, while retaining its exact source fragment.
        function_id = None
        if isinstance(statement, ast.FunctionDef):
            function_id = f"notebook-fn-{cell_index + 1}-{index + 1}-{_identifier_slug(statement.name)}"
        base = _statement_base(statement, source)
        operation = _analyze_numeric_while(statement, base, known_literals)
        if operation is None:
            operation = _analyze_sequence_loop(statement, base, known_literals)
        if operation is None:
            operation = _analyze_statement(statement, source, function_context, function_id)
        operation["index"] = index
        operations.append(operation)
        if isinstance(statement, ast.FunctionDef):
            compiled = _compile_workflow_function(statement, source, function_id or f"notebook-fn-{_identifier_slug(statement.name)}")
            if compiled is not None:
                function_context[statement.name] = compiled

        definitions = {
            node.id for node in ast.walk(statement)
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
        }
        for definition in definitions:
            known_literals.pop(definition, None)
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name):
            value = _literal(statement.value)
            if value is not None:
                known_literals[statement.targets[0].id] = value
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
    literal_context: dict[str, Any] = {}
    for index, cell in enumerate(cells):
        source = cell.get("source", "")
        if isinstance(source, list): source = "".join(source)
        if cell.get("cell_type") == "code":
            text = str(source)
            analyses.append({**analyze_python_cell(text, user_functions, index, literal_context), "index": index})
            try:
                tree = ast.parse(text)
            except SyntaxError:
                tree = None
            if tree is not None:
                for statement in tree.body:
                    definitions = {
                        node.id for node in ast.walk(statement)
                        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
                    }
                    for definition in definitions:
                        literal_context.pop(definition, None)
                    if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name):
                        value = _literal(statement.value)
                        if value is not None:
                            literal_context[statement.targets[0].id] = value
        else:
            analyses.append({"index": index, "recognized": False, "reason": "markdown", "defines": [], "uses": []})
    return json.dumps({"cells": analyses}, ensure_ascii=False)
