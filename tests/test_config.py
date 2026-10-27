import tempfile
from pathlib import Path
from unittest.mock import patch

from backend.config import (
    DEFAULT_CHAIRMAN_MODEL,
    DEFAULT_COUNCIL_MODELS,
    get_assistant_color,
    get_chairman_model,
    get_compression_algorithm,
    get_council_models,
    get_default_mode,
    get_enable_token_compression,
    get_openrouter_api_key,
    get_sensitivity_config,
    get_settings,
    get_show_all_deliberation_steps,
    get_show_saved_tokens,
    get_show_spend_value,
    get_show_token_count,
    get_show_tokens_per_model,
    get_user_color,
    save_settings,
)


def test_get_settings_defaults():
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_settings_file = Path(tmp_dir) / "settings.json"
        with patch("backend.config.SETTINGS_FILE", fake_settings_file):
            settings = get_settings()
            assert settings["council_models"] == DEFAULT_COUNCIL_MODELS
            assert settings["chairman_model"] == DEFAULT_CHAIRMAN_MODEL
            assert settings["show_token_count"] is True
            assert settings["compression_algorithm"] == "headroom"
            assert settings["default_mode"] == "informational"


def test_save_and_get_settings():
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_settings_file = Path(tmp_dir) / "data" / "settings.json"
        with patch("backend.config.SETTINGS_FILE", fake_settings_file):
            new_data = {
                "openrouter_api_key": "sk-test-key-12345",
                "council_models": ["model-a", "model-b"],
                "chairman_model": "model-c",
                "show_token_count": False,
                "show_tokens_per_model": True,
                "show_spend_value": False,
                "show_saved_tokens": False,
                "enable_token_compression": True,
                "compression_algorithm": "heuristic",
                "show_all_deliberation_steps": False,
                "assistant_color": "#112233",
                "user_color": "#445566",
                "sensitivity_config": {"level": "high", "max_steps": 42},
                "default_mode": "agentic",
            }
            saved = save_settings(new_data)
            assert saved["openrouter_api_key"] == "sk-test-key-12345"
            assert saved["council_models"] == ["model-a", "model-b"]
            assert saved["chairman_model"] == "model-c"
            assert saved["show_token_count"] is False
            assert saved["show_tokens_per_model"] is True
            assert saved["enable_token_compression"] is True
            assert saved["compression_algorithm"] == "heuristic"
            assert saved["assistant_color"] == "#112233"
            assert saved["user_color"] == "#445566"
            assert saved["default_mode"] == "agentic"
            assert saved["sensitivity_config"]["level"] == "high"
            assert saved["sensitivity_config"]["max_steps"] == 42

            # Test helper getters
            assert get_openrouter_api_key() == "sk-test-key-12345"
            assert get_council_models() == ["model-a", "model-b"]
            assert get_chairman_model() == "model-c"
            assert get_show_token_count() is False
            assert get_show_tokens_per_model() is True
            assert get_show_spend_value() is False
            assert get_show_saved_tokens() is False
            assert get_enable_token_compression() is True
            assert get_compression_algorithm() == "heuristic"
            assert get_show_all_deliberation_steps() is False
            assert get_assistant_color() == "#112233"
            assert get_user_color() == "#445566"
            assert get_default_mode() == "agentic"
            assert get_sensitivity_config()["level"] == "high"
