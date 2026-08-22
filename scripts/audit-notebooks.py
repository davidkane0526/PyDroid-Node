from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
import sys
import warnings

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from pydroid_flow.notebook import analyze_notebook_json

warnings.filterwarnings("ignore", category=SyntaxWarning)


PYTHON_STDLIB_ROOTS = {
    "abc", "argparse", "array", "ast", "asyncio", "base64", "builtins", "collections", "contextlib", "copy", "csv", "datetime",
    "decimal", "enum", "filecmp", "functools", "glob", "hashlib", "heapq", "inspect", "io", "itertools", "json", "logging", "math", "operator",
    "os", "pathlib", "pickle", "random", "re", "shutil", "statistics", "string", "subprocess", "sys", "tempfile", "textwrap", "time",
    "traceback", "typing", "uuid", "warnings", "zipfile",
}
ANDROID_PYTHON_PACKAGE_ROOTS = {"numpy", "pandas", "matplotlib"}


def source_text(cell: dict) -> str:
    source = cell.get("source", "")
    return "".join(source) if isinstance(source, list) else str(source)


def _single_line_annotation(cell: dict) -> str | None:
    lines = [line.strip() for line in source_text(cell).splitlines() if line.strip()]
    if len(lines) != 1:
        return None
    line = lines[0]
    if cell.get("cell_type") == "code" and line.startswith("#") and not line.startswith("# %%"):
        return line
    if cell.get("cell_type") == "markdown" and re.match(r"^#{1,6}\s+\S", line):
        return "# " + re.sub(r"^#{1,6}\s+", "", line)
    return None


def normalize_notebook(notebook: dict) -> tuple[dict, int, int]:
    original = list(notebook.get("cells", []))
    non_blank = [cell for cell in original if isinstance(cell, dict) and source_text(cell).strip()]
    output: list[dict] = []
    merged = 0
    index = 0
    while index < len(non_blank):
        annotations: list[tuple[dict, str]] = []
        cursor = index
        while cursor < len(non_blank):
            annotation = _single_line_annotation(non_blank[cursor])
            if not annotation:
                break
            annotations.append((non_blank[cursor], annotation))
            cursor += 1
        next_cell = non_blank[cursor] if cursor < len(non_blank) else None
        if annotations and isinstance(next_cell, dict) and next_cell.get("cell_type") == "code":
            merged_cell = dict(next_cell)
            merged_cell["source"] = "\n".join(annotation for _, annotation in annotations) + "\n" + source_text(next_cell).lstrip("\n")
            output.append(merged_cell)
            merged += len(annotations)
            index = cursor + 1
            continue
        if annotations:
            output.extend(cell for cell, _ in annotations)
            index = cursor
            continue
        output.append(non_blank[index])
        index += 1
    normalized = dict(notebook)
    normalized["cells"] = output
    return normalized, len(original) - len(non_blank), merged


