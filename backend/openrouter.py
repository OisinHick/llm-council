"""OpenRouter API client for making LLM requests."""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .config import (
    OPENROUTER_API_URL,
    OPENROUTER_MODELS_URL,
    get_openrouter_api_key,
    get_enable_token_compression,
    get_compression_algorithm,
)
from .compression import compress_messages

logger = logging.getLogger(__name__)

# Dynamic pricing cache
_PRICING_CACHE: Dict[str, Any] = {
    "rates": {},
    "updated_at": None,
    "timestamp": 0.0,
    "count": 0,
}
PRICING_CACHE_TTL = 900  # 15 minutes


def parse_rate_value(val: Any) -> float:
    """Parse a rate value from OpenRouter pricing to float."""
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def find_model_rates(
    model_id: str, rates: Dict[str, Dict[str, float]]
) -> Dict[str, float]:
    """
    Find matching pricing rates for a model ID from dynamic OpenRouter rates.
    Handles exact match, stripped prefixes (~), stripped suffixes (:free, :nitro),
    case-insensitivity, and substring variations.
    """
    default_rate = {"prompt": 0.0, "completion": 0.0, "request": 0.0}
    if not model_id or not rates:
        return default_rate

    # 1. Exact match
    if model_id in rates:
        return rates[model_id]

    # 2. Stripped prefix (e.g. ~ prefix for test or priority routing)
    cleaned = model_id.lstrip("~").strip()
    if cleaned in rates:
        return rates[cleaned]

    # 3. Stripped suffix (e.g. :free, :nitro, :extended)
    base = cleaned.split(":")[0]
    if base in rates:
        return rates[base]

    # 4. Case-insensitive exact or base match
    cleaned_lower = cleaned.lower()
    base_lower = base.lower()
    for m_id, r in rates.items():
        m_lower = m_id.lower()
        if m_lower == cleaned_lower or m_lower == base_lower:
            return r

    # 5. Suffix / Substring match (e.g. 'gemini-2.5-flash' in 'google/gemini-2.5-flash')
    for m_id, r in rates.items():
        m_lower = m_id.lower()
        if m_lower.endswith("/" + base_lower) or base_lower.endswith("/" + m_lower):
            return r

    return default_rate


async def fetch_dynamic_pricing(
    api_key: Optional[str] = None, force_refresh: bool = False
) -> Dict[str, Any]:
    """
    Fetch live model pricing dynamically from OpenRouter.
    Uses in-memory cache if within TTL, unless force_refresh is True.
    """
    now = time.time()
    if (
        not force_refresh
        and _PRICING_CACHE["rates"]
        and (now - _PRICING_CACHE["timestamp"]) < PRICING_CACHE_TTL
    ):
        return {
            "rates": _PRICING_CACHE["rates"],
            "updated_at": _PRICING_CACHE["updated_at"],
            "count": _PRICING_CACHE["count"],
        }

    key = api_key or get_openrouter_api_key()
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
            response.raise_for_status()

            data = response.json()
            raw_models = data.get("data", [])

            rates: Dict[str, Dict[str, float]] = {}
            for model in raw_models:
                m_id = model.get("id")
                if not m_id:
                    continue
                pricing = model.get("pricing") or {}
                rates[m_id] = {
                    "prompt": parse_rate_value(pricing.get("prompt")),
                    "completion": parse_rate_value(pricing.get("completion")),
                    "request": parse_rate_value(pricing.get("request")),
                }

            iso_now = datetime.now(timezone.utc).isoformat()
            _PRICING_CACHE["rates"] = rates
            _PRICING_CACHE["updated_at"] = iso_now
            _PRICING_CACHE["timestamp"] = now
            _PRICING_CACHE["count"] = len(rates)
            logger.info("Dynamically fetched %d model pricing rates from OpenRouter.", len(rates))

            return {
                "rates": rates,
                "updated_at": iso_now,
                "count": len(rates),
            }
    except Exception as e:
        logger.warning("Failed to dynamically fetch OpenRouter pricing: %s", e)
        if _PRICING_CACHE["rates"]:
            return {
                "rates": _PRICING_CACHE["rates"],
                "updated_at": _PRICING_CACHE["updated_at"],
                "count": _PRICING_CACHE["count"],
            }
        fallback_rates = {
            "openai/gpt-4o-mini": {"prompt": 0.00000015, "completion": 0.0000006, "request": 0.0},
            "google/gemini-2.5-flash": {"prompt": 0.0000003, "completion": 0.0000025, "request": 0.0},
            "anthropic/claude-3-haiku": {"prompt": 0.00000025, "completion": 0.00000125, "request": 0.0},
            "meta-llama/llama-3.3-70b-instruct": {"prompt": 0.0000001, "completion": 0.00000032, "request": 0.0},
        }
        return {
            "rates": fallback_rates,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(fallback_rates),
        }


