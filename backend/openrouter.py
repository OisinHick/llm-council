"""OpenRouter API client and dynamic pricing engine for LLM Council.

This module provides an asynchronous HTTP client interface for querying large language models
hosted on OpenRouter (https://openrouter.ai).

Key Features:
    1. Single & Parallel LLM Queries:
       - `query_model`: Asynchronously queries a single model with timeout, error recovery,
         optional prompt compression, and token usage accounting.
       - `query_models_parallel`: Uses `asyncio.gather` with task-level cancellation and timeouts
         to concurrently query all council models with graceful degradation.
    2. Dynamic Pricing & Cost Calculation:
       - `fetch_dynamic_pricing`: Fetches live, real-time per-token pricing tables directly from
         the OpenRouter models API (`https://openrouter.ai/api/v1/models`).
       - In-memory pricing cache with a 15-minute TTL (`PRICING_CACHE_TTL = 900`).
       - `find_model_rates`: Robust multi-stage matching strategy (exact match, prefix removal like '~',
         suffix removal like ':free' or ':nitro', case-insensitivity, and substring matching) to
         accurately resolve model prices across different OpenRouter identifier conventions.
       - `calculate_token_cost`: Automatically updates token usage structures with exact dollar
         spend calculations and saved dollars from compression.
    3. Context Compression Interception:
       - Seamlessly applies prompt/context compression (via `backend.compression`) before dispatching
         requests when token compression is enabled.
"""

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

# In-memory dynamic pricing cache
_PRICING_CACHE: Dict[str, Any] = {
    "rates": {},
    "updated_at": None,
    "timestamp": 0.0,
    "count": 0,
}
# Time-to-live for dynamic pricing rates cache (15 minutes in seconds)
PRICING_CACHE_TTL: int = 900