def call_name(call: ast.Call) -> str:
    try:
        return ast.unparse(call.func)
    except Exception:
        return type(call.func).__name__


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit PyDroid Flow Notebook -> Workflow compiler coverage for a directory of .ipynb files")
    parser.add_argument("root", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    files = sorted(args.root.rglob("*.ipynb"))
    summary = Counter()
    classifications = Counter()
    statements = Counter()
    calls = Counter()
    function_calls = Counter()
    function_maps = Counter()
    function_output_types = Counter()
    imported_modules = Counter()
    android_unsupported_modules = Counter()
    failures: list[dict[str, object]] = []
    isolated_kinds = Counter()
    control_scopes = Counter()
    control_lowerings = Counter()
    control_carriers = Counter()
    for path in files:
        try:
            notebook = json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:
            failures.append({"file": str(path), "kind": "notebook-read", "error": str(error)})
            continue
        summary["files"] += 1
        notebook, removed_blank, merged_annotations = normalize_notebook(notebook)
        summary["removed_blank_cells"] += removed_blank
        summary["merged_annotation_cells"] += merged_annotations
        normalized = json.dumps(notebook, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        reparsed = json.dumps(json.loads(normalized), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if hashlib.sha256(normalized.encode()).hexdigest() != hashlib.sha256(reparsed.encode()).hexdigest():
            failures.append({"file": str(path), "kind": "json-roundtrip", "error": "normalized notebook changed"})
        try:
            analysis_cells = json.loads(analyze_notebook_json(json.dumps(notebook, ensure_ascii=False))).get("cells", [])
        except Exception as error:
            failures.append({"file": str(path), "kind": "analysis", "error": str(error)})
            continue
        by_index = {int(cell.get("index", -1)): cell for cell in analysis_cells if isinstance(cell, dict)}
        ordered_operations: list[dict[str, object]] = []
        ordered_entries: list[tuple[int, int, dict[str, object]]] = []
        cell_operation_counts: dict[int, int] = {}
        for index, cell in enumerate(notebook.get("cells", [])):
            summary["cells"] += 1
            if cell.get("cell_type") != "code":
                summary["non_code_cells"] += 1
                continue
            summary["code_cells"] += 1
            meaningful_lines = [line.strip() for line in source_text(cell).splitlines() if line.strip()]
            if meaningful_lines and all(line.startswith("#") for line in meaningful_lines):
                summary["comment_only_code_cells"] += 1
            source = source_text(cell)
            result = by_index.get(index, {})
            operations = result.get("operations", []) if isinstance(result, dict) else []
            valid_operations = [operation for operation in operations if isinstance(operation, dict)]
            ordered_operations.extend(valid_operations)
            cell_operation_counts[index] = len(valid_operations)
            ordered_entries.extend((index, operation_index * 1000, operation) for operation_index, operation in enumerate(valid_operations))
            summary["operations"] += len(operations)
            for operation in operations:
                semantic = bool(operation.get("semantic"))
                summary["semantic_operations" if semantic else "carrier_operations"] += 1
                node_type = str(operation.get("nodeType") or "unclassified")
                classifications[node_type] += 1
                if operation.get("kind") == "FunctionDef":
                    summary["function_definitions"] += 1
                    if operation.get("parameters", {}).get("workflowFunctionId"):
                        summary["promotable_function_definitions"] += 1
                        try:
                            output_types = json.loads(operation.get("parameters", {}).get("workflowFunctionOutputTypesJson", "[]"))
                        except (TypeError, ValueError):
                            output_types = []
                        if isinstance(output_types, list) and output_types:
                            signature = ",".join(str(item) for item in output_types)
                            function_output_types[signature] += 1
                            if any(str(item) != "any" for item in output_types):
                                summary["typed_function_definitions"] += 1
                if node_type == "function.call" and semantic:
                    summary["promoted_function_calls"] += 1
                    function_calls[str(operation.get("label") or "function.call")] += 1
                if node_type == "function.map" and semantic:
                    summary["promoted_function_maps"] += 1
                    function_maps[str(operation.get("label") or "function.map")] += 1
                if semantic and node_type in {
                    "logic.if_value", "logic.for_each_value", "logic.while_state", "logic.while_number",
                    "sequence.map_expression", "sequence.reduce", "sequence.accumulate",
                }:
                    control_lowerings[node_type] += 1
                if not semantic and operation.get("kind") in {"If", "For", "While"}:
                    control_carriers[str(operation.get("kind"))] += 1
            if result.get("recognized"):
                summary["recognized_cells"] += 1
            else:
                summary["carrier_only_cells"] += 1
            try:
                tree = ast.parse(source)
                cell_modules: set[str] = set()
                for statement in tree.body:
                    statements[type(statement).__name__] += 1

                class ControlScopeVisitor(ast.NodeVisitor):
                    def __init__(self) -> None:
                        self.function_depth = 0

                    def _record(self, node: ast.AST) -> None:
                        scope = "function" if self.function_depth else "topLevel"
                        control_scopes[f"{scope}.{type(node).__name__}"] += 1

                    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
                        self.function_depth += 1
                        for child in node.body:
                            self.visit(child)
                        self.function_depth -= 1

                    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
                        self.function_depth += 1
                        for child in node.body:
                            self.visit(child)
                        self.function_depth -= 1

                    def visit_If(self, node: ast.If) -> None:  # noqa: N802
                        self._record(node)
                        self.generic_visit(node)

                    def visit_For(self, node: ast.For) -> None:  # noqa: N802
                        self._record(node)
                        self.generic_visit(node)

                    def visit_While(self, node: ast.While) -> None:  # noqa: N802
                        self._record(node)
                        self.generic_visit(node)

                ControlScopeVisitor().visit(tree)
                for node in ast.walk(tree):
                    if isinstance(node, ast.Call):
                        calls[call_name(node)] += 1
                    elif isinstance(node, ast.Import):
                        cell_modules.update(alias.name.split(".", 1)[0] for alias in node.names)
                    elif isinstance(node, ast.ImportFrom) and node.module:
                        cell_modules.add(node.module.split(".", 1)[0])
                for module in cell_modules:
                    imported_modules[module] += 1
                    if module not in PYTHON_STDLIB_ROOTS and module not in ANDROID_PYTHON_PACKAGE_ROOTS:
                        android_unsupported_modules[module] += 1
                if any(isinstance(node, ast.Constant) and isinstance(node.value, str) and (
                    (len(node.value) >= 3 and node.value[0].isalpha() and node.value[1:3] == ":\\")
                    or node.value.startswith("\\\\")
                ) for node in ast.walk(tree)):
                    summary["windows_path_cells"] += 1
            except SyntaxError as error:
                summary["syntax_cells"] += 1
                failures.append({"file": str(path), "cell": index, "kind": "syntax", "error": error.msg})

        setup_open = True
        context_keys: set[tuple[int, int]] = set()
        context_cells: Counter[int] = Counter()
        for cell_index, operation_index, operation in ordered_entries:
            parameters = operation.get("parameters") if isinstance(operation.get("parameters"), dict) else {}
            kind = operation.get("kind")
            if kind in {"Import", "ImportFrom"}:
                summary["managed_environment_imports"] += 1
                context_keys.add((cell_index, operation_index))
                context_cells[cell_index] += 1
                continue
            if not setup_open:
                continue
            if isinstance(parameters.get("notebookParameterName"), str) and isinstance(parameters.get("notebookParameterValueJson"), str):
                summary["managed_workflow_parameters"] += 1
            elif kind == "FunctionDef" and isinstance(parameters.get("workflowFunctionId"), str):
                summary["managed_workflow_definitions"] += 1
            else:
                setup_open = False
                continue
            context_keys.add((cell_index, operation_index))
            context_cells[cell_index] += 1
        summary["managed_context_operations"] += len(context_keys)
        summary["canvas_operations_after_context"] += max(0, len(ordered_operations) - len(context_keys))
        summary["context_only_code_cells"] += sum(
            1 for cell_index, count in context_cells.items()
            if count > 0 and count == cell_operation_counts.get(cell_index, 0)
        )

        producer: dict[str, int] = {}
        function_definition_by_id: dict[str, int] = {}
        linked: set[int] = set()
        for operation_index, operation in enumerate(ordered_operations):
            dependencies = {str(name) for name in [operation.get("inputVariable"), *(operation.get("uses") or [])] if isinstance(name, str) and name}
            for dependency in dependencies:
                source_index = producer.get(dependency)
                if source_index is not None and source_index != operation_index:
                    linked.update((source_index, operation_index))
                    summary["dependency_links"] += 1
            parameters = operation.get("parameters") if isinstance(operation.get("parameters"), dict) else {}
            if operation.get("kind") == "FunctionDef":
                raw_dependencies = parameters.get("workflowFunctionDependenciesJson")
                if isinstance(raw_dependencies, str) and raw_dependencies:
                    try:
                        parsed_dependencies = json.loads(raw_dependencies)
                    except (TypeError, ValueError):
                        parsed_dependencies = []
                    if isinstance(parsed_dependencies, list):
                        for dependency in parsed_dependencies:
                            if isinstance(dependency, str) and dependency in producer:
                                linked.update((producer[dependency], operation_index))
                                summary["dependency_links"] += 1
                function_id = parameters.get("workflowFunctionId")
                if isinstance(function_id, str) and function_id:
                    function_definition_by_id[function_id] = operation_index
            source_function_id = parameters.get("functionId")
            if isinstance(source_function_id, str) and source_function_id in function_definition_by_id:
                linked.update((function_definition_by_id[source_function_id], operation_index))
                summary["dependency_links"] += 1
            definitions = {str(name) for name in [*(operation.get("defines") or []), operation.get("outputVariable")] if isinstance(name, str) and name}
            for definition in definitions:
                producer[definition] = operation_index
        summary["linked_operations"] += len(linked)
        summary["isolated_operations"] += max(0, len(ordered_operations) - len(linked))
        for operation_index, operation in enumerate(ordered_operations):
            if operation_index not in linked:
                isolated_kinds[f"{operation.get('nodeType', 'unclassified')}|{operation.get('kind', '')}"] += 1
    summary["classified_operations"] = summary["semantic_operations"] + summary["carrier_operations"]
    summary["lossless_carrier_coverage"] = summary["classified_operations"]
    report = {
        "summary": dict(summary),
        "classifications": classifications.most_common(),
        "promotedFunctionCalls": function_calls.most_common(),
        "promotedFunctionMaps": function_maps.most_common(),
        "functionOutputTypes": function_output_types.most_common(),
        "importedModules": imported_modules.most_common(),
        "androidUnsupportedModules": android_unsupported_modules.most_common(),
        "statements": statements.most_common(),
        "calls": calls.most_common(100),
        "isolatedOperationKinds": isolated_kinds.most_common(),
        "controlScopes": control_scopes.most_common(),
        "controlLowerings": control_lowerings.most_common(),
        "controlCarriers": control_carriers.most_common(),
        "failures": failures,
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
        print("\nClassifications:")
        for name, count in report["classifications"]:
            print(f"{count:5}  {name}")
        print("\nPromoted user-function calls:")
        for name, count in report["promotedFunctionCalls"][:40]:
            print(f"{count:5}  {name}")
        print("\nPromoted user-function maps:")
        for name, count in report["promotedFunctionMaps"][:40]:
            print(f"{count:5}  {name}")
        print("\nAndroid dependencies requiring review:")
        for name, count in report["androidUnsupportedModules"][:40]:
            print(f"{count:5}  {name}")
        print("\nTop calls:")
        for name, count in report["calls"][:40]:
            print(f"{count:5}  {name}")
        if failures:
            print(f"\nFailures: {len(failures)}")
    return 1 if failures or summary["files"] != len(files) else 0


if __name__ == "__main__":
    raise SystemExit(main())
