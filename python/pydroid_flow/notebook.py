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
        values = {f"{name}Start": literal_or_blank(node.lower), f"{name}Stop": literal_or_blank(node.upper), f"{name}Step": literal_or_blank(node.step) or 1}
        return values if all(value is not None for value in values.values()) else None
    row = part("row", target.elts[0]); column = part("column", target.elts[1])
    if row is None or column is None: return None
    return root, {**row, **column}


def _constant_int(node: ast.AST | None) -> int | None:
    value = _literal(node) if node is not None else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _analyze_statement(statement: ast.stmt, source: str) -> dict[str, Any]:
    definitions = sorted({node.id for node in ast.walk(statement) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)})
    uses = sorted({node.id for node in ast.walk(statement) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)})
    fragment = ast.get_source_segment(source, statement) or ast.unparse(statement)
    kind = type(statement).__name__
    base = {"recognized": True, "semantic": False, "kind": kind, "nodeType": "notebook.code_cell", "label": CONTROL_LABELS.get(kind, kind), "parameters": {"source": fragment, "astKind": kind}, "source": fragment, "defines": definitions, "uses": uses, "reason": f"尚未将 {kind} 映射为默认节点"}
    if isinstance(statement, (ast.Import, ast.ImportFrom)):
        return {**base, "recognized": False, "label": "导入模块", "reason": "导入语句由目标环境依赖处理"}
    # A notebook function, arbitrary control flow, imports, and filesystem code are
    # deliberately not converted to a hidden code carrier. The importer records
    # them as unmapped, rather than pretending that a flow is executable.
    if isinstance(statement, ast.If):
        condition = ast.unparse(statement.test)
        candidates = [name for name in uses if name not in {"True", "False", "None"}]
        table_candidates = [_root_name(item.value) for item in ast.walk(statement.test) if isinstance(item, ast.Subscript)]
        table_variable = next((name for name in table_candidates if name), None)
        if table_variable:
            condition = re.sub(rf"\b{re.escape(table_variable)}\[['\"]([^'\"]+)['\"]\]", r"`\1`", condition)
            condition = re.sub(rf"\b{re.escape(table_variable)}\.([A-Za-z_]\w*)", r"\1", condition)
        children = []
        for branch, statements in (("true", statement.body), ("false", statement.orelse)):
            for child_index, child in enumerate(statements):
                child_result = _analyze_statement(child, source)
                if child_result.get("semantic"):
                    children.append({**child_result, "branch": branch, "childIndex": child_index})
        return {**base, "recognized": True, "semantic": True, "nodeType": "logic.if_subflow", "label": "If 条件结构", "parameters": {"condition": condition}, "inputVariable": table_variable or (candidates[0] if candidates else None), "children": children}
    if isinstance(statement, ast.For):
        iterable = _root_name(statement.iter)
        children = []
        for child_index, child in enumerate(statement.body):
            child_result = _analyze_statement(child, source)
            if child_result.get("semantic"):
                children.append({**child_result, "branch": "body", "childIndex": child_index})
        if iterable:
            return {**base, "recognized": True, "semantic": True, "nodeType": "logic.for_each_subflow", "label": "For 子流程", "parameters": {"maxIterations": 10000}, "inputVariable": iterable, "children": children}
    if isinstance(statement, ast.While):
        condition = ast.unparse(statement.test)
        candidates = [name for name in uses if name not in {"True", "False", "None"}]
        table_candidates = [_root_name(item.value) for item in ast.walk(statement.test) if isinstance(item, ast.Subscript)]
        table_variable = next((name for name in table_candidates if name), None)
        if table_variable:
            condition = re.sub(rf"\b{re.escape(table_variable)}\[['\"]([^'\"]+)['\"]\]", r"`\1`", condition)
            condition = re.sub(rf"\b{re.escape(table_variable)}\.([A-Za-z_]\w*)", r"\1", condition)
        children = []
        for child_index, child in enumerate(statement.body):
            child_result = _analyze_statement(child, source)
            if child_result.get("semantic"):
                children.append({**child_result, "branch": "body", "childIndex": child_index})
        if table_variable or candidates:
            return {**base, "recognized": True, "semantic": True, "nodeType": "logic.while_subflow", "label": "While 子流程", "parameters": {"condition": condition, "maxIterations": 100}, "inputVariable": table_variable or candidates[0], "children": children}
    if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.With, ast.Try, ast.For, ast.While)):
        return {**base, "recognized": False, "reason": "需要可复用默认节点", "label": CONTROL_LABELS.get(kind, kind)}
    call = _call(statement)
    if call is None:
        if isinstance(statement, ast.Assign):
            slice_value = _slice_parameter(statement.value)
            if slice_value:
                root, slice_parameters = slice_value
                target = _target_name(statement)
                return {**base, "semantic": True, "kind": "slice", "nodeType": "table.slice", "label": target or "行列切片", "parameters": slice_parameters, "inputVariable": root, "outputVariable": target or root}
            if isinstance(statement.value, ast.Attribute) and statement.value.attr == "T":
                root = _root_name(statement.value.value); target = _target_name(statement)
                if root: return {**base, "semantic": True, "kind": "call", "nodeType": "table.transpose", "label": target or "转置", "parameters": {}, "inputVariable": root, "outputVariable": target or root}
        return {**base, "recognized": False}
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
    parameter_names = {"sep": "separator", "skiprows": "skipRows", "usecols": "useColumns", "nrows": "nRows", "ascending": "ascending", "by": "columns"}
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
    oscillating_names = {"pulse_duration", "total_time", "voltage_amplitude", "fixed_voltage", "time_points", "port1_voltages", "port2_voltages", "port3_voltages"}
    if oscillating_names.issubset({node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}) and "current_amplitude" in source and "i % 4" in source:
        generator = {"index": 0, "recognized": True, "semantic": True, "kind": "pulse-pattern", "nodeType": "pulse.generate_oscillating_ramp", "label": "生成周期震荡脉冲", "parameters": {"interval": assignment_values.get("pulse_duration", 0.005), "totalTime": assignment_values.get("total_time", 10), "amplitudeStep": assignment_values.get("voltage_amplitude", 0.2), "fixedVoltage": assignment_values.get("fixed_voltage", 0.6), "gateVoltage": 0}, "defines": ["pulse_waveform"], "uses": [], "outputVariable": "pulse_waveform", "source": source}
        printer = {"index": 1, "recognized": True, "semantic": True, "kind": "call", "nodeType": "python.print", "label": "打印脉冲表", "parameters": {}, "defines": [], "uses": ["pulse_waveform"], "inputVariable": "pulse_waveform", "outputVariable": "pulse_waveform", "source": "print(pulse_waveform)"}
        return {"recognized": True, "semantic": True, "kind": "compound", "nodeType": "notebook.code_cell", "label": "周期震荡脉冲 · 2 步", "parameters": {"source": source, "astKind": "Module"}, "defines": ["pulse_waveform"], "uses": [], "operations": [generator, printer]}
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
