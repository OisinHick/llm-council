"""Configuration and settings management for the LLM Council.

This module manages application-wide configuration values, environment variables,
default AI model choices, and user-configurable settings.

Key Responsibilities:
    1. Directory & File Paths:
       - Computes absolute paths for base project directory, conversation database
         directory (`data/conversations/`), and runtime settings file (`data/settings.json`).
    2. Default Council & Chairman Setup:
       - Configures default council models for Stage 1/2 deliberations.
       - Configures default chairman model for Stage 3 synthesis and autonomous execution.
    3. Persistent Runtime Settings:
       - Reads user-customized preferences from `data/settings.json`.
       - Provides atomic file persistence via temporary files and `os.fsync` to eliminate
         any risk of file corruption or partial writes during sudden process shutdown.
    4. Configuration Accessors:
       - Exposes helper getter functions used across backend modules for API keys, model lists,
         token display options, and compression algorithm settings.
"""

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv

# Load environment variables from .env file located in workspace root
load_dotenv()

logger = logging.getLogger("llm_council.config")

# ==============================================================================
# Directory and File System Paths
# ==============================================================================

# Project root directory resolved relative to this file
BASE_DIR: Path = Path(__file__).resolve().parent.parent

# Directory where conversation history JSON files are stored
DATA_DIR: str = str(BASE_DIR / "data" / "conversations")

# Path to the runtime user settings file (data/settings.json)
SETTINGS_FILE: Path = BASE_DIR / "data" / "settings.json"

# Path to persistent custom workflows JSON file (data/workflows.json)
WORKFLOWS_FILE: Path = BASE_DIR / "data" / "workflows.json"

# ==============================================================================
# Model Defaults & OpenRouter Endpoints
# ==============================================================================

# Default peer council members used for multi-perspective deliberations in Stage 1 & Stage 2
DEFAULT_COUNCIL_MODELS: List[str] = [
    "openai/gpt-4o-mini",
    "google/gemini-2.5-flash",
    "anthropic/claude-3-haiku",
    "meta-llama/llama-3.3-70b-instruct",
]

# Default chairman model used for synthesizing final consensus and acting as autonomous agent
DEFAULT_CHAIRMAN_MODEL: str = "google/gemini-2.5-flash"

# Legacy variables kept for backwards compatibility with earlier script versions
OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
COUNCIL_MODELS: List[str] = DEFAULT_COUNCIL_MODELS
CHAIRMAN_MODEL: str = DEFAULT_CHAIRMAN_MODEL

# OpenRouter REST endpoints
OPENROUTER_API_URL: str = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL: str = "https://openrouter.ai/api/v1/models"


# ==============================================================================
# Default Settings Schema
# ==============================================================================

# Default settings dictionary structure used when settings.json is missing or incomplete
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
    "show_all_deliberation_steps": True,
    "assistant_color": "#f6f9ff",
    "user_color": "#f0f7ff",
    "sensitivity_config": {
        "level": "medium",
        "auto_trigger_on_error": False,
        "review_before_completion": False,
        "max_consultations": 5,
        "max_steps": 20,
    },
    "default_mode": "informational",
}