def parse_rate_value(val: Any) -> float:
    """Safely parse an OpenRouter pricing rate value to a float.

    OpenRouter pricing values can be strings (e.g., "0.00000015"), numbers, or None.
    This helper handles type conversion safely and returns 0.0 on invalid or missing inputs.

    Args:
        val (Any): Raw pricing rate value from OpenRouter API.

    Returns:
        float: Parsed floating-point price per token (in USD), or 0.0 if unparseable.
    """
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def find_model_rates(
    model_id: str, rates: Dict[str, Dict[str, float]]
) -> Dict[str, float]:
    """Find matching prompt, completion, and request pricing rates for a given model identifier.

    OpenRouter model IDs often vary depending on routing hints, routing flags, or context variants
    (e.g., '~openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct:nitro', or 'google/gemini-2.5-flash:free').
    This function applies a multi-tiered fallback search:
      1. Exact match against the rates table.
      2. Stripped prefix match (removes leading '~' used for routing flags).
      3. Stripped suffix match (removes ':free', ':nitro', ':extended' variants).
      4. Case-insensitive exact or base name match.
      5. Substring / suffix match (e.g., matching 'gemini-2.5-flash' within 'google/gemini-2.5-flash').

    Args:
        model_id (str): The model identifier string to look up.
        rates (Dict[str, Dict[str, float]]): Dictionary mapping model IDs to rate dictionaries
            with keys 'prompt', 'completion', and 'request'.

    Returns:
        Dict[str, float]: Matched rates dictionary with keys 'prompt', 'completion', 'request'.
            Returns default zero rates if no match is found.
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


def _extract_pricing_rates(raw_models: List[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    """Extract and parse per-model pricing rate dictionaries from raw OpenRouter models list.

    Args:
        raw_models (List[Dict[str, Any]]): List of raw model dictionaries returned by the OpenRouter API.

    Returns:
        Dict[str, Dict[str, float]]: Mapping of model ID to {'prompt': float, 'completion': float, 'request': float}.
    """
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
    return rates


def _update_pricing_cache(rates: Dict[str, Dict[str, float]]) -> Dict[str, Any]:
    """Update in-memory pricing cache with new rates and return structured cache metadata.

    Args:
        rates (Dict[str, Dict[str, float]]): Mapping of model IDs to pricing rates.

    Returns:
        Dict[str, Any]: Cache status summary containing 'rates', 'updated_at', and 'count'.
    """
    now = time.time()
    iso_now = datetime.now(timezone.utc).isoformat()
    _PRICING_CACHE["rates"] = rates
    _PRICING_CACHE["updated_at"] = iso_now
    _PRICING_CACHE["timestamp"] = now
    _PRICING_CACHE["count"] = len(rates)
    return {
        "rates": rates,
        "updated_at": iso_now,
        "count": len(rates),
    }


async def fetch_dynamic_pricing(
    api_key: Optional[str] = None, force_refresh: bool = False
) -> Dict[str, Any]:
    """Fetch live model pricing dynamically from OpenRouter or return cached values.

    Checks the in-memory cache first: if the cache is non-empty and has not exceeded
    `PRICING_CACHE_TTL` (15 minutes), the cached rates are returned immediately unless
    `force_refresh` is True.

    If network fetching fails (e.g. offline, rate-limited, invalid key), it falls back
    to any existing cached rates, or baseline static fallback rates for default council models.

    Args:
        api_key (Optional[str]): Optional OpenRouter API key override. If omitted, uses configured key.
        force_refresh (bool): If True, bypasses the TTL cache and forces a live network fetch.

    Returns:
        Dict[str, Any]: Dictionary containing:
            - "rates" (dict): Mapping of model IDs to pricing rates.
            - "updated_at" (str): ISO-8601 UTC timestamp of last update.
            - "count" (int): Number of models loaded.
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
            rates = _extract_pricing_rates(raw_models)
            result = _update_pricing_cache(rates)
            logger.info("Dynamically fetched %d model pricing rates from OpenRouter.", len(rates))
            return result
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
    """Return currently cached dynamic rates synchronously, scheduling a background refresh if expired.

    Checks whether the cache age exceeds `PRICING_CACHE_TTL` (900 seconds). If expired and an asyncio
    event loop is actively running, an asynchronous background task is created to refresh rates
    without blocking the caller.

    Returns:
        Dict[str, Dict[str, float]]: In-memory mapping of model IDs to rates dictionaries.
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
    """Return status and metadata for the current in-memory pricing cache.

    Returns:
        Dict[str, Any]: Dictionary containing:
            - "rates" (dict): Current model pricing rate tables.
            - "updated_at" (str): ISO-8601 UTC timestamp of last successful fetch.
            - "count" (int): Number of models currently cached.
    """
    return {
        "rates": _PRICING_CACHE.get("rates") or {},
        "updated_at": _PRICING_CACHE.get("updated_at"),
        "count": _PRICING_CACHE.get("count", 0),
    }


def calculate_token_cost(
    token_usage: Dict[str, Any],
    rates: Optional[Dict[str, Dict[str, float]]] = None,
) -> Dict[str, Any]:
    """Calculate estimated dollar spend for a token_usage dictionary using dynamic OpenRouter rates.

    For each model entry in `token_usage['by_model']`:
      1. Resolves model-specific rates via `find_model_rates(model_id, active_rates)`.
      2. Multiplies input prompt tokens by the prompt rate.
      3. Multiplies output completion tokens by the completion rate.
      4. Multiplies tokens saved via compression by the prompt rate to determine saved spend.
      5. Annotates `token_usage['by_model'][model]` with 'cost', 'cost_saved', and active 'rates'.
      6. Accumulates total conversation/turn spend into `token_usage['total_cost']` and `token_usage['total_cost_saved']`.

    Fallback Calculation:
      If `by_model` is empty but total tokens are present, applies conservative default rates
      ($0.15 / 1M prompt tokens, $0.60 / 1M completion tokens).

    Args:
        token_usage (Dict[str, Any]): Mutable token usage dictionary.
        rates (Optional[Dict[str, Dict[str, float]]]): Optional rates table. If omitted, uses cached rates.

    Returns:
        Dict[str, Any]: The mutated `token_usage` dictionary updated with cost fields.
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
    """Fetch all available models from OpenRouter API including context windows and pricing.

    Also automatically refreshes the in-memory pricing cache (`_PRICING_CACHE`) with the newly
    fetched rates. Results are sorted alphabetically by model name for UI display.

    Args:
        api_key (Optional[str]): Optional OpenRouter API key override.

    Returns:
        List[Dict[str, Any]]: List of model description dicts, each with:
            - "id" (str): Full identifier (e.g., 'openai/gpt-4o').
            - "name" (str): Human-readable model display name.
            - "context_length" (int): Maximum input context window tokens.
            - "description" (str): Model capabilities description.
            - "pricing" (dict): Pricing rates dictionary for prompt and completion tokens.

    Raises:
        httpx.HTTPError: If the OpenRouter models endpoint returns an error status code.
    """
    key = api_key or get_openrouter_api_key()
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
            response.raise_for_status()
        except httpx.HTTPError as e:
            logger.error("Failed to fetch OpenRouter models: %s", e)
            raise

        data = response.json()
        raw_models = data.get("data", [])

        # Update dynamic pricing cache from raw models
        rates = _extract_pricing_rates(raw_models)
        if rates:
            _update_pricing_cache(rates)

        formatted_models = [
            {
                "id": model.get("id", ""),
                "name": model.get("name") or model.get("id", ""),
                "context_length": model.get("context_length"),
                "description": model.get("description", ""),
                "pricing": model.get("pricing") or {},
            }
            for model in raw_models
            if model.get("id")
        ]

        # Sort by name alphabetically
        formatted_models.sort(key=lambda m: m["name"].lower())
        return formatted_models


