from backend.workflows import (
    get_topological_execution_layers,
    interpolate_prompt,
    validate_workflow,
)


def test_validate_workflow_valid():
    valid_wf = {
        "name": "Test Flow",
        "nodes": [
            {"id": "n_in", "type": "input"},
            {"id": "n_step", "type": "model_step", "model": "google/gemini-2.5-flash"},
            {"id": "n_out", "type": "output"},
        ],
        "edges": [
            {"source": "n_in", "target": "n_step"},
            {"source": "n_step", "target": "n_out"},
        ],
    }
    is_valid, err = validate_workflow(valid_wf)
    assert is_valid is True
    assert err is None


def test_validate_workflow_cycle_detected():
    cyclic_wf = {
        "name": "Cycle Flow",
        "nodes": [
            {"id": "n_in", "type": "input"},
            {"id": "n1", "type": "model_step", "model": "google/gemini-2.5-flash"},
            {"id": "n2", "type": "model_step", "model": "google/gemini-2.5-flash"},
            {"id": "n_out", "type": "output"},
        ],
        "edges": [
            {"source": "n_in", "target": "n1"},
            {"source": "n1", "target": "n2"},
            {"source": "n2", "target": "n1"},  # cycle!
            {"source": "n2", "target": "n_out"},
        ],
    }
    is_valid, err = validate_workflow(cyclic_wf)
    assert is_valid is False
    assert "cycle" in err.lower()


def test_topological_layers():
    nodes = [
        {"id": "in"},
        {"id": "a"},
        {"id": "b"},
        {"id": "synth"},
        {"id": "out"},
    ]
    edges = [
        {"source": "in", "target": "a"},
        {"source": "in", "target": "b"},
        {"source": "a", "target": "synth"},
        {"source": "b", "target": "synth"},
        {"source": "synth", "target": "out"},
    ]
    layers = get_topological_execution_layers(nodes, edges)
    # Expected layers:
    # Layer 0: in
    # Layer 1: a, b (parallel)
    # Layer 2: synth
    # Layer 3: out
    assert len(layers) == 4
    assert [n["id"] for n in layers[0]] == ["in"]
    assert sorted([n["id"] for n in layers[1]]) == ["a", "b"]
    assert [n["id"] for n in layers[2]] == ["synth"]
    assert [n["id"] for n in layers[3]] == ["out"]


def test_interpolate_prompt():
    template = "Prompt: {input}\nPrevious: {previous}\nDirect: {nodes.n1.output}"
    user_input = "Write a poem"
    predecessors = {"n1": "Draft poem"}
    all_outputs = {"n1": "Draft poem"}
    labels = {"n1": "Draft Step"}

    interpolated = interpolate_prompt(
        template=template,
        user_input=user_input,
        predecessor_outputs=predecessors,
        all_outputs=all_outputs,
        node_labels=labels,
    )
    assert "Write a poem" in interpolated
    assert "Draft poem" in interpolated
    assert "{input}" not in interpolated
    assert "{nodes.n1.output}" not in interpolated
