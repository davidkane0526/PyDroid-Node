from __future__ import annotations

import ast
import json
import re
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


def _branch_children(statements: list[ast.stmt], source: str, branch: str) -> list[dict[str, Any]]:
    children = []
    for child_index, child in enumerate(statements):
        child_result = _analyze_statement(child, source)
        if child_result.get("semantic"):
            children.append({**child_result, "branch": branch, "childIndex": child_index})
    return children


def _infer_parameter_annotation(name: str, default_node: ast.AST | None) -> ast.AST:
    """根据参数名和默认值启发式推断类型标注节点。"""
    lowered = name.lower()
    if any(token in lowered for token in ("table", "df", "data", "frame")):
        return ast.Constant(value="table")
    if any(token in lowered for token in ("file", "path", "filename")):
        return ast.Name(id="str")
    if any(token in lowered for token in ("config", "params", "options", "settings")):
        return ast.Name(id="dict")
    if default_node is not None:
        default = _literal(default_node)
        if isinstance(default, bool):
            return ast.Name(id="bool")
        if isinstance(default, int) and not isinstance(default, bool):
            return ast.Name(id="int")
        if isinstance(default, float):
            return ast.Name(id="float")
        if isinstance(default, str):
            return ast.Name(id="str")
        if isinstance(default, list):
            return ast.Subscript(value=ast.Name(id="list"), slice=ast.Name(id="int"))
    return ast.Name(id="float")


def _infer_function_annotations(statement: ast.FunctionDef, source: str) -> str | None:
    """给无标注的 def 参数和返回值补启发式标注，返回带标注的函数源码。"""
    fragment = ast.get_source_segment(source, statement) or ast.unparse(statement)
    try:
        tree = ast.parse(fragment)
        fn = tree.body[0] if tree.body and isinstance(tree.body[0], ast.FunctionDef) else None
    except SyntaxError:
        return None
    if fn is None:
        return None
    args = list(fn.args.args)
    defaults = [None] * (len(args) - len(fn.args.defaults)) + list(fn.args.defaults)
    for arg, default in zip(args, defaults):
        if arg.annotation is None:
            arg.annotation = _infer_parameter_annotation(arg.arg, default)
    if fn.returns is None:
        fn.returns = ast.Constant(value="table")
    return ast.unparse(fn)


def _analyze_function_definition(statement: ast.stmt, source: str, base: dict[str, Any]) -> dict[str, Any] | None:
    """识别独立函数为 custom.python_function 节点；无标注时按启发式补全。"""
    if not isinstance(statement, ast.FunctionDef):
        return None
    arguments = statement.args
    if arguments.vararg is not None or arguments.kwarg is not None:
        return None
    parameters = list(arguments.posonlyargs) + list(arguments.args) + list(arguments.kwonlyargs)
    if not parameters:
        return None
    if statement.returns is not None and all(parameter.annotation is not None for parameter in parameters):
        fragment = ast.get_source_segment(source, statement) or ast.unparse(statement)
    else:
        fragment = _infer_function_annotations(statement, source)
        if fragment is None:
            return None
    return {
        **base,
        "recognized": True, "semantic": True, "kind": "FunctionDef",
        "nodeType": "custom.python_function",
        "label": statement.name,
        "parameters": {"code": fragment},
        "defines": [statement.name],
        "uses": [],
    }


def _analyze_control_flow(statement: ast.stmt, source: str, base: dict[str, Any]) -> dict[str, Any] | None:
    """识别导入、If/For/While 及暂不支持的控制结构；非控制流语句返回 None。"""
    if isinstance(statement, (ast.Import, ast.ImportFrom)):
        return {**base, "recognized": False, "label": "导入模块", "reason": "导入语句由目标环境依赖处理"}
    if isinstance(statement, ast.FunctionDef):
        definition = _analyze_function_definition(statement, source, base)
        if definition is not None:
            return definition
        return {**base, "recognized": False, "reason": "函数无法自动转换为自定义节点（含 *args/**kwargs 或无法解析）", "label": "函数定义"}
    if isinstance(statement, ast.If):
        table_variable, condition = _condition_table_variable(statement.test, base["uses"])
        children = _branch_children(statement.body, source, "true") + _branch_children(statement.orelse, source, "false")
        input_variable = table_variable or next((name for name in base["uses"] if name not in {"True", "False", "None"}), None)
        return {**base, "recognized": True, "semantic": True, "nodeType": "logic.if_subflow", "label": "If 条件结构", "parameters": {"condition": condition}, "inputVariable": input_variable, "children": children}
    if isinstance(statement, ast.For):
        iterable = _root_name(statement.iter)
        children = _branch_children(statement.body, source, "body")
        if iterable:
            body_has_read = any(
                isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in {"read_csv", "read_table", "read_json", "read_excel", "read_parquet"}
                for node in ast.walk(statement)
            )
            if body_has_read:
                return {**base, "recognized": False, "reason": "多文件扫描循环（建议改用批量读取节点，运行时传入文件）", "label": "多文件扫描"}
            return {**base, "recognized": True, "semantic": True, "nodeType": "logic.for_each_subflow", "label": "For 子流程", "parameters": {"maxIterations": 10000}, "inputVariable": iterable, "children": children}
    if isinstance(statement, ast.While):
        table_variable, condition = _condition_table_variable(statement.test, base["uses"])
        children = _branch_children(statement.body, source, "body")
        if table_variable or base["uses"]:
            return {**base, "recognized": True, "semantic": True, "nodeType": "logic.while_subflow", "label": "While 子流程", "parameters": {"condition": condition, "maxIterations": 100}, "inputVariable": table_variable or next((name for name in base["uses"] if name not in {"True", "False", "None"}), None), "children": children}
    # A notebook function, arbitrary control flow, imports, and filesystem code are
    # deliberately not converted to a hidden code carrier. The importer records
    # them as unmapped, rather than pretending that a flow is executable.
    if isinstance(statement, (ast.AsyncFunctionDef, ast.With, ast.Try, ast.For, ast.While)):
        return {**base, "recognized": False, "reason": "需要可复用默认节点", "label": CONTROL_LABELS.get(base["kind"], base["kind"])}
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


def _analyze_call(call: ast.Call, statement: ast.stmt, source: str, base: dict[str, Any]) -> dict[str, Any]:
    """把调用语句映射到节点：内置函数、专用函数、pandas/numpy 方法与转换。"""
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


def _analyze_statement(statement: ast.stmt, source: str) -> dict[str, Any]:
    base = _statement_base(statement, source)
    control = _analyze_control_flow(statement, source, base)
    if control is not None:
        return control
    call = _call(statement)
    if call is None:
        if isinstance(statement, ast.Assign):
            assignment = _analyze_assignment(statement, source, base)
            if assignment is not None:
                return assignment
        return {**base, "recognized": False}
    return _analyze_call(call, statement, source, base)


def analyze_python_cell(source: str) -> dict[str, Any]:
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
    for index, statement in enumerate(tree.body):
        # _analyze_statement walks only this statement, while retaining its exact source fragment.
        operation = _analyze_statement(statement, source)
        operation["index"] = index
        operations.append(operation)
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
    for index, cell in enumerate(cells):
        source = cell.get("source", "")
        if isinstance(source, list): source = "".join(source)
        if cell.get("cell_type") == "code":
            analyses.append({"index": index, **analyze_python_cell(str(source))})
        else:
            analyses.append({"index": index, "recognized": False, "reason": "markdown", "defines": [], "uses": []})
    return json.dumps({"cells": analyses}, ensure_ascii=False)