def get_settings() -> Dict[str, Any]:
    """Load active configuration settings from disk with fallback to defaults and environment.

    The configuration hierarchy is evaluated in the following order:
      1. Values explicitly stored in `data/settings.json`.
      2. Environment variables (e.g. `OPENROUTER_API_KEY`).
      3. Hardcoded defaults defined in `DEFAULT_SETTINGS`.

    Handles missing files, unreadable JSON, or malformed data structures gracefully
    by logging a warning and falling back to safe default values.

    Returns:
        Dict[str, Any]: A dictionary containing active configuration flags and values:
            - "openrouter_api_key" (str): OpenRouter authorization bearer key.
            - "council_models" (List[str]): List of model identifier strings for council.
            - "chairman_model" (str): Model identifier string for chairman.
            - "show_token_count" (bool): Whether total token badges are visible in UI.
            - "show_tokens_per_model" (bool): Whether individual per-model breakdowns are shown.
            - "show_spend_value" (bool): Whether estimated dollar spend is displayed.
            - "show_saved_tokens" (bool): Whether saved compression tokens are highlighted.
            - "enable_token_compression" (bool): Whether context compression is active.
            - "compression_algorithm" (str): Active algorithm ('headroom', 'heuristic', 'adaptive').
            - "show_all_deliberation_steps" (bool): Whether all council stages are shown in UI.
            - "assistant_color" (str): Hex color code for assistant response background.
            - "user_color" (str): Hex color code for user message background.
            - "sensitivity_config" (dict): Deliberation sensitivity options for autonomous agent.
            - "default_mode" (str): Initial conversation mode ('informational', 'one_shot', 'agentic', 'custom_workflows').
    """
    env_key = os.getenv("OPENROUTER_API_KEY", "")
    settings = dict(DEFAULT_SETTINGS)
    settings["sensitivity_config"] = dict(DEFAULT_SETTINGS["sensitivity_config"])
    settings["council_models"] = list(DEFAULT_COUNCIL_MODELS)
    settings["openrouter_api_key"] = env_key

    # If settings file does not exist yet, return baseline defaults
    if not SETTINGS_FILE.exists():
        return settings

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict):
            logger.warning("settings.json content is not a dictionary; using defaults.")
            return settings

        # Merge persisted values with defaults, prioritizing persisted non-empty values
        if "openrouter_api_key" in data and isinstance(data["openrouter_api_key"], str):
            settings["openrouter_api_key"] = data["openrouter_api_key"] or env_key

        if "council_models" in data and isinstance(data["council_models"], list):
            valid_models = [m.strip() for m in data["council_models"] if isinstance(m, str) and m.strip()]
            if valid_models:
                settings["council_models"] = valid_models

        if "chairman_model" in data and isinstance(data["chairman_model"], str):
            cm = data["chairman_model"].strip()
            if cm:
                settings["chairman_model"] = cm

        # Boolean flags with fallback defaults
        for flag in (
            "show_token_count",
            "show_tokens_per_model",
            "show_spend_value",
            "show_saved_tokens",
            "enable_token_compression",
            "show_all_deliberation_steps",
        ):
            if flag in data and data[flag] is not None:
                settings[flag] = bool(data[flag])

        if "compression_algorithm" in data and isinstance(data["compression_algorithm"], str):
            ca = data["compression_algorithm"].strip()
            if ca:
                settings["compression_algorithm"] = ca

        if "assistant_color" in data and isinstance(data["assistant_color"], str):
            ac = data["assistant_color"].strip()
            if ac:
                settings["assistant_color"] = ac

        if "user_color" in data and isinstance(data["user_color"], str):
            uc = data["user_color"].strip()
            if uc:
                settings["user_color"] = uc

        if "sensitivity_config" in data and isinstance(data["sensitivity_config"], dict):
            merged_sens = dict(settings["sensitivity_config"])
            merged_sens.update(data["sensitivity_config"])
            settings["sensitivity_config"] = merged_sens

        if "default_mode" in data and isinstance(data["default_mode"], str):
            dm = data["default_mode"].strip()
            if dm in ("informational", "one_shot", "agentic", "custom_workflows"):
                settings["default_mode"] = dm

        return settings
    except Exception as e:
        logger.error("Failed to read settings file %s: %s; falling back to defaults.", SETTINGS_FILE, e)
        return settings


