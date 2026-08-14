"""Convert a directory of Jupyter notebooks into default-node workflow JSON files.

The converter intentionally emits only executable, built-in PyDroid Flow nodes.
Unsupported source is listed in conversion-report.json instead of being hidden in
a generic code-cell node. This makes every generated workflow inspectable.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from collections import Counter
from pathlib import Path
from typing import Any


def load_analyzer(repo_root: Path):
    spec = importlib.util.spec_from_file_location("pydroid_notebook_import", repo_root / "python" / "pydroid_flow" / "notebook.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load notebook analyzer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.analyze_python_cell


def text(value: Any) -> str:
    return "".join(value) if isinstance(value, list) else str(value or "")


def convert_notebook(path: Path, source_root: Path, analyze_python_cell) -> tuple[dict[str, Any], list[dict[str, str]]]:
    notebook = json.loads(path.read_text(encoding="utf-8-sig"))
    nodes: list[dict[str, Any]] = []
    operations: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for cell_index, cell in enumerate(notebook.get("cells", [])):
        if cell.get("cell_type") != "code":
            continue
        source = text(cell.get("source"))
        analysis = analyze_python_cell(source)
        if not analysis.get("recognized"):
            skipped.append({"cell": str(cell_index + 1), "reason": str(analysis.get("reason", "syntax error"))})
            continue
        for operation in analysis.get("operations", []):
            node_type = str(operation.get("nodeType", ""))
            if operation.get("semantic") and node_type and not node_type.startswith("notebook.") and node_type != "custom.python_function":
                operations.append({**operation, "cellIndex": cell_index})
            elif operation.get("source", "").strip() and operation.get("kind") not in {"Import", "ImportFrom"}:
                skipped.append({"cell": str(cell_index + 1), "reason": str(operation.get("reason", "未映射为默认节点"))})

    defined_by: dict[str, str] = {}
    edges: list[dict[str, str]] = []
    for index, operation in enumerate(operations, 1):
        node_id = f"step-{index}"
        nodes.append({
            "id": node_id,
            "type": "workflow",
            "position": {"x": 70 + ((index - 1) % 4) * 260, "y": 65 + ((index - 1) // 4) * 150},
            "data": {
                "label": operation.get("label") or operation["nodeType"],
                "nodeType": operation["nodeType"],
                "nodeVersion": 1,
                "parameters": operation.get("parameters") or {},
                "status": "idle",
            },
        })
        names = []
        if operation.get("inputVariable"):
            names.append(str(operation["inputVariable"]))
        names.extend(str(name) for name in operation.get("uses", []) if str(name) in defined_by)
        seen: set[str] = set()
        for dependency in names:
            source = defined_by.get(dependency)
            if not source or source in seen:
                continue
            seen.add(source)
            target_handle = "input"
            if operation["nodeType"] == "table.concat":
                target_handle = "left" if len(seen) == 1 else "right"
                if len(seen) > 2:
                    continue
            edges.append({"id": f"edge-{len(edges) + 1}", "source": source, "sourceHandle": "output", "target": node_id, "targetHandle": target_handle})
        for name in operation.get("defines", []):
            defined_by[str(name)] = node_id
        if operation.get("outputVariable"):
            defined_by[str(operation["outputVariable"])] = node_id

    relative = path.relative_to(source_root)
    workflow = {"schemaVersion": 1, "name": relative.stem, "nodes": nodes, "edges": edges}
    return workflow, skipped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if not args.source.is_dir():
        raise SystemExit(f"Source directory not found: {args.source}")
    if args.output.exists() and any(args.output.iterdir()) and not args.overwrite:
        raise SystemExit(f"Output directory is not empty: {args.output}. Refusing to overwrite it.")
    args.output.mkdir(parents=True, exist_ok=True)
    analyze_python_cell = load_analyzer(Path(__file__).resolve().parents[1])
    report: list[dict[str, Any]] = []
    node_counts: Counter[str] = Counter()
    for notebook_path in sorted(args.source.rglob("*.ipynb")):
        workflow, skipped = convert_notebook(notebook_path, args.source, analyze_python_cell)
        output = args.output / notebook_path.relative_to(args.source).with_suffix(".workflow.json")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        node_counts.update(node["data"]["nodeType"] for node in workflow["nodes"])
        report.append({"source": str(notebook_path.relative_to(args.source)), "workflow": str(output.relative_to(args.output)), "nodes": len(workflow["nodes"]), "skipped": len(skipped), "unmapped": skipped})
    (args.output / "conversion-report.json").write_text(json.dumps({"notebooks": report, "nodeCounts": node_counts}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Converted {len(report)} notebooks to {args.output}")
    print("Built-in nodes:", dict(node_counts))
    print("Unmapped statements:", sum(item["skipped"] for item in report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
