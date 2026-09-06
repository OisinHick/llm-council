"""OpenRouter API client for making LLM requests."""

import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

from .config import OPENROUTER_API_URL, OPENROUTER_MODELS_URL, get_openrouter_api_key

logger = logging.getLogger(__name__)


async def fetch_openrouter_models(api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetch list of available models from OpenRouter API.

    Args:
        api_key: Optional OpenRouter API key override

    Returns:
        List of dicts containing model 'id', 'name', and 'context_length'
    """
    key = api_key or get_openrouter_api_key()
    if not key:
        raise ValueError("OpenRouter API key is required to fetch models.")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
        response.raise_for_status()

        data = response.json()
        raw_models = data.get("data", [])

        formatted_models = []
        for model in raw_models:
            formatted_models.append({
                "id": model.get("id", ""),
                "name": model.get("name") or model.get("id", ""),
                "context_length": model.get("context_length"),
                "description": model.get("description", ""),
            })

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

    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_API_URL, headers=headers, json=payload
            )
            response.raise_for_status()

            data = response.json()
            message = data["choices"][0]["message"]

            return {
                "content": message.get("content"),
                "reasoning_details": message.get("reasoning_details"),
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