def save_settings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Save updated settings to `data/settings.json` using an atomic file write pattern.

    To protect against corrupted configuration files in the event of power failures,
    abrupt terminations, or concurrent writes, this function writes the new settings
    to a temporary file on the same filesystem, calls `os.fsync` to guarantee data
    is flushed to physical disk, and then atomically replaces the target file via `os.replace`.

    Args:
        new_settings (Dict[str, Any]): Dictionary containing partial or complete updated settings.
            Supported keys include:
                - "openrouter_api_key" (str): API key string.
                - "council_models" (List[str]): Non-empty list of model identifier strings.
                - "chairman_model" (str): Non-empty chairman model identifier.
                - "show_token_count" (bool): UI display flag.
                - "show_tokens_per_model" (bool): UI display flag.
                - "show_spend_value" (bool): UI display flag.
                - "show_saved_tokens" (bool): UI display flag.
                - "enable_token_compression" (bool): Compression toggle.
                - "compression_algorithm" (str): Compression algorithm name.
                - "show_all_deliberation_steps" (bool): UI deliberation stages display flag.
                - "assistant_color" (str): Custom assistant message background color.
                - "user_color" (str): Custom user message background color.
                - "sensitivity_config" (dict): ReAct agent deliberation sensitivity options.
                - "default_mode" (str): Default conversation mode.

    Returns:
        Dict[str, Any]: The complete, merged settings dictionary after updates are applied.

    Raises:
        Exception: If writing the temporary file or replacing `SETTINGS_FILE` fails.
    """
    current = get_settings()

    # Update API key if provided
    if "openrouter_api_key" in new_settings and new_settings["openrouter_api_key"] is not None:
        current["openrouter_api_key"] = str(new_settings["openrouter_api_key"]).strip()

    # Validate and update council model list
    if "council_models" in new_settings and isinstance(new_settings["council_models"], list):
        models = [m.strip() for m in new_settings["council_models"] if isinstance(m, str) and m.strip()]
        if models:
            current["council_models"] = models

    # Update chairman model if non-empty string provided
    if "chairman_model" in new_settings and isinstance(new_settings["chairman_model"], str):
        cm = new_settings["chairman_model"].strip()
        if cm:
            current["chairman_model"] = cm

    # Update boolean UI and compression flags
    for flag in (
        "show_token_count",
        "show_tokens_per_model",
        "show_spend_value",
        "show_saved_tokens",
        "enable_token_compression",
        "show_all_deliberation_steps",
    ):
        if flag in new_settings and new_settings[flag] is not None:
            current[flag] = bool(new_settings[flag])

    # Update compression algorithm identifier
    if "compression_algorithm" in new_settings and isinstance(new_settings["compression_algorithm"], str):
        ca = new_settings["compression_algorithm"].strip()
        if ca:
            current["compression_algorithm"] = ca

    # Update styling colors
    if "assistant_color" in new_settings and isinstance(new_settings["assistant_color"], str):
        ac = new_settings["assistant_color"].strip()
        if ac:
            current["assistant_color"] = ac

    if "user_color" in new_settings and isinstance(new_settings["user_color"], str):
        uc = new_settings["user_color"].strip()
        if uc:
            current["user_color"] = uc

    # Update sensitivity config
    if "sensitivity_config" in new_settings and isinstance(new_settings["sensitivity_config"], dict):
        current_cfg = dict(current.get("sensitivity_config") or DEFAULT_SETTINGS["sensitivity_config"])
        current_cfg.update(new_settings["sensitivity_config"])
        current["sensitivity_config"] = current_cfg

    # Update default conversation mode
    if "default_mode" in new_settings and isinstance(new_settings["default_mode"], str):
        dm = new_settings["default_mode"].strip()
        if dm in ("informational", "one_shot", "agentic", "custom_workflows"):
            current["default_mode"] = dm

    # Atomic write to prevent file corruption on abrupt shutdowns:
    # 1. Create a temporary file in the same directory (same filesystem).
    # 2. Dump formatted JSON.
    # 3. Flush and fsync the file descriptor.
    # 4. Atomically rename/replace the temporary file onto SETTINGS_FILE.
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
    """Get the active OpenRouter API key from configuration or environment.

    Returns:
        str: The API key string, or an empty string if not configured.
    """
    settings = get_settings()
    return settings.get("openrouter_api_key") or os.getenv("OPENROUTER_API_KEY", "")


def get_council_models() -> List[str]:
    """Get the active list of model identifiers participating in Stage 1 & Stage 2 council deliberation.

    Returns:
        List[str]: List of OpenRouter model identifier strings (e.g., ['openai/gpt-4o-mini', ...]).
    """
    settings = get_settings()
    return settings.get("council_models") or DEFAULT_COUNCIL_MODELS


def get_chairman_model() -> str:
    """Get the active model identifier responsible for Stage 3 synthesis and agent execution.

    Returns:
        str: OpenRouter model identifier string (e.g., 'google/gemini-2.5-flash').
    """
    settings = get_settings()
    return settings.get("chairman_model") or DEFAULT_CHAIRMAN_MODEL


def get_show_token_count() -> bool:
    """Check whether token count badges should be displayed in the UI.

    Returns:
        bool: True if token counts are enabled, False otherwise.
    """
    settings = get_settings()
    return bool(settings.get("show_token_count", True))


def get_show_tokens_per_model() -> bool:
    """Check whether detailed token usage breakdowns per individual model are enabled.

    Returns:
        bool: True if per-model breakdown is enabled, False otherwise.
    """
    settings = get_settings()
    return bool(settings.get("show_tokens_per_model", False))


def get_show_spend_value() -> bool:
    """Check whether estimated dollar spend should be displayed in the UI.

    Returns:
        bool: True if dollar spend is enabled, False otherwise.
    """
    settings = get_settings()
    return bool(settings.get("show_spend_value", True))


def get_show_saved_tokens() -> bool:
    """Check whether token savings from compression should be highlighted in the UI.

    Returns:
        bool: True if saved token statistics should be displayed, False otherwise.
    """
    settings = get_settings()
    return bool(settings.get("show_saved_tokens", True))


def get_enable_token_compression() -> bool:
    """Check whether prompt/context compression is globally enabled for outgoing requests.

    Returns:
        bool: True if compression is enabled, False otherwise.
    """
    settings = get_settings()
    return bool(settings.get("enable_token_compression", False))


def get_compression_algorithm() -> str:
    """Get the active compression algorithm identifier.

    Returns:
        str: Algorithm name: 'headroom', 'heuristic', or 'adaptive'. Defaults to 'headroom'.
    """
    settings = get_settings()
    return str(settings.get("compression_algorithm", "headroom"))


def get_show_all_deliberation_steps() -> bool:
    """Check whether all council deliberation stages should be shown in UI.

    Returns:
        bool: True to show all stages (Stage 1, 2, 3), False to show only final answer.
    """
    settings = get_settings()
    return bool(settings.get("show_all_deliberation_steps", True))


def get_assistant_color() -> str:
    """Get the configured background color hex string for assistant messages.

    Returns:
        str: Hex color code (e.g., '#f6f9ff').
    """
    settings = get_settings()
    return str(settings.get("assistant_color", "#f6f9ff"))


def get_user_color() -> str:
    """Get the configured background color hex string for user messages.

    Returns:
        str: Hex color code (e.g., '#f0f7ff').
    """
    settings = get_settings()
    return str(settings.get("user_color", "#f0f7ff"))


def get_sensitivity_config() -> Dict[str, Any]:
    """Get the active deliberation sensitivity configuration dictionary for autonomous agents.

    Returns:
        Dict[str, Any]: Dictionary containing sensitivity flags and limits:
            - level: 'low' | 'medium' | 'high' | 'extreme'
            - auto_trigger_on_error: bool
            - review_before_completion: bool
            - max_consultations: int
            - max_steps: int
    """
    settings = get_settings()
    return dict(settings.get("sensitivity_config") or DEFAULT_SETTINGS["sensitivity_config"])


def get_default_mode() -> str:
    """Get the default conversation operational mode.

    Returns:
        str: Operational mode name ('informational', 'one_shot', 'agentic', or 'custom_workflows').
    """
    settings = get_settings()
    return str(settings.get("default_mode", "informational"))