def get_cached_rates() -> Dict[str, Dict[str, float]]:
    """
    Return currently cached dynamic rates synchronously.
    If the cache has expired past TTL, schedules a background refresh.
    """
    now = time.time()
    if (now - _PRICING_CACHE.get("timestamp", 0.0)) >= PRICING_CACHE_TTL:
        try:
            loop = asyncio.get_running_loop()
            if loop and loop.is_running():
                loop.create_task(fetch_dynamic_pricing(force_refresh=True))
        except RuntimeError:
            pass
    return _PRICING_CACHE.get("rates") or {}


def get_cached_pricing_info() -> Dict[str, Any]:
    """Return current pricing cache status."""
    return {
        "rates": _PRICING_CACHE.get("rates") or {},
        "updated_at": _PRICING_CACHE.get("updated_at"),
        "count": _PRICING_CACHE.get("count", 0),
    }


def calculate_token_cost(
    token_usage: Dict[str, Any],
    rates: Optional[Dict[str, Dict[str, float]]] = None,
) -> Dict[str, Any]:
    """
    Calculate estimated dollar spend for a token_usage dictionary
    using dynamically fetched OpenRouter rates.
    """
    if not token_usage or not isinstance(token_usage, dict):
        return {"total_cost": 0.0, "total_cost_saved": 0.0}

    active_rates = rates if rates is not None else get_cached_rates()
    total_cost = 0.0
    total_cost_saved = 0.0
    by_model = token_usage.get("by_model") or {}

    for model_id, m_data in by_model.items():
        if not isinstance(m_data, dict):
            continue
        m_rates = find_model_rates(model_id, active_rates)
        p_tokens = int(m_data.get("prompt_tokens") or 0)
        c_tokens = int(m_data.get("completion_tokens") or 0)
        s_tokens = int(m_data.get("tokens_saved") or 0)

        prompt_cost = p_tokens * m_rates.get("prompt", 0.0)
        comp_cost = c_tokens * m_rates.get("completion", 0.0)
        cost_saved = s_tokens * m_rates.get("prompt", 0.0)

        m_cost = round(prompt_cost + comp_cost, 8)
        m_cost_saved = round(cost_saved, 8)

        m_data["cost"] = m_cost
        m_data["cost_saved"] = m_cost_saved
        m_data["rates"] = {
            "prompt": m_rates.get("prompt", 0.0),
            "completion": m_rates.get("completion", 0.0),
        }
        total_cost += m_cost
        total_cost_saved += m_cost_saved

    # If by_model was empty but total tokens exist, calculate fallback estimate
    if not by_model and token_usage.get("total_tokens", 0) > 0:
        p = int(token_usage.get("prompt_tokens") or 0)
        c = int(token_usage.get("completion_tokens") or 0)
        s = int(token_usage.get("tokens_saved") or 0)
        total_cost = round(p * 0.00000015 + c * 0.0000006, 8)
        total_cost_saved = round(s * 0.00000015, 8)

    token_usage["total_cost"] = round(total_cost, 8)
    token_usage["total_cost_saved"] = round(total_cost_saved, 8)
    return token_usage


