"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DATA_DIR


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def create_conversation(
    conversation_id: str, mode: str = "informational"
) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation
        mode: Initial mode ('informational', 'one_shot', 'agentic')

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": "New Conversation",
        "mode": mode,
        "messages": [],
    }

    # Save to file
    path = get_conversation_path(conversation_id)
    with open(path, "w") as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation_mode_from_messages(
    messages: List[Dict[str, Any]], fallback: str = "informational"
) -> str:
    """
    Determine the conversation mode based on the last produced assistant response.
    """
    for message in reversed(messages):
        if message.get("role") == "assistant":
            if message.get("type") == "agent":
                return "agentic"
            if message.get("stage4") is not None or (
                message.get("action_request") and message.get("type") != "agent"
            ):
                return "one_shot"
            return "informational"
    return fallback


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    with open(path, "r") as f:
        data = json.load(f)

    data["mode"] = get_conversation_mode_from_messages(
        data.get("messages", []), fallback=data.get("mode", "informational")
    )
    return data


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()

    path = get_conversation_path(conversation["id"])
    with open(path, "w") as f:
        json.dump(conversation, f, indent=2)


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".json"):
            path = os.path.join(DATA_DIR, filename)
            with open(path, "r") as f:
                data = json.load(f)
                messages = data.get("messages", [])
                mode = get_conversation_mode_from_messages(
                    messages, fallback=data.get("mode", "informational")
                )
                conversations.append(
                    {
                        "id": data["id"],
                        "created_at": data["created_at"],
                        "title": data.get("title", "New Conversation"),
                        "message_count": len(messages),
                        "mode": mode,
                    }
                )

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({"role": "user", "content": content})

    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    stage4: Optional[Dict[str, Any]] = None,
    execution: Optional[Dict[str, Any]] = None,
    action_request: Optional[str] = None,
):
    """
    Add an assistant message with optional action plan information to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        stage4: Optional action plan result
        execution: Optional execution results
        action_request: Optional original action request text
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
    }

    if action_request is not None:
        message["action_request"] = action_request
    if stage4 is not None:
        message["stage4"] = stage4
    if execution is not None:
        message["execution"] = execution

    conversation["messages"].append(message)
    if stage4 is not None or action_request is not None:
        conversation["mode"] = "one_shot"
    else:
        conversation["mode"] = "informational"

    save_conversation(conversation)


def add_agent_message(
    conversation_id: str,
    user_request: str,
    initial_council: Dict[str, Any],
    steps: List[Dict[str, Any]],
    artifacts: List[str],
    summary: Optional[str] = None,
    error: Optional[str] = None,
    status: str = "completed",
):
    """
    Add an agent run message to a conversation.
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "type": "agent",
        "action_request": user_request,
        "initial_council": initial_council,
        "steps": steps,
        "artifacts": artifacts,
        "summary": summary,
        "error": error,
        "status": status,
        "stage1": initial_council.get("stage1", []),
        "stage2": initial_council.get("stage2", []),
        "stage3": initial_council.get("stage3", {}),
        "metadata": initial_council.get("metadata", {}),
    }

    conversation["messages"].append(message)
    conversation["mode"] = "agentic"
    save_conversation(conversation)


def update_last_assistant_message(conversation_id: str, updater):

    """
    Update the most recent assistant message in a conversation.

    Args:
        conversation_id: Conversation identifier
        updater: A callable that accepts the last assistant message dict and returns an updated dict
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    for idx in range(len(conversation["messages"]) - 1, -1, -1):
        message = conversation["messages"][idx]
        if message.get("role") == "assistant":
            conversation["messages"][idx] = updater(message)
            save_conversation(conversation)
            return conversation["messages"][idx]

    raise ValueError(f"No assistant message found in conversation {conversation_id}")


def update_conversation_title(conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)


def update_conversation_mode(
    conversation_id: str, mode: str
) -> Optional[Dict[str, Any]]:
    """
    Update the mode of a conversation.

    Args:
        conversation_id: Conversation identifier
        mode: New mode ('informational', 'one_shot', 'agentic')
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return None

    conversation["mode"] = mode
    save_conversation(conversation)
    return conversation
