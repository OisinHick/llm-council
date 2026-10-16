"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DATA_DIR
from .openrouter import calculate_token_cost


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def empty_token_usage() -> Dict[str, Any]:
    """Return an empty token usage structure."""
    return {
        "total_tokens": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "tokens_saved": 0,
        "total_cost": 0.0,
        "total_cost_saved": 0.0,
        "by_model": {},
    }


def _accumulate_model_tokens(
    target: Dict[str, Any],
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: Optional[int] = None,
    tokens_saved: int = 0,
):
    """Accumulate token counts into target dictionary."""
    if not model:
        return
    p = int(prompt_tokens or 0)
    c = int(completion_tokens or 0)
    t = int(total_tokens if total_tokens is not None else (p + c))
    s = int(tokens_saved or 0)

    target["prompt_tokens"] = target.get("prompt_tokens", 0) + p
    target["completion_tokens"] = target.get("completion_tokens", 0) + c
    target["total_tokens"] = target.get("total_tokens", 0) + t
    target["tokens_saved"] = target.get("tokens_saved", 0) + s

    by_model = target.setdefault("by_model", {})
    if model not in by_model:
        by_model[model] = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "tokens_saved": 0,
        }
    by_model[model]["prompt_tokens"] += p
    by_model[model]["completion_tokens"] += c
    by_model[model]["total_tokens"] += t
    by_model[model]["tokens_saved"] = by_model[model].get("tokens_saved", 0) + s


