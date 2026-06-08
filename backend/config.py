"""Configuration for the LLM Council."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Data directory for conversation storage (absolute path)
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = str(BASE_DIR / "data" / "conversations")

# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "openai/gpt-chat-latest",
    "~google/gemini-pro-latest",
    "anthropic/claude-opus-4.8",
    "x-ai/grok-4.3",
]

CHAIRMAN_MODEL = "stepfun/step-3.7-flash"

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# MCP Servers Configuration
MCP_SERVERS = {
    "kali-tools": {
        "command": "uvx",
        "args": ["zebbern-kali-mcp"]
    }
}