async def fetch_openrouter_models(
    api_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch list of available models from OpenRouter API with pricing.

    Args:
        api_key: Optional OpenRouter API key override

    Returns:
        List of dicts containing model 'id', 'name', 'context_length', and 'pricing'
    """
    key = api_key or get_openrouter_api_key()
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
        response.raise_for_status()

        data = response.json()
        raw_models = data.get("data", [])

        # Also update dynamic pricing cache while fetching models
        now = time.time()
        rates: Dict[str, Dict[str, float]] = {}
        formatted_models = []
        for model in raw_models:
            m_id = model.get("id", "")
            pricing = model.get("pricing") or {}
            if m_id:
                rates[m_id] = {
                    "prompt": parse_rate_value(pricing.get("prompt")),
                    "completion": parse_rate_value(pricing.get("completion")),
                    "request": parse_rate_value(pricing.get("request")),
                }
            formatted_models.append({
                "id": m_id,
                "name": model.get("name") or m_id,
                "context_length": model.get("context_length"),
                "description": model.get("description", ""),
                "pricing": pricing,
            })

        if rates:
            _PRICING_CACHE["rates"] = rates
            _PRICING_CACHE["updated_at"] = datetime.now(timezone.utc).isoformat()
            _PRICING_CACHE["timestamp"] = now
            _PRICING_CACHE["count"] = len(rates)

        # Sort by name alphabetically
        formatted_models.sort(key=lambda m: m["name"].lower())
        return formatted_models


async def query_model(
    model: str, messages: List[Dict[str, str]], timeout: float = 120.0
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    key = get_openrouter_api_key()
    if not key:
        logger.warning("OPENROUTER_API_KEY is not set; OpenRouter request will fail.")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    compression_enabled = get_enable_token_compression()
    tokens_saved = 0
    effective_messages = messages

    if compression_enabled:
        algo = get_compression_algorithm()
        comp_res = compress_messages(
            messages=messages,
            model=model,
            algorithm=algo,
            enabled=True,
        )
        effective_messages = comp_res.messages
        tokens_saved = comp_res.tokens_saved

    payload = {
        "model": model,
        "messages": effective_messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_API_URL, headers=headers, json=payload
            )
            response.raise_for_status()

            data = response.json()
            message = data["choices"][0]["message"]
            content = message.get("content") or ""

            raw_usage = data.get("usage") or {}
            prompt_tokens = raw_usage.get("prompt_tokens")
            completion_tokens = raw_usage.get("completion_tokens")
            total_tokens = raw_usage.get("total_tokens")

            # Fallback estimation if usage is not provided or 0
            if prompt_tokens is None or prompt_tokens <= 0:
                p_len = sum(len(str(m.get("content", ""))) for m in effective_messages)
                prompt_tokens = max(1, p_len // 4)
            if completion_tokens is None or completion_tokens <= 0:
                c_len = len(content)
                completion_tokens = max(1, c_len // 4) if content else 0
            if total_tokens is None or total_tokens <= 0:
                total_tokens = prompt_tokens + completion_tokens

            return {
                "content": content,
                "reasoning_details": message.get("reasoning_details"),
                "usage": {
                    "prompt_tokens": int(prompt_tokens),
                    "completion_tokens": int(completion_tokens),
                    "total_tokens": int(total_tokens),
                    "tokens_saved": int(tokens_saved),
                },
            }

    except Exception:
        logger.exception("Error querying model %s", model)
        return None


async def query_models_parallel(
    models: List[str], messages: List[Dict[str, str]], timeout: float = 180.0
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model
        timeout: Maximum number of seconds to wait for all models

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    # Create tasks for all models
    tasks = [asyncio.create_task(query_model(model, messages, timeout=timeout)) for model in models]

    try:
        responses = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True), timeout=timeout
        )
    except asyncio.TimeoutError:
        # Cancel any tasks that are still running and mark them as failed.
        for task in tasks:
            if not task.done():
                task.cancel()

        responses = []
        for task in tasks:
            try:
                response = await task
            except Exception:
                response = None
            responses.append(response)
    else:
        # Normalize exceptions to None.
        normalized = []
        for response in responses:
            if isinstance(response, Exception):
                normalized.append(None)
            else:
                normalized.append(response)
        responses = normalized

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}

