"""Custom Workflows engine, graph DAG execution, and persistence for LLM Council.

This module provides:
  1. Built-in workflow templates (Sequential Chain Refinement, Parallel Consensus, Code Architect).
  2. Safe atomic persistence for custom workflows in `data/workflows.json`.
  3. DAG graph validation and topological ordering (Kahn's algorithm).
  4. Dynamic prompt variable interpolation ({input}, {previous}, {nodes.<id>.output}).
  5. Asynchronous streaming execution engine querying LLM models and emitting SSE events.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any

from .config import WORKFLOWS_FILE
from .openrouter import calculate_token_cost, query_model
from .skills import skill_manager
from .storage import _safe_write_json

logger = logging.getLogger("llm_council.workflows")

# ==============================================================================
# Built-in Default Workflow Templates
# ==============================================================================

DEFAULT_WORKFLOWS: list[dict[str, Any]] = [
    {
        "id": "chain-refinement",
        "name": "Sequential Chain Refinement",
        "description": "3-stage pipeline: Draft Specialist (Gemini) -> Rigorous Critic (Claude) -> Master Editor (GPT-4o Mini)",
        "is_template": True,
        "nodes": [
            {
                "id": "node_input",
                "type": "input",
                "label": "User Input",
                "model": "",
                "prompt_template": "",
                "position": {"x": 60, "y": 200},
            },
            {
                "id": "node_draft",
                "type": "model_step",
                "label": "Draft Specialist",
                "model": "google/gemini-2.5-flash",
                "prompt_template": (
                    "You are a creative drafting expert. Given the following user request:\n\n"
                    "{input}\n\n"
                    "Produce an initial comprehensive, well-structured, creative solution or draft."
                ),
                "position": {"x": 320, "y": 200},
                "temperature": 0.7,
            },
            {
                "id": "node_critique",
                "type": "model_step",
                "label": "Rigorous Critic",
                "model": "anthropic/claude-3-haiku",
                "prompt_template": (
                    "You are a critical reviewer and fact-checker. Review the following draft produced for the user request.\n\n"
                    "Original Request:\n{input}\n\n"
                    "Initial Draft:\n{previous}\n\n"
                    "Identify weaknesses, omissions, logical flaws, and areas where precision and clarity can be improved."
                ),
                "position": {"x": 600, "y": 200},
                "temperature": 0.5,
            },
            {
                "id": "node_polish",
                "type": "model_step",
                "label": "Master Editor & Synthesizer",
                "model": "openai/gpt-4o-mini",
                "prompt_template": (
                    "You are a master editor and synthesizer. Synthesize the initial draft and the critical review into an authoritative, polished final response.\n\n"
                    "Original Request:\n{input}\n\n"
                    "Draft & Critique:\n{previous}\n\n"
                    "Deliver the final, polished deliverable."
                ),
                "position": {"x": 880, "y": 200},
                "temperature": 0.6,
            },
            {
                "id": "node_output",
                "type": "output",
                "label": "Final Output",
                "model": "",
                "prompt_template": "",
                "position": {"x": 1160, "y": 200},
            },
        ],
        "edges": [
            {
                "id": "e_in_draft",
                "source": "node_input",
                "target": "node_draft",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_draft_critique",
                "source": "node_draft",
                "target": "node_critique",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_critique_polish",
                "source": "node_critique",
                "target": "node_polish",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_polish_out",
                "source": "node_polish",
                "target": "node_output",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
        ],
    },
    {
        "id": "parallel-consensus",
        "name": "Parallel Multi-Perspective Consensus",
        "description": "Forks input to Creative (Gemini) and Analytical (Llama 3.3 70B) in parallel, then reconciles via Consensus Synthesizer (GPT-4o Mini)",
        "is_template": True,
        "nodes": [
            {
                "id": "node_input",
                "type": "input",
                "label": "User Input",
                "model": "",
                "prompt_template": "",
                "position": {"x": 60, "y": 260},
            },
            {
                "id": "node_creative",
                "type": "model_step",
                "label": "Creative Strategist",
                "model": "google/gemini-2.5-flash",
                "prompt_template": (
                    "You are an innovative strategist. Provide an expansive, creative, out-of-the-box solution for:\n\n"
                    "{input}"
                ),
                "position": {"x": 340, "y": 140},
                "temperature": 0.8,
            },
            {
                "id": "node_analytical",
                "type": "model_step",
                "label": "Analytical Pragmatist",
                "model": "meta-llama/llama-3.3-70b-instruct",
                "prompt_template": (
                    "You are a rigorous analyst. Provide a step-by-step, realistic, constraint-focused solution with trade-offs for:\n\n"
                    "{input}"
                ),
                "position": {"x": 340, "y": 380},
                "temperature": 0.4,
            },
            {
                "id": "node_synthesis",
                "type": "synthesis",
                "label": "Consensus Synthesizer",
                "model": "openai/gpt-4o-mini",
                "prompt_template": (
                    "You are the Council Chairperson. Reconcile these two distinct perspectives into an optimal unified strategy:\n\n"
                    "Original Request:\n{input}\n\n"
                    "Perspective 1 (Creative Strategist):\n{nodes.node_creative.output}\n\n"
                    "Perspective 2 (Analytical Pragmatist):\n{nodes.node_analytical.output}\n\n"
                    "Synthesize the strongest points of both into an actionable consensus recommendation."
                ),
                "position": {"x": 680, "y": 260},
                "temperature": 0.5,
            },
            {
                "id": "node_output",
                "type": "output",
                "label": "Final Deliverable",
                "model": "",
                "prompt_template": "",
                "position": {"x": 980, "y": 260},
            },
        ],
        "edges": [
            {
                "id": "e_in_creative",
                "source": "node_input",
                "target": "node_creative",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_in_analytical",
                "source": "node_input",
                "target": "node_analytical",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_creative_synthesis",
                "source": "node_creative",
                "target": "node_synthesis",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_analytical_synthesis",
                "source": "node_analytical",
                "target": "node_synthesis",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_synthesis_out",
                "source": "node_synthesis",
                "target": "node_output",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
        ],
    },
    {
        "id": "code-architect",
        "name": "Code Architecture & Security Review",
        "description": "Architectural Design (Gemini) + Security Review (Claude) -> Production Implementation (GPT-4o Mini)",
        "is_template": True,
        "nodes": [
            {
                "id": "node_input",
                "type": "input",
                "label": "Specification",
                "model": "",
                "prompt_template": "",
                "position": {"x": 60, "y": 260},
            },
            {
                "id": "node_architect",
                "type": "model_step",
                "label": "Software Architect",
                "model": "google/gemini-2.5-flash",
                "prompt_template": (
                    "Design high-level architecture, module boundaries, data structures, and algorithmic approach for:\n\n"
                    "{input}"
                ),
                "position": {"x": 340, "y": 140},
                "temperature": 0.5,
            },
            {
                "id": "node_security",
                "type": "model_step",
                "label": "Security Auditor",
                "model": "anthropic/claude-3-haiku",
                "prompt_template": (
                    "Conduct a threat model and edge-case security audit for this requirement:\n\n"
                    "{input}\n\n"
                    "Highlight input validation risks, concurrency issues, injection attacks, and denial of service vectors."
                ),
                "position": {"x": 340, "y": 380},
                "temperature": 0.3,
            },
            {
                "id": "node_engineer",
                "type": "synthesis",
                "label": "Lead Engineer",
                "model": "openai/gpt-4o-mini",
                "prompt_template": (
                    "Produce complete, production-grade code adhering to the architecture design while mitigating all security threats:\n\n"
                    "Original Specification:\n{input}\n\n"
                    "Architecture Specification:\n{nodes.node_architect.output}\n\n"
                    "Security Findings:\n{nodes.node_security.output}\n\n"
                    "Write clean, idiomatic, fully commented code."
                ),
                "position": {"x": 680, "y": 260},
                "temperature": 0.4,
            },
            {
                "id": "node_output",
                "type": "output",
                "label": "Implementation & Guide",
                "model": "",
                "prompt_template": "",
                "position": {"x": 980, "y": 260},
            },
        ],
        "edges": [
            {
                "id": "e_in_arch",
                "source": "node_input",
                "target": "node_architect",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_in_sec",
                "source": "node_input",
                "target": "node_security",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_arch_eng",
                "source": "node_architect",
                "target": "node_engineer",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_sec_eng",
                "source": "node_security",
                "target": "node_engineer",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
            {
                "id": "e_eng_out",
                "source": "node_engineer",
                "target": "node_output",
                "sourceHandle": "out",
                "targetHandle": "in",
            },
        ],
    },
]


# ==============================================================================
# Persistence & Storage
# ==============================================================================


def load_workflows() -> list[dict[str, Any]]:
    """Load workflows from disk, initializing with default templates if not present.

    Returns:
        list[dict[str, Any]]: List of workflow definitions.
    """
    file_path = WORKFLOWS_FILE
    file_path.parent.mkdir(parents=True, exist_ok=True)

    if not file_path.exists():
        initial = copy.deepcopy(DEFAULT_WORKFLOWS)
        now = datetime.now(timezone.utc).isoformat()
        for wf in initial:
            wf["created_at"] = now
            wf["updated_at"] = now
        _safe_write_json(str(file_path), {"workflows": initial})
        return initial

    try:
        with file_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        workflows = data.get("workflows", [])
        if not isinstance(workflows, list):
            workflows = []

        # Ensure default templates are present in the list if missing
        existing_ids = {wf.get("id") for wf in workflows if isinstance(wf, dict)}
        defaults_to_add = []
        for default_wf in DEFAULT_WORKFLOWS:
            if default_wf["id"] not in existing_ids:
                wf_copy = copy.deepcopy(default_wf)
                now = datetime.now(timezone.utc).isoformat()
                wf_copy["created_at"] = now
                wf_copy["updated_at"] = now
                defaults_to_add.append(wf_copy)

        if defaults_to_add:
            workflows = defaults_to_add + workflows
            _safe_write_json(str(file_path), {"workflows": workflows})

        return workflows
    except Exception as e:
        logger.error("Failed to read %s: %s; returning defaults", file_path, e)
        return copy.deepcopy(DEFAULT_WORKFLOWS)


def get_workflow(workflow_id: str) -> dict[str, Any] | None:
    """Retrieve a specific workflow by its ID.

    Args:
        workflow_id: Unique identifier of the workflow.

    Returns:
        dict[str, Any] or None: Workflow object or None if not found.
    """
    workflows = load_workflows()
    for wf in workflows:
        if wf.get("id") == workflow_id:
            return wf
    return None


def save_workflow(workflow_data: dict[str, Any]) -> dict[str, Any]:
    """Create or update a workflow definition and atomically persist to disk.

    Args:
        workflow_data: Dictionary defining workflow properties, nodes, and edges.

    Returns:
        dict[str, Any]: The saved workflow with updated metadata.

    Raises:
        ValueError: If graph validation fails.
    """
    is_valid, error_msg = validate_workflow(workflow_data)
    if not is_valid:
        raise ValueError(f"Invalid workflow graph: {error_msg}")

    workflows = load_workflows()
    wf_id = workflow_data.get("id")
    now = datetime.now(timezone.utc).isoformat()

    if not wf_id:
        wf_id = f"workflow-{uuid.uuid4().hex[:12]}"
        workflow_data["id"] = wf_id
        workflow_data["created_at"] = now
        workflow_data["is_template"] = False

    workflow_data["updated_at"] = now

    found = False
    for idx, wf in enumerate(workflows):
        if wf.get("id") == wf_id:
            workflows[idx] = workflow_data
            found = True
            break

    if not found:
        workflows.insert(0, workflow_data)

    _safe_write_json(str(WORKFLOWS_FILE), {"workflows": workflows})
    return workflow_data


def delete_workflow(workflow_id: str) -> bool:
    """Delete a custom workflow by ID. Built-in templates cannot be deleted.

    Args:
        workflow_id: Unique identifier of the workflow to delete.

    Returns:
        bool: True if deleted, False if not found or if workflow is a protected template.
    """
    workflows = load_workflows()
    target_idx = None
    for idx, wf in enumerate(workflows):
        if wf.get("id") == workflow_id:
            if wf.get("is_template", False):
                logger.warning(
                    "Attempted to delete protected template workflow: %s", workflow_id
                )
                return False
            target_idx = idx
            break

    if target_idx is not None:
        workflows.pop(target_idx)
        _safe_write_json(str(WORKFLOWS_FILE), {"workflows": workflows})
        return True

    return False


# ==============================================================================
# Graph Validation and Topological Sorting
# ==============================================================================


def validate_workflow(workflow: dict[str, Any]) -> tuple[bool, str | None]:
    """Validate that the workflow graph is a well-formed Directed Acyclic Graph (DAG).

    Verification checks:
      1. Must have a non-empty name.
      2. Must have at least one 'input' node and at least one 'output' node.
      3. All node IDs must be unique strings.
      4. All edges must connect existing node IDs.
      5. Graph must not contain cycles (verified via Kahn's topological sort).

    Args:
        workflow: Workflow dictionary to validate.

    Returns:
        tuple[bool, str | None]: (True, None) if valid, or (False, error_reason).
    """
    if not isinstance(workflow, dict):
        return False, "Workflow payload must be an object."

    name = workflow.get("name", "").strip()
    if not name:
        return False, "Workflow must have a non-empty name."

    nodes = workflow.get("nodes", [])
    if not isinstance(nodes, list) or len(nodes) == 0:
        return False, "Workflow must contain at least one node."

    node_ids: set[str] = set()
    has_input = False
    has_output = False

    for node in nodes:
        if not isinstance(node, dict):
            return False, "Each node must be an object."
        nid = node.get("id")
        if not nid or not isinstance(nid, str):
            return False, "Each node must have a non-empty string ID."
        if nid in node_ids:
            return False, f"Duplicate node ID detected: '{nid}'."
        node_ids.add(nid)

        ntype = node.get("type")
        if ntype == "input":
            has_input = True
        elif ntype == "output":
            has_output = True
        elif ntype in ("model_step", "synthesis", "skill_step"):
            model = node.get("model", "").strip()
            if not model:
                return False, f"Node '{node.get('label') or nid}' must specify a model."

    if not has_input:
        return False, "Workflow must include at least one 'input' node."
    if not has_output:
        return False, "Workflow must include at least one 'output' node."

    edges = workflow.get("edges", [])
    if not isinstance(edges, list):
        return False, "Workflow 'edges' must be a list."

    for edge in edges:
        if not isinstance(edge, dict):
            return False, "Each edge must be an object."
        src = edge.get("source")
        tgt = edge.get("target")
        if src not in node_ids:
            return False, f"Edge references nonexistent source node: '{src}'."
        if tgt not in node_ids:
            return False, f"Edge references nonexistent target node: '{tgt}'."

    # Cycle detection via Kahn's algorithm
    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}
    adj: dict[str, list[str]] = {nid: [] for nid in node_ids}

    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        adj[src].append(tgt)
        in_degree[tgt] += 1

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    visited_count = 0

    while queue:
        curr = queue.pop(0)
        visited_count += 1
        for neighbor in adj[curr]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if visited_count != len(node_ids):
        return False, "Workflow graph contains a cycle or circular dependency."

    return True, None


def get_topological_execution_layers(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> list[list[dict[str, Any]]]:
    """Group nodes into parallel execution layers based on DAG topological dependencies.

    Nodes within the same layer have all their dependencies satisfied and can run
    concurrently in parallel.

    Args:
        nodes: List of node definitions.
        edges: List of directed edge connections.

    Returns:
        list[list[dict[str, Any]]]: Ordered list of node layers.
    """
    node_map = {n["id"]: n for n in nodes}
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}

    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src in node_map and tgt in node_map:
            adj[src].append(tgt)
            in_degree[tgt] += 1

    layers: list[list[dict[str, Any]]] = []
    current_layer = [nid for nid, deg in in_degree.items() if deg == 0]

    while current_layer:
        layers.append([node_map[nid] for nid in current_layer])
        next_layer = []
        for nid in current_layer:
            for neighbor in adj[nid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    next_layer.append(neighbor)
        current_layer = next_layer

    return layers


# ==============================================================================
# Prompt Interpolation
# ==============================================================================


def interpolate_prompt(
    template: str,
    user_input: str,
    predecessor_outputs: dict[str, str],
    all_outputs: dict[str, str],
    node_labels: dict[str, str],
) -> str:
    """Evaluate and interpolate prompt template variables.

    Supported variable expressions:
      - `{input}`: Original user prompt.
      - `{previous}`: Combined outputs from all direct predecessor nodes.
      - `{nodes.<node_id>.output}` or `{node_<id>}`: Specific node's output.
      - `{<Node Label>}`: Output from the node with matching label.

    Args:
        template: The raw prompt template string with placeholders.
        user_input: Original user input text.
        predecessor_outputs: Dict mapping predecessor node ID to its output text.
        all_outputs: Dict mapping any completed node ID to its output text.
        node_labels: Dict mapping node ID to its descriptive label.

    Returns:
        str: Fully interpolated prompt string ready for LLM consumption.
    """
    if not template:
        template = "{previous}\n\n{input}"

    text = template

    # Replace {input}
    text = text.replace("{input}", user_input)

    # Combined predecessor outputs for {previous}
    previous_combined = "\n\n---\n\n".join(
        f"[{node_labels.get(nid, nid)}]:\n{out}"
        for nid, out in predecessor_outputs.items()
        if out
    )
    if not previous_combined and user_input:
        previous_combined = user_input
    text = text.replace("{previous}", previous_combined)

    # Replace specific node references: {nodes.<id>.output} or {nodes.<id>}
    for nid, out in all_outputs.items():
        text = text.replace(f"{{nodes.{nid}.output}}", out)
        text = text.replace(f"{{nodes.{nid}}}", out)
        text = text.replace(f"{{{nid}}}", out)

    # Replace by node labels: {Label}
    label_to_id = {lbl.strip().lower(): nid for nid, lbl in node_labels.items()}
    for pattern in re.findall(r"\{([^}]+)\}", text):
        clean_key = pattern.strip().lower()
        if clean_key in label_to_id:
            matched_nid = label_to_id[clean_key]
            text = text.replace(f"{{{pattern}}}", all_outputs.get(matched_nid, ""))

    return text


# ==============================================================================
# Streaming Execution Engine
# ==============================================================================


async def execute_workflow_stream(
    workflow: dict[str, Any],
    user_input: str,
) -> AsyncGenerator[dict[str, Any], None]:
    """Execute a workflow DAG and yield real-time SSE execution events.

    Events yielded:
      - `workflow_start`: Workflow metadata and node count.
      - `node_start`: Emitted before each node runs.
      - `node_complete`: Emitted after each node finishes with its output and token metrics.
      - `workflow_complete`: Final consolidated output, execution log, and cumulative spend.

    Args:
        workflow: Validated workflow definition dictionary.
        user_input: Raw user input text to process through the graph.

    Yields:
        dict[str, Any]: SSE event dictionary with 'event' and 'data' fields.
    """
    wf_id = workflow.get("id", "workflow")
    wf_name = workflow.get("name", "Custom Workflow")
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])

    node_map: dict[str, dict[str, Any]] = {n["id"]: n for n in nodes}
    node_labels: dict[str, str] = {n["id"]: n.get("label", n["id"]) for n in nodes}

    # Predecessor mapping: target -> list of source node IDs
    predecessors: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src in node_map and tgt in node_map:
            predecessors[tgt].append(src)

    layers = get_topological_execution_layers(nodes, edges)

    yield {
        "event": "workflow_start",
        "data": {
            "workflow_id": wf_id,
            "workflow_name": wf_name,
            "total_nodes": len(nodes),
            "total_layers": len(layers),
        },
    }

    all_node_outputs: dict[str, str] = {}
    node_execution_records: list[dict[str, Any]] = []

    cumulative_tokens: dict[str, Any] = {
        "total_tokens": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "tokens_saved": 0,
        "total_cost": 0.0,
        "total_cost_saved": 0.0,
        "by_model": {},
    }

    async def run_single_node(node: dict[str, Any]) -> dict[str, Any]:
        """Execute one node within the active layer."""
        nid = node["id"]
        ntype = node.get("type", "model_step")
        label = node.get("label", nid)
        model = node.get("model", "")
        template = node.get("prompt_template", "")

        pred_ids = predecessors.get(nid, [])
        pred_outputs = {pid: all_node_outputs.get(pid, "") for pid in pred_ids}

        start_time = datetime.now(timezone.utc).isoformat()

        if ntype == "input":
            output_text = user_input
            usage = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "tokens_saved": 0,
            }
            cost = 0.0
            cost_saved = 0.0
            status = "completed"
            error = None
            evaluated_prompt = ""
        elif ntype == "output":
            # Output node aggregates its predecessors
            if pred_outputs:
                output_text = "\n\n".join(out for out in pred_outputs.values() if out)
            else:
                output_text = user_input
            usage = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "tokens_saved": 0,
            }
            cost = 0.0
            cost_saved = 0.0
            status = "completed"
            error = None
            evaluated_prompt = ""
        else:
            # Model step, Synthesis node, or Skill step
            evaluated_prompt = interpolate_prompt(
                template=template,
                user_input=user_input,
                predecessor_outputs=pred_outputs,
                all_outputs=all_node_outputs,
                node_labels=node_labels,
            )

            # If node is a skill_step, inject domain guidelines and rubric
            if ntype == "skill_step":
                skill_id = node.get("skill_id", "")
                skill = skill_manager.get_skill(skill_id) if skill_id else None
                if skill:
                    skill_header = (
                        f"ACTIVE DOMAIN SKILL: {skill['name']}\n"
                        f"Description: {skill['description']}\n\n"
                        f"OPERATIONAL GUIDELINES & BEST PRACTICES:\n{skill['instructions']}\n\n"
                    )
                    if skill.get("evaluation_rubric"):
                        skill_header += f"DOMAIN QUALITY RUBRIC:\n{skill['evaluation_rubric']}\n\n"
                    evaluated_prompt = f"{skill_header}TASK INSTRUCTIONS:\n{evaluated_prompt}"

            messages = [{"role": "user", "content": evaluated_prompt}]
            try:
                response = await query_model(
                    model=model, messages=messages, timeout=180.0
                )
                if response and response.get("content"):
                    output_text = response["content"]
                    usage = response.get(
                        "usage",
                        {
                            "prompt_tokens": 0,
                            "completion_tokens": 0,
                            "total_tokens": 0,
                            "tokens_saved": 0,
                        },
                    )
                    cost_dict = {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                        "total_tokens": usage.get("total_tokens", 0),
                        "tokens_saved": usage.get("tokens_saved", 0),
                        "by_model": {
                            model: {
                                "prompt_tokens": usage.get("prompt_tokens", 0),
                                "completion_tokens": usage.get("completion_tokens", 0),
                                "total_tokens": usage.get("total_tokens", 0),
                                "tokens_saved": usage.get("tokens_saved", 0),
                            }
                        },
                    }
                    calculate_token_cost(cost_dict)
                    cost = cost_dict.get("total_cost", 0.0)
                    cost_saved = cost_dict.get("total_cost_saved", 0.0)
                    status = "completed"
                    error = None
                else:
                    output_text = (
                        f"[Error: Model '{model}' returned empty or failed response]"
                    )
                    usage = {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "tokens_saved": 0,
                    }
                    cost = 0.0
                    cost_saved = 0.0
                    status = "failed"
                    error = f"Model '{model}' returned no content"
            except Exception as ex:
                logger.error("Node execution error on node %s (%s): %s", nid, model, ex)
                output_text = f"[Exception: {ex}]"
                usage = {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "tokens_saved": 0,
                }
                cost = 0.0
                cost_saved = 0.0
                status = "failed"
                error = str(ex)

        end_time = datetime.now(timezone.utc).isoformat()

        record = {
            "id": nid,
            "label": label,
            "type": ntype,
            "model": model,
            "prompt_template": template,
            "evaluated_prompt": evaluated_prompt,
            "output": output_text,
            "status": status,
            "error": error,
            "started_at": start_time,
            "completed_at": end_time,
            "token_usage": {
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "tokens_saved": usage.get("tokens_saved", 0),
                "cost": cost,
                "cost_saved": cost_saved,
            },
        }
        return record

    for layer_idx, layer in enumerate(layers):
        # Emit node_start events for this entire layer
        for node in layer:
            yield {
                "event": "node_start",
                "data": {
                    "node_id": node["id"],
                    "label": node.get("label", node["id"]),
                    "type": node.get("type", "model_step"),
                    "model": node.get("model", ""),
                    "layer": layer_idx,
                },
            }

        # Run nodes in this layer concurrently
        layer_records = await asyncio.gather(*(run_single_node(node) for node in layer))

        # Store outputs and emit node_complete events
        for rec in layer_records:
            nid = rec["id"]
            all_node_outputs[nid] = rec["output"]
            node_execution_records.append(rec)

            # Accumulate token metrics
            t = rec["token_usage"]
            cumulative_tokens["total_tokens"] += t["total_tokens"]
            cumulative_tokens["prompt_tokens"] += t["prompt_tokens"]
            cumulative_tokens["completion_tokens"] += t["completion_tokens"]
            cumulative_tokens["tokens_saved"] += t["tokens_saved"]
            cumulative_tokens["total_cost"] = round(
                cumulative_tokens["total_cost"] + t["cost"], 8
            )
            cumulative_tokens["total_cost_saved"] = round(
                cumulative_tokens["total_cost_saved"] + t.get("cost_saved", 0.0), 8
            )

            m = rec["model"]
            if m:
                if m not in cumulative_tokens["by_model"]:
                    cumulative_tokens["by_model"][m] = {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "tokens_saved": 0,
                        "cost": 0.0,
                        "cost_saved": 0.0,
                        "total_cost": 0.0,
                    }
                bm = cumulative_tokens["by_model"][m]
                bm["prompt_tokens"] += t["prompt_tokens"]
                bm["completion_tokens"] += t["completion_tokens"]
                bm["total_tokens"] += t["total_tokens"]
                bm["tokens_saved"] += t["tokens_saved"]
                bm["cost"] = round(bm["cost"] + t["cost"], 8)
                bm["cost_saved"] = round(bm["cost_saved"] + t.get("cost_saved", 0.0), 8)
                bm["total_cost"] = bm["cost"]

            yield {
                "event": "node_complete",
                "data": rec,
            }

    # Identify final output deliverable
    output_nodes = [rec for rec in node_execution_records if rec["type"] == "output"]
    if output_nodes:
        final_output = output_nodes[-1]["output"]
    elif node_execution_records:
        final_output = node_execution_records[-1]["output"]
    else:
        final_output = ""

    # Check overall workflow status
    has_errors = any(rec["status"] == "failed" for rec in node_execution_records)
    final_status = "completed" if not has_errors else "completed_with_errors"

    yield {
        "event": "workflow_complete",
        "data": {
            "workflow_id": wf_id,
            "workflow_name": wf_name,
            "status": final_status,
            "final_output": final_output,
            "nodes": node_execution_records,
            "edges": edges,
            "token_usage": cumulative_tokens,
        },
    }
