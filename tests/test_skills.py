import tempfile
from pathlib import Path
import pytest

from backend.skills import SkillManager, skill_manager
from backend.agent_tools import AgentToolExecutor
from backend.agent import CouncilAgent


@pytest.fixture(autouse=True)
def clean_skills_state():
    """Ensure skills cache is refreshed and test artifacts cleaned up."""
    # Discover initial skills
    yield
    # Clean up any skills created in default directory
    for item in list(skill_manager.skills_dir.iterdir()):
        if item.is_dir() and item.name.startswith("test-"):
            skill_manager.delete_skill(item.name)
    skill_manager.discover_skills(force_refresh=True)


def test_no_builtin_skills_shipped():
    """Verify no built-in skills are shipped in the repository; all skills are user-provided."""
    skills = skill_manager.discover_skills(force_refresh=True)
    assert len(skills) == 0


def test_user_provided_skill_crud_and_matching():
    """Test full CRUD lifecycle and keyword trigger matching for a user-provided skill."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        manager = SkillManager(skills_dir=Path(tmp_dir))
        assert len(manager.discover_skills()) == 0

        # 1. User creates a new skill
        saved = manager.save_skill(
            skill_id="test-cloud-security",
            name="Cloud Security Specialist",
            description="Audit AWS and Kubernetes configurations for IAM and networking flaws.",
            instructions="# Cloud Security Guidelines\n1. Review IAM policies.\n2. Ensure least privilege.",
            triggers=["cloud", "iam", "aws", "kubernetes", "security"],
            evaluation_rubric="1. Threat Realism: Practical exploit paths identified.",
            expert_roles=["Cloud Architect", "Security Engineer"],
        )
        assert saved["id"] == "test-cloud-security"
        assert saved["name"] == "Cloud Security Specialist"
        assert saved["is_builtin"] is False

        # 2. Retrieve user-provided skill
        loaded = manager.get_skill("test-cloud-security")
        assert loaded is not None
        assert loaded["name"] == "Cloud Security Specialist"
        assert "Ensure least privilege" in loaded["instructions"]
        assert "Threat Realism" in loaded["evaluation_rubric"]
        assert len(manager.discover_skills(force_refresh=True)) == 1

        # 3. Match against user queries
        match = manager.match_skill("Please review our AWS IAM security policies")
        assert match is not None
        assert match["id"] == "test-cloud-security"

        # Neutral query does not match
        assert manager.match_skill("What is the speed of light?") is None

        # 4. Delete skill (user-provided skills are fully deletable)
        assert manager.delete_skill("test-cloud-security") is True
        assert manager.get_skill("test-cloud-security") is None
        assert len(manager.discover_skills(force_refresh=True)) == 0


@pytest.mark.asyncio
async def test_agent_tool_executor_with_user_skill():
    """Test Chairperson agent tools with user-provided skills."""
    # Create user skill
    skill_manager.save_skill(
        skill_id="test-code-reviewer",
        name="Code Reviewer",
        description="Review code for clean architecture and edge cases.",
        instructions="# Review Standards\n- Keep methods short\n- Handle all exceptions",
        triggers=["review", "code-review"],
        evaluation_rubric="1. Clarity\n2. Completeness",
        expert_roles=["Staff Software Engineer"],
    )

    # Optionally add a test script to the user skill's scripts directory
    skill_dir = skill_manager.skills_dir / "test-code-reviewer"
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    sample_script = scripts_dir / "check_style.py"
    sample_script.write_text("import sys\nprint('Style check completed cleanly.')\n", encoding="utf-8")

    executor = AgentToolExecutor()

    # List skills
    list_res = await executor.list_skills()
    assert list_res["success"] is True
    assert list_res["count"] >= 1
    assert any(s["id"] == "test-code-reviewer" for s in list_res["skills"])

    # Load skill
    load_res = await executor.load_skill("test-code-reviewer")
    assert load_res["success"] is True
    assert load_res["name"] == "Code Reviewer"
    assert "Clarity" in load_res["evaluation_rubric"]

    # Load non-existent skill
    load_err = await executor.load_skill("non-existent-xyz")
    assert load_err["success"] is False
    assert "not found" in load_err["error"].lower()

    # Execute user script
    script_res = await executor.execute_skill_script(
        skill_name="test-code-reviewer",
        script_name="check_style.py",
        args="",
    )
    assert script_res["success"] is True
    assert "Style check completed cleanly" in script_res["stdout"]

    # Cleanup
    skill_manager.delete_skill("test-code-reviewer")


def test_council_agent_system_prompt_user_skill_injection():
    """Test that CouncilAgent system prompt reflects the active user-provided skill."""
    skill_manager.save_skill(
        skill_id="test-arch-review",
        name="Architecture Reviewer",
        description="Review system design and modularity.",
        instructions="Ensure loose coupling and high cohesion.",
    )

    agent = CouncilAgent(
        user_request="Design our service communication architecture",
        initial_council={"stage3": {"response": "Initial blueprint"}},
        skill_id="test-arch-review",
    )
    prompt = agent._build_system_prompt(external_tools=[])
    assert "ACTIVE DOMAIN SKILL: Architecture Reviewer" in prompt
    assert "load_skill" in prompt
    assert "execute_skill_script" in prompt

    skill_manager.delete_skill("test-arch-review")


def test_skills_rest_endpoints():
    """Test REST API endpoints for user-provided skills."""
    from fastapi.testclient import TestClient
    from backend.main import app

    client = TestClient(app)

    # 1. Initially empty (or no test skills)
    r_initial = client.get("/api/skills")
    assert r_initial.status_code == 200

    # 2. Create user skill via POST
    r_create = client.post(
        "/api/skills",
        json={
            "id": "test-api-designer",
            "name": "API Design Specialist",
            "description": "REST and GraphQL schema design best practices.",
            "instructions": "# API Guidelines\nUse semantic HTTP verbs.",
            "triggers": ["api", "rest", "graphql", "endpoints"],
            "evaluation_rubric": "1. Consistency\n2. Idempotency",
            "expert_roles": ["API Architect"],
        },
    )
    assert r_create.status_code == 200
    assert r_create.json()["success"] is True

    # 3. Verify in listing
    r_list = client.get("/api/skills")
    assert r_list.status_code == 200
    skills = r_list.json()["skills"]
    assert any(s["id"] == "test-api-designer" for s in skills)

    # 4. GET /api/skills/{id}
    r_detail = client.get("/api/skills/test-api-designer")
    assert r_detail.status_code == 200
    data = r_detail.json()
    assert data["name"] == "API Design Specialist"
    assert "Consistency" in data["evaluation_rubric"]

    # 5. GET non-existent returns 404
    r_404 = client.get("/api/skills/unknown-skill-xyz")
    assert r_404.status_code == 404

    # 6. Delete user skill via DELETE
    r_del = client.delete("/api/skills/test-api-designer")
    assert r_del.status_code == 200
    assert r_del.json()["success"] is True

    # Confirm deletion
    r_check_deleted = client.get("/api/skills/test-api-designer")
    assert r_check_deleted.status_code == 404


@pytest.mark.asyncio
async def test_council_deliberation_with_user_skill():
    """Test that Council Stages 1, 2, and 3 use user-provided skill roles, rubrics, and guidelines."""
    from unittest.mock import patch, AsyncMock
    from backend.council import stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final

    user_skill = skill_manager.save_skill(
        skill_id="test-data-eng",
        name="Data Engineering",
        description="ETL pipelines and warehouse schema design.",
        instructions="Enforce idempotency and data lineage.",
        evaluation_rubric="1. Pipeline Reliability: Handles backfill and failure recovery.",
        expert_roles=["Data Architect", "Pipeline Specialist"],
    )

    # Stage 1: expert roles injection
    with patch("backend.council.query_model", new_callable=AsyncMock) as mock_query:
        mock_query.return_value = {"content": "Data model proposal", "usage": {}}
        res1 = await stage1_collect_responses("Design ETL pipeline", skill=user_skill)
        assert len(res1) > 0
        first_call_prompt = mock_query.call_args_list[0][0][1][0]["content"]
        assert "ACTIVE DOMAIN SKILL: Data Engineering" in first_call_prompt

    # Stage 2: rubric injection
    with patch("backend.council.query_models_parallel", new_callable=AsyncMock) as mock_parallel:
        mock_parallel.return_value = {
            "model-a": {"content": "Great response.\n\nFINAL RANKING:\n1. Response A\n", "usage": {}}
        }
        res2, label_map = await stage2_collect_rankings(
            "Design ETL pipeline",
            [{"model": "model-a", "response": "Response content"}],
            skill=user_skill,
        )
        assert len(res2) == 1
        prompt_sent = mock_parallel.call_args[0][1][0]["content"]
        assert "DOMAIN EVALUATION CRITERIA (Data Engineering)" in prompt_sent
        assert "Pipeline Reliability" in prompt_sent

    # Stage 3: synthesis injection
    with patch("backend.council.query_model", new_callable=AsyncMock) as mock_query:
        mock_query.return_value = {"content": "Synthesized data warehouse architecture", "usage": {}}
        res3 = await stage3_synthesize_final(
            "Design ETL pipeline",
            [{"model": "model-a", "response": "Response content"}],
            res2,
            skill=user_skill,
        )
        assert "Synthesized" in res3["response"]
        prompt_sent = mock_query.call_args[0][1][0]["content"]
        assert "ACTIVE DOMAIN SKILL: Data Engineering" in prompt_sent

    skill_manager.delete_skill("test-data-eng")


@pytest.mark.asyncio
async def test_workflow_with_user_skill_step():
    """Test custom workflow DAG execution with a skill_step node using a user-provided skill."""
    from unittest.mock import patch, AsyncMock
    from backend.workflows import execute_workflow_stream, validate_workflow

    user_skill = skill_manager.save_skill(
        skill_id="test-perf-tuning",
        name="Performance Tuning",
        description="Identify performance bottlenecks and optimize latency.",
        instructions="Profile memory and benchmark critical loops.",
        evaluation_rubric="1. Measurable Speedup: Quantified latency reduction.",
    )

    wf = {
        "id": "test-perf-wf",
        "name": "Performance Workflow",
        "nodes": [
            {"id": "in", "type": "input", "label": "Input"},
            {
                "id": "step_skill",
                "type": "skill_step",
                "label": "Tuning Step",
                "skill_id": "test-perf-tuning",
                "model": "google/gemini-2.5-flash",
                "prompt_template": "Optimize: {input}",
            },
            {"id": "out", "type": "output", "label": "Output"},
        ],
        "edges": [
            {"id": "e1", "source": "in", "target": "step_skill"},
            {"id": "e2", "source": "step_skill", "target": "out"},
        ],
    }

    is_valid, msg = validate_workflow(wf)
    assert is_valid, msg

    with patch("backend.workflows.query_model", new_callable=AsyncMock) as mock_query:
        mock_query.return_value = {
            "content": "Optimized memory allocation by 40%.",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        events = []
        async for event in execute_workflow_stream(wf, user_input="Optimize database index"):
            events.append(event)

        assert any(e["event"] == "workflow_start" for e in events)
        assert any(e["event"] == "workflow_complete" for e in events)
        sent_prompt = mock_query.call_args[1]["messages"][0]["content"]
        assert "ACTIVE DOMAIN SKILL: Performance Tuning" in sent_prompt

    skill_manager.delete_skill("test-perf-tuning")


def test_workflow_validation_skill_step():
    """Verify DAG validation enforces that skill_step nodes specify a model."""
    from backend.workflows import validate_workflow

    # Fails if skill_step lacks model
    invalid_wf = {
        "name": "Invalid Skill WF",
        "nodes": [
            {"id": "in", "type": "input"},
            {"id": "step1", "type": "skill_step", "model": "", "skill_id": "any-user-skill"},
            {"id": "out", "type": "output"},
        ],
        "edges": [
            {"id": "e1", "source": "in", "target": "step1"},
            {"id": "e2", "source": "step1", "target": "out"},
        ],
    }
    is_valid, err = validate_workflow(invalid_wf)
    assert not is_valid
    assert "must specify a model" in err


def test_resolve_skill_helpers():
    """Test _resolve_skill with explicit ID and auto-trigger matching on user skills."""
    from backend.main import _resolve_skill

    user_skill = skill_manager.save_skill(
        skill_id="test-cloud-infra",
        name="Cloud Infrastructure",
        description="Terraform and Kubernetes infrastructure provisioning.",
        instructions="Use declarative IaC.",
        triggers=["terraform", "infrastructure", "kubernetes", "infra"],
    )

    # 1. Explicit ID
    s1 = _resolve_skill("test-cloud-infra", "arbitrary text")
    assert s1 is not None and s1["id"] == "test-cloud-infra"

    # 2. None ID
    s2 = _resolve_skill(None, "Provision terraform cluster")
    assert s2 is None

    # 3. Auto matching
    s3 = _resolve_skill("auto", "Let's provision a new Kubernetes infrastructure cluster with Terraform")
    assert s3 is not None and s3["id"] == "test-cloud-infra"

    # 4. Auto matching with neutral prompt
    s4 = _resolve_skill("auto", "What is the capital of France?")
    assert s4 is None

    skill_manager.delete_skill("test-cloud-infra")
