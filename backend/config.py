"""Configuration for the LLM Council."""

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("llm_council.config")

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


# Default settings schema used when settings file is absent or incomplete
DEFAULT_SETTINGS: Dict[str, Any] = {
    "openrouter_api_key": "",
    "council_models": DEFAULT_COUNCIL_MODELS,
    "chairman_model": DEFAULT_CHAIRMAN_MODEL,
    "show_token_count": True,
    "show_tokens_per_model": False,
    "show_spend_value": True,
    "show_saved_tokens": True,
    "enable_token_compression": False,
    "compression_algorithm": "headroom",
}


def get_settings() -> Dict[str, Any]:
    """
    Load active settings from data/settings.json or return default values.
    
    Falls back to environment variables (e.g. OPENROUTER_API_KEY) if not
    configured in the JSON file. Catches and logs any corrupt file errors.
    """
    env_key = os.getenv("OPENROUTER_API_KEY", "")
    settings = dict(DEFAULT_SETTINGS)
    settings["openrouter_api_key"] = env_key

    if not SETTINGS_FILE.exists():
        return settings

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict):
            logger.warning("settings.json content is not a dictionary; using defaults.")
            return settings

        # Merge persisted values with defaults
        settings["openrouter_api_key"] = data.get("openrouter_api_key") or env_key
        settings["council_models"] = data.get("council_models") or DEFAULT_COUNCIL_MODELS
        settings["chairman_model"] = data.get("chairman_model") or DEFAULT_CHAIRMAN_MODEL

        # Boolean flags with fallback defaults
        for flag in (
            "show_token_count",
            "show_tokens_per_model",
            "show_spend_value",
            "show_saved_tokens",
            "enable_token_compression",
        ):
            if flag in data:
                settings[flag] = bool(data[flag])

        if "compression_algorithm" in data and isinstance(data["compression_algorithm"], str):
            settings["compression_algorithm"] = data["compression_algorithm"].strip()

        return settings
    except Exception as e:
        logger.error("Failed to read settings file %s: %s; falling back to defaults.", SETTINGS_FILE, e)
        return settings


def save_settings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    """
    Save updated settings to data/settings.json using atomic file writing.
    
    Args:
        new_settings: Dictionary containing partial or complete updated settings.

    Returns:
        The updated complete settings dictionary.
    """
    current = get_settings()

    if "openrouter_api_key" in new_settings and new_settings["openrouter_api_key"] is not None:
        current["openrouter_api_key"] = str(new_settings["openrouter_api_key"]).strip()

    if "council_models" in new_settings and isinstance(new_settings["council_models"], list):
        models = [m.strip() for m in new_settings["council_models"] if isinstance(m, str) and m.strip()]
        if models:
            current["council_models"] = models

    if "chairman_model" in new_settings and isinstance(new_settings["chairman_model"], str):
        cm = new_settings["chairman_model"].strip()
        if cm:
            current["chairman_model"] = cm

    for flag in (
        "show_token_count",
        "show_tokens_per_model",
        "show_spend_value",
        "show_saved_tokens",
        "enable_token_compression",
    ):
        if flag in new_settings and new_settings[flag] is not None:
            current[flag] = bool(new_settings[flag])

    if "compression_algorithm" in new_settings and isinstance(new_settings["compression_algorithm"], str):
        ca = new_settings["compression_algorithm"].strip()
        if ca:
            current["compression_algorithm"] = ca

    # Atomic write to prevent file corruption on abrupt shutdowns
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            dir=str(SETTINGS_FILE.parent),
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as f:
            temp_file = Path(f.name)
            json.dump(current, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        temp_file.replace(SETTINGS_FILE)
    except Exception as e:
        logger.error("Failed to safely write settings file %s: %s", SETTINGS_FILE, e)
        if temp_file and temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass
        raise

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


def get_show_saved_tokens() -> bool:
    """Get setting for showing saved tokens."""
    settings = get_settings()
    return bool(settings.get("show_saved_tokens", True))


def get_enable_token_compression() -> bool:
    """Get setting for token compression enabled/disabled."""
    settings = get_settings()
    return bool(settings.get("enable_token_compression", False))


def get_compression_algorithm() -> str:
    """Get active compression algorithm ('headroom', 'heuristic', 'adaptive')."""
    settings = get_settings()
    return str(settings.get("compression_algorithm", "headroom"))

