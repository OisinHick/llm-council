"""Configuration for the LLM Council."""

import json
import os
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv

load_dotenv()

# Data directory for conversation storage (absolute path)
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = str(BASE_DIR / "data" / "conversations")
SETTINGS_FILE = BASE_DIR / "data" / "settings.json"

# Default configuration values
DEFAULT_COUNCIL_MODELS = [
    "openai/gpt-4o-mini",
    "google/gemini-2.5-flash",
    "anthropic/claude-3-haiku",
    "meta-llama/llama-3.3-70b-instruct",
]

DEFAULT_CHAIRMAN_MODEL = "google/gemini-2.5-flash"

# Legacy variables for backwards compatibility
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
COUNCIL_MODELS = DEFAULT_COUNCIL_MODELS
CHAIRMAN_MODEL = DEFAULT_CHAIRMAN_MODEL

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


def get_settings() -> Dict[str, Any]:
    """Load settings from JSON file or default values."""
    env_key = os.getenv("OPENROUTER_API_KEY", "")
    default_settings = {
        "openrouter_api_key": env_key,
        "council_models": DEFAULT_COUNCIL_MODELS,
        "chairman_model": DEFAULT_CHAIRMAN_MODEL,
        "show_token_count": True,
        "show_tokens_per_model": False,
        "show_spend_value": True,
    }

    if not SETTINGS_FILE.exists():
        return default_settings

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        return {
            "openrouter_api_key": data.get("openrouter_api_key") or env_key,
            "council_models": data.get("council_models") or DEFAULT_COUNCIL_MODELS,
            "chairman_model": data.get("chairman_model") or DEFAULT_CHAIRMAN_MODEL,
            "show_token_count": data.get("show_token_count", True) if "show_token_count" in data else True,
            "show_tokens_per_model": data.get("show_tokens_per_model", False) if "show_tokens_per_model" in data else False,
            "show_spend_value": data.get("show_spend_value", True) if "show_spend_value" in data else True,
        }
    except Exception:
        return default_settings


def save_settings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Save updated settings to file."""
    current = get_settings()

    if "openrouter_api_key" in new_settings and new_settings["openrouter_api_key"] is not None:
        current["openrouter_api_key"] = str(new_settings["openrouter_api_key"]).strip()

    if "council_models" in new_settings and isinstance(new_settings["council_models"], list):
        # Filter non-empty strings
        models = [m.strip() for m in new_settings["council_models"] if isinstance(m, str) and m.strip()]
        if models:
            current["council_models"] = models

    if "chairman_model" in new_settings and isinstance(new_settings["chairman_model"], str):
        cm = new_settings["chairman_model"].strip()
        if cm:
            current["chairman_model"] = cm

    if "show_token_count" in new_settings and new_settings["show_token_count"] is not None:
        current["show_token_count"] = bool(new_settings["show_token_count"])

    if "show_tokens_per_model" in new_settings and new_settings["show_tokens_per_model"] is not None:
        current["show_tokens_per_model"] = bool(new_settings["show_tokens_per_model"])

    if "show_spend_value" in new_settings and new_settings["show_spend_value"] is not None:
        current["show_spend_value"] = bool(new_settings["show_spend_value"])

    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)

    return current


def get_openrouter_api_key() -> str:
    """Get the active OpenRouter API key."""
    settings = get_settings()
    return settings.get("openrouter_api_key") or os.getenv("OPENROUTER_API_KEY", "")


def get_council_models() -> List[str]:
    """Get the active list of council models."""
    settings = get_settings()
    return settings.get("council_models") or DEFAULT_COUNCIL_MODELS


def get_chairman_model() -> str:
    """Get the active chairman model."""
    settings = get_settings()
    return settings.get("chairman_model") or DEFAULT_CHAIRMAN_MODEL


def get_show_token_count() -> bool:
    """Get setting for showing token count."""
    settings = get_settings()
    return bool(settings.get("show_token_count", True))


def get_show_tokens_per_model() -> bool:
    """Get setting for showing tokens per model."""
    settings = get_settings()
    return bool(settings.get("show_tokens_per_model", False))


def get_show_spend_value() -> bool:
    """Get setting for showing spend value."""
    settings = get_settings()
    return bool(settings.get("show_spend_value", True))

