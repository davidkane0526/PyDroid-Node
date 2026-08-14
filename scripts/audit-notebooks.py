from __future__ import annotations

import argparse
import ast
import json
from collections import Counter
from pathlib import Path
import sys
import hashlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from pydroid_flow.notebook import analyze_python_cell


def source_text(cell: dict) -> str:
    source = cell.get("source", "")
    return "".join(source) if isinstance(source, list) else str(source)


def call_name(call: ast.Call) -> str:
    try:
        return ast.unparse(call.func)
    except Exception:
        return type(call.func).__name__


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit PyDroid Flow AST coverage for a directory of .ipynb files")
    parser.add_argument("root", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    files = sorted(args.root.rglob("*.ipynb"))
    summary = Counter()
    reasons = Counter()
    statements = Counter()
    calls = Counter()
    failures: list[dict[str, object]] = []
    for path in files:
        try:
            notebook = json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:
            failures.append({"file": str(path), "kind": "notebook-read", "error": str(error)})
            continue
        summary["files"] += 1
        # JSON normalization must preserve every notebook-level value before AST conversion.
        normalized = json.dumps(notebook, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if hashlib.sha256(normalized.encode()).hexdigest() != hashlib.sha256(json.dumps(json.loads(normalized), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest():
            failures.append({"file": str(path), "kind": "json-roundtrip", "error": "normalized notebook changed"})
        for index, cell in enumerate(notebook.get("cells", [])):
            summary["cells"] += 1
            if cell.get("cell_type") != "code":
                summary["non_code_cells"] += 1
                continue
            summary["code_cells"] += 1
            source = source_text(cell)
            result = analyze_python_cell(source)
            operations = result.get("operations", [])
            summary["operations"] += len(operations)
            summary["semantic_operations"] += sum(bool(item.get("semantic")) for item in operations)
            summary["carrier_operations"] += sum(not bool(item.get("semantic")) for item in operations)
            if result.get("recognized"):
                summary["semantic_cells"] += 1
                reasons[str(result.get("nodeType"))] += 1
            else:
                summary["carrier_cells"] += 1
                reasons[str(result.get("reason", "unknown"))] += 1
            try:
                tree = ast.parse(source)
                for statement in tree.body:
                    statements[type(statement).__name__] += 1
                for node in ast.walk(tree):
                    if isinstance(node, ast.Call): calls[call_name(node)] += 1
            except SyntaxError as error:
                summary["syntax_cells"] += 1
                failures.append({"file": str(path), "cell": index, "kind": "syntax", "error": error.msg})
    report = {
        "summary": dict(summary), "classifications": reasons.most_common(),
        "statements": statements.most_common(), "calls": calls.most_common(100), "failures": failures,
    }
    summary["classified_operations"] = summary["semantic_operations"] + summary["carrier_operations"]
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
        print("\nClassifications:")
        for name, count in report["classifications"]: print(f"{count:5}  {name}")
        print("\nTop calls:")
        for name, count in report["calls"][:40]: print(f"{count:5}  {name}")
        if failures: print(f"\nFailures: {len(failures)}")
    return 1 if summary["files"] != len(files) else 0


if __name__ == "__main__":
    raise SystemExit(main())