def merge_token_usages(
    usage_a: Optional[Dict[str, Any]], usage_b: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Merge two token usage dictionaries together."""
    result = empty_token_usage()
    for usage in (usage_a, usage_b):
        if not usage or not isinstance(usage, dict):
            continue
        by_m = usage.get("by_model")
        if by_m and isinstance(by_m, dict):
            for model, m_data in by_m.items():
                if isinstance(m_data, dict):
                    _accumulate_model_tokens(
                        result,
                        model,
                        m_data.get("prompt_tokens", 0),
                        m_data.get("completion_tokens", 0),
                        m_data.get("total_tokens"),
                        tokens_saved=m_data.get("tokens_saved", 0),
                    )
        else:
            p = int(usage.get("prompt_tokens") or 0)
            c = int(usage.get("completion_tokens") or 0)
            t = int(
                usage.get("total_tokens")
                if usage.get("total_tokens") is not None
                else (p + c)
            )
            s = int(usage.get("tokens_saved") or 0)
            result["prompt_tokens"] += p
            result["completion_tokens"] += c
            result["total_tokens"] += t
            result["tokens_saved"] += s
    calculate_token_cost(result)
    return result


def compute_turn_token_usage(
    stage1: Optional[List[Dict[str, Any]]] = None,
    stage2: Optional[List[Dict[str, Any]]] = None,
    stage3: Optional[Dict[str, Any]] = None,
    stage4: Optional[Dict[str, Any]] = None,
    steps: Optional[List[Dict[str, Any]]] = None,
    extra_usages: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Calculate token usage for a single assistant turn."""
    usage_result = empty_token_usage()

    if stage1:
        for r in stage1:
            m = r.get("model")
            u = r.get("usage")
            if u:
                _accumulate_model_tokens(
                    usage_result,
                    m,
                    u.get("prompt_tokens", 0),
                    u.get("completion_tokens", 0),
                    u.get("total_tokens"),
                    tokens_saved=u.get("tokens_saved", 0),
                )
            elif m and r.get("response"):
                _accumulate_model_tokens(
                    usage_result, m, 50, len(r["response"]) // 4
                )

    if stage2:
        for r in stage2:
            m = r.get("model")
            u = r.get("usage")
            if u:
                _accumulate_model_tokens(
                    usage_result,
                    m,
                    u.get("prompt_tokens", 0),
                    u.get("completion_tokens", 0),
                    u.get("total_tokens"),
                    tokens_saved=u.get("tokens_saved", 0),
                )
            elif m and r.get("ranking"):
                _accumulate_model_tokens(
                    usage_result, m, 200, len(r["ranking"]) // 4
                )

    if stage3:
        m = stage3.get("model")
        u = stage3.get("usage")
        if u:
            _accumulate_model_tokens(
                usage_result,
                m,
                u.get("prompt_tokens", 0),
                u.get("completion_tokens", 0),
                u.get("total_tokens"),
                tokens_saved=u.get("tokens_saved", 0),
            )
        elif m and stage3.get("response"):
            _accumulate_model_tokens(
                usage_result, m, 400, len(stage3["response"]) // 4
            )

    if stage4:
        m = stage4.get("model") or "chairman"
        u = stage4.get("usage")
        if u:
            _accumulate_model_tokens(
                usage_result,
                m,
                u.get("prompt_tokens", 0),
                u.get("completion_tokens", 0),
                u.get("total_tokens"),
                tokens_saved=u.get("tokens_saved", 0),
            )

    if steps:
        for step in steps:
            u = step.get("usage")
            m = step.get("model") or "chairperson"
            if u:
                _accumulate_model_tokens(
                    usage_result,
                    m,
                    u.get("prompt_tokens", 0),
                    u.get("completion_tokens", 0),
                    u.get("total_tokens"),
                    tokens_saved=u.get("tokens_saved", 0),
                )
            elif step.get("action"):
                act_str = json.dumps(step["action"])
                _accumulate_model_tokens(
                    usage_result, m, 400, len(act_str) // 4
                )

    if extra_usages:
        for item in extra_usages:
            m = item.get("model")
            u = item.get("usage") or {}
            _accumulate_model_tokens(
                usage_result,
                m,
                u.get("prompt_tokens", 0),
                u.get("completion_tokens", 0),
                u.get("total_tokens"),
                tokens_saved=u.get("tokens_saved", 0),
            )

    calculate_token_cost(usage_result)
    return usage_result


def compute_conversation_token_usage(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute total token usage across all messages in a conversation,
    including standalone tokens (such as title generation).
    """
    total_usage = empty_token_usage()

    # Accumulate standalone tokens (e.g. title generation)
    standalone = conversation.get("standalone_token_usage")
    if standalone and isinstance(standalone, dict):
        total_usage = merge_token_usages(total_usage, standalone)

    for msg in conversation.get("messages", []):
        if msg.get("role") != "assistant":
            continue

        if msg.get("token_usage") and isinstance(msg["token_usage"], dict):
            total_usage = merge_token_usages(total_usage, msg["token_usage"])
        else:
            # Fallback estimation for legacy assistant messages
            turn_usage = compute_turn_token_usage(
                stage1=msg.get("stage1"),
                stage2=msg.get("stage2"),
                stage3=msg.get("stage3"),
                stage4=msg.get("stage4"),
                steps=msg.get("steps"),
            )
            total_usage = merge_token_usages(total_usage, turn_usage)

    calculate_token_cost(total_usage)
    return total_usage


def record_standalone_tokens(
    conversation_id: str, model: str, usage: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """Record standalone tokens for a conversation (e.g. from title generation)."""
    if not usage:
        return None
    conversation = get_conversation(conversation_id)
    if not conversation:
        return None

    standalone = conversation.get("standalone_token_usage") or empty_token_usage()
    _accumulate_model_tokens(
        standalone,
        model,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        usage.get("total_tokens"),
    )
    conversation["standalone_token_usage"] = standalone
    conversation["token_usage"] = compute_conversation_token_usage(conversation)
    save_conversation(conversation)
    return conversation["token_usage"]


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
        "token_usage": empty_token_usage(),
        "standalone_token_usage": empty_token_usage(),
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
    for msg in data.get("messages", []):
        if msg.get("role") == "assistant" and msg.get("token_usage"):
            calculate_token_cost(msg["token_usage"])
    data["token_usage"] = compute_conversation_token_usage(data)
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
                        "token_usage": compute_conversation_token_usage(data),
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
    token_usage: Optional[Dict[str, Any]] = None,
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
        token_usage: Optional explicit token usage for this turn
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    turn_tokens = token_usage or compute_turn_token_usage(
        stage1=stage1,
        stage2=stage2,
        stage3=stage3,
        stage4=stage4,
    )

    message = {
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
        "token_usage": turn_tokens,
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

    conversation["token_usage"] = compute_conversation_token_usage(conversation)
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
    token_usage: Optional[Dict[str, Any]] = None,
):
    """
    Add an agent run message to a conversation.
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    council_tokens = compute_turn_token_usage(
        stage1=initial_council.get("stage1"),
        stage2=initial_council.get("stage2"),
        stage3=initial_council.get("stage3"),
    )
    step_tokens = compute_turn_token_usage(steps=steps)
    turn_tokens = merge_token_usages(council_tokens, step_tokens)
    if token_usage:
        turn_tokens = merge_token_usages(turn_tokens, token_usage)

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
        "token_usage": turn_tokens,
    }

    conversation["messages"].append(message)
    conversation["mode"] = "agentic"
    conversation["token_usage"] = compute_conversation_token_usage(conversation)
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
