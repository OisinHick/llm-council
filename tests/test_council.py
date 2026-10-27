from unittest.mock import AsyncMock, patch

import pytest

from backend.council import (
    _extract_json_object,
    calculate_aggregate_rankings,
    parse_ranking_from_text,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
)


def test_extract_json_object():
    # Markdown block
    txt1 = 'Here is the plan:\n```json\n{"thought": "ok", "action": "read"}\n```\nDone.'
    obj1 = _extract_json_object(txt1)
    assert obj1 == {"thought": "ok", "action": "read"}

    # Outer braces
    txt2 = 'Some prefix text {"action": "test", "key": 123} trailing text'
    obj2 = _extract_json_object(txt2)
    assert obj2 == {"action": "test", "key": 123}

    # Invalid
    assert _extract_json_object("No json here") is None
    assert _extract_json_object("") is None


def test_parse_ranking_from_text():
    sample_text = """
Evaluating responses:
Response A is very thorough.
Response B misses a key detail.
Response C has good ideas.

FINAL RANKING:
1. Response A
2. Response C
3. Response B
"""
    parsed = parse_ranking_from_text(sample_text)
    assert parsed == ["Response A", "Response C", "Response B"]

    # Fallback without header
    no_header = "I prefer Response B over Response A."
    parsed2 = parse_ranking_from_text(no_header)
    assert parsed2 == ["Response B", "Response A"]


def test_calculate_aggregate_rankings():
    stage2_results = [
        {
            "model": "evaluator-1",
            "ranking": "FINAL RANKING:\n1. Response A\n2. Response B",
        },
        {
            "model": "evaluator-2",
            "ranking": "FINAL RANKING:\n1. Response B\n2. Response A",
        },
        {
            "model": "evaluator-3",
            "ranking": "FINAL RANKING:\n1. Response A\n2. Response B",
        },
    ]
    label_to_model = {
        "Response A": "model-alpha",
        "Response B": "model-beta",
    }
    agg = calculate_aggregate_rankings(stage2_results, label_to_model)
    # model-alpha has positions: 1, 2, 1 -> avg = 4 / 3 = 1.33
    # model-beta has positions: 2, 1, 2 -> avg = 5 / 3 = 1.67
    assert len(agg) == 2
    assert agg[0]["model"] == "model-alpha"
    assert agg[0]["average_rank"] == 1.33
    assert agg[1]["model"] == "model-beta"
    assert agg[1]["average_rank"] == 1.67


@pytest.mark.asyncio
async def test_stage1_and_2_and_3():
    with (
        patch("backend.council.query_models_parallel", AsyncMock()) as mock_parallel,
        patch("backend.council.query_model", AsyncMock()) as mock_single,
    ):
        # Stage 1
        mock_parallel.return_value = {
            "model-1": {
                "content": "Answer 1",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "total_tokens": 30,
                },
            },
            "model-2": {
                "content": "Answer 2",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "total_tokens": 30,
                },
            },
        }
        res1 = await stage1_collect_responses("What is Python?")
        assert len(res1) == 2
        assert res1[0]["model"] == "model-1"

        # Stage 2
        mock_parallel.return_value = {
            "model-1": {"content": "FINAL RANKING:\n1. Response B\n2. Response A"},
            "model-2": {"content": "FINAL RANKING:\n1. Response A\n2. Response B"},
        }
        res2, label_map = await stage2_collect_rankings("What is Python?", res1)
        assert len(res2) == 2
        assert "Response A" in label_map
        assert "Response B" in label_map

        # Stage 3
        mock_single.return_value = {
            "content": "Synthesized consensus answer.",
            "usage": {
                "prompt_tokens": 50,
                "completion_tokens": 50,
                "total_tokens": 100,
            },
        }
        res3 = await stage3_synthesize_final("What is Python?", res1, res2)
        assert res3["response"] == "Synthesized consensus answer."
