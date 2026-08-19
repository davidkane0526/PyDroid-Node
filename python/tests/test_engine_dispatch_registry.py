from pydroid_flow.engine_parts.nodes import HANDLERS


def test_domain_handler_node_types_are_disjoint():
    seen: set[str] = set()
    for node_types, _handler in HANDLERS:
        overlap = seen.intersection(node_types)
        assert not overlap, f"node types registered by multiple handlers: {sorted(overlap)}"
        seen.update(node_types)


def test_expected_node_families_are_registered():
    registered = set().union(*(node_types for node_types, _handler in HANDLERS))
    expected = {
        "io.read_csv",
        "generate.random_table",
        "table.select_columns",
        "pandas.describe",
        "logic.while_number",
        "variable.set",
        "analysis.ter_matrix",
        "pulse.generate_waveform",
        "plot.heatmap",
        "convert.json_parse",
        "ui.alert",
        "custom.python_function",
    }
    assert expected <= registered