_last_model_errors: Dict[str, str] = {}


def get_last_model_error(model: str) -> Optional[str]:
    """Get the most recent error message for an OpenRouter model query, if any."""
    return _last_model_errors.get(model)


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 120.0,
) -> Optional[Dict[str, Any]]:
    """Query a single LLM model via OpenRouter API with error isolation and token accounting.

    Execution Flow:
      1. Checks and prepares authentication headers using the active OpenRouter API key.
      2. If token compression is enabled, intercepts messages and applies context compression
         using the active algorithm (headroom, heuristic, or adaptive), recording saved tokens.
      3. Dispatches an async POST request to `OPENROUTER_API_URL` with a configurable timeout.
      4. Parses generated response content and extracts usage metadata (prompt, completion, total).
      5. If the model provider does not return token usage statistics, computes a 4-char heuristic
         token count fallback to ensure downstream billing calculations remain valid.
      6. Catches and logs HTTP errors, timeouts, or unexpected exceptions, returning None
         for graceful degradation.

    Args:
        model (str): OpenRouter model identifier (e.g. 'openai/gpt-4o-mini', 'google/gemini-2.5-flash').
        messages (List[Dict[str, str]]): List of chat message dicts with 'role' and 'content'.
        timeout (float): Maximum request duration in seconds before timing out. Defaults to 120.0.

    Returns:
        Optional[Dict[str, Any]]: Response dictionary containing:
            - "content" (str): Generated assistant response text.
            - "reasoning_details" (Optional[Any]): Chain-of-thought details if supported by model.
            - "usage" (dict): Token metrics:
                - "prompt_tokens" (int)
                - "completion_tokens" (int)
                - "total_tokens" (int)
                - "tokens_saved" (int)
            Returns None if the request failed or timed out.
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

    payload: Dict[str, Any] = {
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

            _last_model_errors.pop(model, None)
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

    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code if e.response else "unknown"
        error_preview = e.response.text[:200] if e.response else str(e)
        try:
            err_json = e.response.json()
            error_msg = err_json.get("error", {}).get("message") or error_preview
        except Exception:
            error_msg = error_preview
        _last_model_errors[model] = f"HTTP {status_code}: {error_msg}"
        logger.error(
            "HTTP error %s querying model %s via OpenRouter: %s",
            status_code,
            model,
            error_preview,
        )
        return None
    except httpx.TimeoutException:
        _last_model_errors[model] = f"Timeout ({timeout}s) querying OpenRouter"
        logger.warning("Timeout (%ss) while querying model %s via OpenRouter", timeout, model)
        return None
    except Exception as e:
        _last_model_errors[model] = f"Unexpected error: {e}"
        logger.exception("Unexpected error querying model %s: %s", model, e)
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
    timeout: float = 180.0,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """Query multiple models concurrently using asyncio.gather with timeout and cancellation safety.

    Creates an async query task for each model in `models`. If the entire batch exceeds
    the allotted timeout, running tasks are cancelled cleanly to free network resources
    and prevent lingering requests.

    Failed requests or exceptions are normalized to `None`, implementing graceful degradation:
    if one or more council models encounter an error, deliberation proceeds with the surviving models.

    Args:
        models (List[str]): List of OpenRouter model identifiers to query.
        messages (List[Dict[str, str]]): List of chat message dicts to send to every model.
        timeout (float): Global timeout in seconds for all models to complete. Defaults to 180.0.

    Returns:
        Dict[str, Optional[Dict[str, Any]]]: Mapping of model identifier to response dict
            (or None if that specific model failed or timed out).
    """
    # Create concurrent query tasks for all models
    tasks = [
        asyncio.create_task(query_model(model, messages, timeout=timeout))
        for model in models
    ]

    try:
        responses = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True), timeout=timeout
        )
    except asyncio.TimeoutError:
        # Cancel any tasks that are still running and mark them as timed out
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
        # Normalize any captured exceptions to None for graceful degradation
        normalized = []
        for response in responses:
            if isinstance(response, Exception):
                normalized.append(None)
            else:
                normalized.append(response)
        responses = normalized

    # Map models to their respective responses
    return {model: response for model, response in zip(models, responses)}

