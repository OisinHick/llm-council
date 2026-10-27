from unittest.mock import AsyncMock, patch

import pytest

from backend.openrouter import (
    calculate_token_cost,
    find_model_rates,
    parse_rate_value,
    query_model,
    query_models_parallel,
)


def test_parse_rate_value():
    assert parse_rate_value("0.0000015") == 0.0000015
    assert parse_rate_value(0.005) == 0.005
    assert parse_rate_value(None) == 0.0
    assert parse_rate_value("invalid") == 0.0
    assert parse_rate_value({}) == 0.0


def test_find_model_rates():
    rates = {
        "openai/gpt-4o-mini": {
            "prompt": 0.00000015,
            "completion": 0.0000006,
            "request": 0.0,
        },
        "google/gemini-2.5-flash": {
            "prompt": 0.0000003,
            "completion": 0.0000025,
            "request": 0.0,
        },
    }

    # 1. Exact match
    r1 = find_model_rates("openai/gpt-4o-mini", rates)
    assert r1["prompt"] == 0.00000015

    # 2. Stripped prefix ~
    r2 = find_model_rates("~openai/gpt-4o-mini", rates)
    assert r2["prompt"] == 0.00000015

    # 3. Stripped suffix :nitro
    r3 = find_model_rates("openai/gpt-4o-mini:nitro", rates)
    assert r3["prompt"] == 0.00000015

    # 4. Case-insensitive
    r4 = find_model_rates("OPENAI/GPT-4O-MINI", rates)
    assert r4["prompt"] == 0.00000015

    # 5. Substring / suffix
    r5 = find_model_rates("gemini-2.5-flash", rates)
    assert r5["prompt"] == 0.0000003

    # 6. Unknown model fallback
    r6 = find_model_rates("unknown/foo-bar", rates)
    assert r6["prompt"] == 0.0
    assert r6["completion"] == 0.0


def test_calculate_token_cost():
    usage = {
        "prompt_tokens": 1000,
        "completion_tokens": 500,
        "tokens_saved": 200,
        "by_model": {
            "openai/gpt-4o-mini": {
                "prompt_tokens": 1000,
                "completion_tokens": 500,
                "tokens_saved": 200,
            }
        },
    }
    rates = {
        "openai/gpt-4o-mini": {
            "prompt": 0.000001,
            "completion": 0.000002,
            "request": 0.0,
        }
    }
    result = calculate_token_cost(usage, rates=rates)
    m_data = result["by_model"]["openai/gpt-4o-mini"]
    # 1000 * 0.000001 + 500 * 0.000002 = 0.001 + 0.001 = 0.002
    assert m_data["cost"] == 0.002
    # 200 * 0.000001 = 0.0002
    assert m_data["cost_saved"] == 0.0002
    assert result["total_cost"] == 0.002
    assert result["total_cost_saved"] == 0.0002


@pytest.mark.asyncio
async def test_query_model_mock():
    mock_response = {
        "choices": [{"message": {"content": "Hello World", "reasoning_details": None}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    with patch("httpx.AsyncClient.post", AsyncMock()) as mock_post:
        mock_post.return_value.status_code = 200
        mock_post.return_value.raise_for_status = lambda: None
        mock_post.return_value.json = lambda: mock_response

        res = await query_model("test-model", [{"role": "user", "content": "hi"}])
        assert res is not None
        assert res["content"] == "Hello World"
        assert res["usage"]["prompt_tokens"] == 10
        assert res["usage"]["completion_tokens"] == 5
        assert res["usage"]["total_tokens"] == 15


@pytest.mark.asyncio
async def test_query_models_parallel_mock():
    mock_response1 = {
        "choices": [{"message": {"content": "Ans 1"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    mock_response2 = {
        "choices": [{"message": {"content": "Ans 2"}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 6, "total_tokens": 18},
    }

    async def side_effect(url, **kwargs):
        model = kwargs.get("json", {}).get("model")
        mock = AsyncMock()
        mock.status_code = 200
        mock.raise_for_status = lambda: None
        if model == "model-1":
            mock.json = lambda: mock_response1
        else:
            mock.json = lambda: mock_response2
        return mock

    with patch("httpx.AsyncClient.post", side_effect=side_effect):
        results = await query_models_parallel(
            ["model-1", "model-2"], [{"role": "user", "content": "hi"}]
        )
        assert "model-1" in results
        assert "model-2" in results
        assert results["model-1"]["content"] == "Ans 1"
        assert results["model-2"]["content"] == "Ans 2"
