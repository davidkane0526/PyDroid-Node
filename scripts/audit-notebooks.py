from __future__ import annotations

import argparse
import ast
import hashlib
import json
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
    for path in files:
        try:
            notebook = json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:
            failures.append({"file": str(path), "kind": "notebook-read", "error": str(error)})
            continue
        summary["files"] += 1
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
        for index, cell in enumerate(notebook.get("cells", [])):
            summary["cells"] += 1
            if cell.get("cell_type") != "code":
                summary["non_code_cells"] += 1
                continue
            summary["code_cells"] += 1
            source = source_text(cell)
            result = by_index.get(index, {})
            operations = result.get("operations", []) if isinstance(result, dict) else []
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
                    if operation.get("parameters", {}).get("collectMode") == "concat_columns":
                        summary["promoted_function_concat_maps"] += 1
                    function_maps[str(operation.get("label") or "function.map")] += 1
            if result.get("recognized"):
                summary["recognized_cells"] += 1
            else:
                summary["carrier_only_cells"] += 1
            try:
                tree = ast.parse(source)
                cell_modules: set[str] = set()
                for statement in tree.body:
                    statements[type(statement).__name__] += 1
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
