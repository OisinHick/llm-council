"""JSON-based conversation storage and token accounting for LLM Council.

This module acts as the persistence and data layer for all conversation histories,
message trajectories, autonomous agent execution steps, and token usage statistics.

Storage Architecture:
    - Filesystem Layout:
      Each conversation is stored as an individual JSON document under `data/conversations/<conversation_id>.json`.
    - Document Schema:
        {
            "id": "<uuid-string>",
            "created_at": "<iso-8601-utc-timestamp>",
            "title": "Short Descriptive Title",
            "mode": "informational" | "one_shot" | "agentic" | "custom_workflows",
            "messages": [ ... ],
            "token_usage": {
                "total_tokens": int,
                "prompt_tokens": int,
                "completion_tokens": int,
                "tokens_saved": int,
                "total_cost": float,
                "total_cost_saved": float,
                "by_model": { ... }
            },
            "standalone_token_usage": { ... }
        }

Key Features:
    - Atomic File Writes:
      All write operations write first to a temporary file on the same filesystem and execute
      `os.fsync` before atomically replacing the target file, ensuring zero data loss or partial
      JSON corruption upon abrupt crashes.
    - Comprehensive Token & Spend Tracking:
      Tracks prompt, completion, total, and compression-saved tokens both per-turn and accumulated
      for the entire conversation, dynamically priced via OpenRouter rate tables.
    - Automatic Mode Detection:
      Infers conversation mode ('informational', 'one_shot', 'agentic', 'custom_workflows') from
      message types and assistant execution details to keep metadata consistent.
"""

import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .config import DATA_DIR
from .openrouter import calculate_token_cost

logger = logging.getLogger("llm_council.storage")


def ensure_data_dir() -> Path:
    """Ensure that the conversation storage directory exists on disk.

    Creates any missing parent directories (`data/conversations/`) if they
    do not already exist.

    Returns:
        Path: Path object pointing to the confirmed directory.
    """
    p = Path(DATA_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_write_json(file_path: str, data: Dict[str, Any]) -> None:
    """Safely write JSON data to file using an atomic write pattern via a temporary file.

    Guarantees that the target file is never left in a truncated or partially written state
    if the process is killed or interrupted mid-write.

    Steps:
      1. Ensures the target directory exists.
      2. Creates a temporary file in the same directory (guaranteeing same filesystem mount).
      3. Serializes `data` to JSON with 2-space indentation.
      4. Flushes Python file buffers and issues `os.fsync` to force OS dirty pages to disk.
      5. Uses atomic filesystem replacement (`os.replace`) to swap the temp file over the target.
      6. Cleans up the temporary file if an exception occurs during the process.

    Args:
        file_path (str): Target filesystem path where JSON should be saved.
        data (Dict[str, Any]): Dictionary to serialize into JSON format.

    Raises:
        Exception: If file writing or renaming fails.
    """
    target = Path(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            dir=str(target.parent),
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as f:
            temp_file = Path(f.name)
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        temp_file.replace(target)
    except Exception as e:
        logger.error("Failed to safely write JSON file %s: %s", file_path, e)
        if temp_file and temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass
        raise


def get_conversation_path(conversation_id: str) -> str:
    """Compute the absolute filesystem path for a conversation's JSON storage file.

    Args:
        conversation_id (str): Unique UUID string of the conversation.

    Returns:
        str: Absolute file path (e.g. `/path/to/data/conversations/<conversation_id>.json`).
    """
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def empty_token_usage() -> Dict[str, Any]:
    """Return a baseline zeroed token usage dictionary.

    Returns:
        Dict[str, Any]: A dictionary initialized with:
            - "total_tokens" (int): 0
            - "prompt_tokens" (int): 0
            - "completion_tokens" (int): 0
            - "tokens_saved" (int): 0
            - "total_cost" (float): 0.0
            - "total_cost_saved" (float): 0.0
            - "by_model" (dict): Empty mapping of model_id -> breakdown dictionary.
    """
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
) -> None:
    """Accumulate token counts for a specific model into a target usage dictionary.

    Updates both top-level cumulative counters ('prompt_tokens', 'completion_tokens',
    'total_tokens', 'tokens_saved') and the nested 'by_model' entry for the given model.

    Args:
        target (Dict[str, Any]): Mutable token usage dictionary to accumulate into.
        model (str): OpenRouter model identifier (e.g. 'openai/gpt-4o-mini').
        prompt_tokens (int): Input prompt tokens consumed.
        completion_tokens (int): Output generated tokens consumed.
        total_tokens (Optional[int]): Total tokens. If None, defaults to prompt_tokens + completion_tokens.
        tokens_saved (int): Number of prompt tokens avoided through context compression.
    """
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
    """Merge two token usage dictionaries into a unified usage report.

    Combines prompt, completion, total, and saved tokens from both inputs, merging
    individual model breakdowns and calculating updated dollar spend estimates based
    on cached OpenRouter pricing rates.

    Args:
        usage_a (Optional[Dict[str, Any]]): First usage dictionary (or None).
        usage_b (Optional[Dict[str, Any]]): Second usage dictionary (or None).

    Returns:
        Dict[str, Any]: Newly created merged token usage dictionary with updated costs.
    """
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


def _accumulate_stage_item(
    target: Dict[str, Any],
    item: Optional[Dict[str, Any]],
    default_model: Optional[str] = None,
    fallback_prompt: int = 0,
    fallback_content_key: Optional[str] = None,
) -> None:
    """Helper to accumulate token usage from an individual stage response or agent step.

    If explicit token usage metadata is present in `item['usage']`, it is used directly.
    Otherwise, if a `fallback_content_key` is provided and content is present, a 4-character-per-token
    heuristic estimate is calculated and added as a fallback.

    Args:
        target (Dict[str, Any]): Mutable token usage dictionary to accumulate into.
        item (Optional[Dict[str, Any]]): Individual response item or agent step dictionary.
        default_model (Optional[str]): Fallback model name if item['model'] is missing.
        fallback_prompt (int): Assumed baseline prompt token count for fallback estimation.
        fallback_content_key (Optional[str]): Key in item containing response text to estimate tokens for.
    """
    if not item or not isinstance(item, dict):
        return
    model = item.get("model") or default_model
    usage = item.get("usage")
    if usage and isinstance(usage, dict):
        _accumulate_model_tokens(
            target,
            model,
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            usage.get("total_tokens"),
            tokens_saved=usage.get("tokens_saved", 0),
        )
    elif model and fallback_content_key:
        content = item.get(fallback_content_key)
        if content:
            c_len = len(json.dumps(content)) if isinstance(content, (dict, list)) else len(str(content))
            _accumulate_model_tokens(target, model, fallback_prompt, c_len // 4)


def compute_turn_token_usage(
    stage1: Optional[List[Dict[str, Any]]] = None,
    stage2: Optional[List[Dict[str, Any]]] = None,
    stage3: Optional[Dict[str, Any]] = None,
    stage4: Optional[Dict[str, Any]] = None,
    steps: Optional[List[Dict[str, Any]]] = None,
    extra_usages: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Calculate cumulative token usage and estimated spend for a single assistant turn.

    Aggregates token consumption across all active stages in a turn:
      - Stage 1: Individual candidate answers from all council models.
      - Stage 2: Anonymized peer reviews and rankings from all council models.
      - Stage 3: Final consensus synthesis from Chairman model.
      - Stage 4: MCP action plan generation by Chairman.
      - Steps: Multi-step ReAct execution steps taken by Chairperson agent.
      - Extra Usages: Any additional model queries (e.g. sub-council consultations).

    Args:
        stage1 (Optional[List[Dict[str, Any]]]): List of Stage 1 model responses.
        stage2 (Optional[List[Dict[str, Any]]]): List of Stage 2 ranking evaluations.
        stage3 (Optional[Dict[str, Any]]): Stage 3 synthesized response dict.
        stage4 (Optional[Dict[str, Any]]): Stage 4 action plan result dict.
        steps (Optional[List[Dict[str, Any]]]): ReAct agent step records.
        extra_usages (Optional[List[Dict[str, Any]]]): Additional token usage dicts.

    Returns:
        Dict[str, Any]: Complete token usage dictionary with calculated dollar cost.
    """
    usage_result = empty_token_usage()

    for r in stage1 or []:
        _accumulate_stage_item(usage_result, r, fallback_prompt=50, fallback_content_key="response")

    for r in stage2 or []:
        _accumulate_stage_item(usage_result, r, fallback_prompt=200, fallback_content_key="ranking")

    if stage3:
        _accumulate_stage_item(usage_result, stage3, fallback_prompt=400, fallback_content_key="response")

    if stage4:
        _accumulate_stage_item(usage_result, stage4, default_model="chairman")

    for step in steps or []:
        _accumulate_stage_item(
            usage_result,
            step,
            default_model="chairperson",
            fallback_prompt=400,
            fallback_content_key="action",
        )

    for extra in extra_usages or []:
        _accumulate_stage_item(usage_result, extra)

    calculate_token_cost(usage_result)
    return usage_result


def compute_conversation_token_usage(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """Compute aggregate token usage across an entire conversation.

    Sums tokens across all assistant messages in the conversation, as well as
    standalone tokens (e.g., automated title generation queries), then computes
    the total monetary spend.

    Args:
        conversation (Dict[str, Any]): Full conversation dictionary.

    Returns:
        Dict[str, Any]: Aggregated token usage and cost structure.
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
    """Record standalone token usage for a conversation (e.g. from title generation).

    Updates the conversation's `standalone_token_usage`, recalculates the overall
    conversation `token_usage`, and atomically persists the update to disk.

    Args:
        conversation_id (str): Conversation identifier.
        model (str): Model identifier that executed the standalone task.
        usage (Optional[Dict[str, Any]]): Token usage dict with 'prompt_tokens', 'completion_tokens'.

    Returns:
        Optional[Dict[str, Any]]: Updated conversation total token usage dict, or None if failed.
    """
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
    conversation_id: Optional[str] = None, mode: str = "informational"
) -> Dict[str, Any]:
    """Create a new conversation record and atomically persist it to disk.

    Initializes an empty conversation structure with default title, empty messages list,
    and zeroed token usage statistics.

    Args:
        conversation_id (Optional[str]): Unique UUID string for the conversation.
            Generated automatically if omitted.
        mode (str): Initial conversation mode ('informational', 'one_shot', 'agentic', 'custom_workflows').
            Defaults to 'informational'.

    Returns:
        Dict[str, Any]: Newly initialized conversation dictionary:
            - "id" (str): The conversation UUID.
            - "created_at" (str): ISO-8601 UTC timestamp.
            - "title" (str): Default title ("New Conversation").
            - "mode" (str): Operational mode.
            - "messages" (list): Empty message array.
            - "token_usage" (dict): Zeroed token and cost stats.
            - "standalone_token_usage" (dict): Zeroed standalone token stats.
    """
    ensure_data_dir()
    if not conversation_id:
        conversation_id = str(uuid.uuid4())

    conversation = {
        "id": conversation_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": "New Conversation",
        "mode": mode,
        "messages": [],
        "token_usage": empty_token_usage(),
        "standalone_token_usage": empty_token_usage(),
    }

    # Atomically save to file
    path = get_conversation_path(conversation_id)
    _safe_write_json(path, conversation)

    return conversation


def get_conversation_mode_from_messages(
    messages: List[Dict[str, Any]], fallback: str = "informational"
) -> str:
    """Infer the active conversation mode based on the most recent assistant message.

    Iterates backwards through the message list to examine the last assistant response:
      - If `message.get("type") == "workflow"`:
        Classified as `"custom_workflows"` (custom node-based DAG execution).
      - If `message.get("type") == "agent"`:
        Classified as `"agentic"` (autonomous Chairperson multi-turn loop).
      - If `message.get("stage4") is not None` or `message.get("action_request")`:
        Classified as `"one_shot"` (single-turn deliberation with MCP tool execution).
      - Otherwise:
        Classified as `"informational"` (standard 3-stage deliberation Q&A).

    Args:
        messages (List[Dict[str, Any]]): List of message dictionaries from the conversation.
        fallback (str): Default mode to return if no assistant message is present.

    Returns:
        str: Resolved mode string ('informational', 'one_shot', 'agentic', or 'custom_workflows').
    """
    for message in reversed(messages):
        if message.get("role") == "assistant":
            if message.get("type") == "workflow":
                return "custom_workflows"
            if message.get("type") == "agent":
                return "agentic"
            if message.get("stage4") is not None or (
                message.get("action_request") and message.get("type") != "agent"
            ):
                return "one_shot"
            return "informational"
    return fallback


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """Load a conversation from disk, reconcile dynamic fields, and return its contents.

    Reads the JSON file from `data/conversations/<conversation_id>.json`.
    Performs runtime reconciliations:
      - Validates that the loaded data is a valid dictionary containing conversation data.
      - Recomputes the active conversation `mode` based on message history.
      - Updates estimated token costs for all assistant messages using current rates.
      - Computes and sets cumulative `token_usage` for the conversation.

    Args:
        conversation_id (str): Unique UUID string of the conversation.

    Returns:
        Optional[Dict[str, Any]]: Loaded and reconciled conversation dict, or None if the
            file does not exist, cannot be decoded, or is corrupted.
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        logger.error("Failed to load conversation %s: %s", conversation_id, e)
        return None

    if not isinstance(data, dict):
        logger.warning("Conversation file %s did not contain a JSON object.", path)
        return None

    # Resolve conversation mode, falling back to message history inference if unset
    data["mode"] = data.get("mode") or get_conversation_mode_from_messages(
        data.get("messages", []), fallback="informational"
    )

    # Recalculate token costs based on current pricing rates
    for msg in data.get("messages", []):
        if msg.get("role") == "assistant" and msg.get("token_usage"):
            calculate_token_cost(msg["token_usage"])
    data["token_usage"] = compute_conversation_token_usage(data)
    return data


def save_conversation(conversation: Dict[str, Any]) -> None:
    """Save an updated conversation dictionary to disk using atomic file writing.

    Args:
        conversation (Dict[str, Any]): Complete conversation dictionary containing an 'id' key.

    Raises:
        Exception: If writing the atomic temporary file or replacing the target file fails.
    """
    ensure_data_dir()
    path = get_conversation_path(conversation["id"])
    _safe_write_json(path, conversation)


def list_conversations() -> List[Dict[str, Any]]:
    """List summary metadata for all stored conversations, ordered newest first.

    Scans the `data/conversations/` directory for `.json` files.
    Safely skips and logs any unreadable, empty, or corrupted files without
    interrupting the overall listing.

    Returns:
        List[Dict[str, Any]]: List of conversation metadata dictionaries, each containing:
            - "id" (str): Conversation UUID.
            - "created_at" (str): ISO-8601 UTC creation timestamp.
            - "title" (str): Conversation title.
            - "message_count" (int): Number of messages in the conversation.
            - "mode" (str): Conversation mode ('informational', 'one_shot', 'agentic', 'custom_workflows').
            - "token_usage" (dict): Total token counts and estimated spend.
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".json"):
            path = os.path.join(DATA_DIR, filename)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if not isinstance(data, dict) or "id" not in data or "created_at" not in data:
                    continue
                messages = data.get("messages", [])
                mode = data.get("mode") or get_conversation_mode_from_messages(
                    messages, fallback="informational"
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
            except Exception as e:
                logger.warning("Skipping unreadable conversation file %s: %s", filename, e)

    # Sort conversations by creation timestamp, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def delete_conversation(conversation_id: str) -> bool:
    """Delete a single conversation by its ID.

    Args:
        conversation_id (str): Conversation UUID identifier.

    Returns:
        bool: True if file was found and removed, False otherwise.
    """
    path = get_conversation_path(conversation_id)
    if os.path.exists(path):
        try:
            os.unlink(path)
            logger.info("Deleted conversation %s", conversation_id)
            return True
        except Exception as e:
            logger.error("Failed to delete conversation %s: %s", conversation_id, e)
            raise
    return False


def clear_all_conversations() -> int:
    """Delete all stored conversation JSON files.

    Returns:
        int: Number of conversation files deleted.
    """
    ensure_data_dir()
    deleted_count = 0
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".json"):
            path = os.path.join(DATA_DIR, filename)
            try:
                os.unlink(path)
                deleted_count += 1
            except Exception as e:
                logger.error("Failed to delete conversation file %s: %s", filename, e)
    logger.info("Cleared %d conversations from storage", deleted_count)
    return deleted_count


def add_user_message(conversation_id: str, content: str) -> None:
    """Append a user prompt message to a conversation and persist the change.

    Args:
        conversation_id (str): Conversation UUID identifier.
        content (str): Text content of the user prompt.

    Raises:
        ValueError: If the conversation does not exist.
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
) -> None:
    """Append a deliberated assistant response message to a conversation and persist it.

    Supports both standard 3-stage council deliberation (Stage 1 responses, Stage 2 rankings,
    Stage 3 synthesis) and 4-stage action requests with MCP tool execution results.

    Args:
        conversation_id (str): Target conversation identifier.
        stage1 (List[Dict[str, Any]]): List of individual model responses.
        stage2 (List[Dict[str, Any]]): List of peer ranking evaluations.
        stage3 (Dict[str, Any]): Chairman's final synthesized consensus response.
        stage4 (Optional[Dict[str, Any]]): Optional Stage 4 action plan output.
        execution (Optional[Dict[str, Any]]): Optional tool execution results.
        action_request (Optional[str]): Optional original action request text.
        token_usage (Optional[Dict[str, Any]]): Explicit turn token usage (computed if omitted).

    Raises:
        ValueError: If the conversation is not found in storage.
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

    message: Dict[str, Any] = {
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
) -> None:
    """Append an autonomous Chairperson agent trajectory message to a conversation.

    Stores the full execution history of an agent run, including the initial Stage 1-3
    Council deliberation, all step-by-step ReAct thoughts, actions, and observations,
    created artifacts, final deliverable summary, and cumulative token usage.

    Args:
        conversation_id (str): Conversation identifier.
        user_request (str): Original user prompt/task specification.
        initial_council (Dict[str, Any]): Pre-execution 3-stage deliberation context.
        steps (List[Dict[str, Any]]): Sequence of step records (thought, action, params, observation).
        artifacts (List[str]): List of file paths generated or edited during execution.
        summary (Optional[str]): Executive summary produced upon completion.
        error (Optional[str]): Error description if agent run terminated abnormally.
        status (str): Execution status: 'completed', 'cancelled', or 'failed'.
        token_usage (Optional[Dict[str, Any]]): Explicit token usage dictionary for the agent loop.

    Raises:
        ValueError: If the conversation is not found in storage.
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    council_tokens = compute_turn_token_usage(
        stage1=initial_council.get("stage1"),
        stage2=initial_council.get("stage2"),
        stage3=initial_council.get("stage3"),
    )
    if token_usage:
        turn_tokens = merge_token_usages(council_tokens, token_usage)
    else:
        step_tokens = compute_turn_token_usage(steps=steps)
        turn_tokens = merge_token_usages(council_tokens, step_tokens)

    message: Dict[str, Any] = {
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


def update_last_assistant_message(
    conversation_id: str,
    updater: Callable[[Dict[str, Any]], Dict[str, Any]],
) -> Dict[str, Any]:
    """Apply an update callable to the most recent assistant message in a conversation.

    Locates the last message where `role == "assistant"`, invokes `updater(message)`,
    replaces the message with the returned value, and persists the conversation.

    Args:
        conversation_id (str): Conversation identifier.
        updater (Callable[[Dict[str, Any]], Dict[str, Any]]): Function receiving current assistant
            message and returning updated message dict.

    Returns:
        Dict[str, Any]: The updated assistant message.

    Raises:
        ValueError: If the conversation is not found or has no assistant messages.
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


def update_conversation_title(conversation_id: str, title: str) -> None:
    """Update the descriptive display title of a conversation.

    Args:
        conversation_id (str): Conversation identifier.
        title (str): New title string.

    Raises:
        ValueError: If the conversation is not found.
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)


def update_conversation_mode(
    conversation_id: str, mode: str
) -> Optional[Dict[str, Any]]:
    """Update the operational mode of a conversation and persist the change.

    Args:
        conversation_id (str): Conversation identifier.
        mode (str): New mode string ('informational', 'one_shot', 'agentic', or 'custom_workflows').

    Returns:
        Optional[Dict[str, Any]]: Updated conversation dictionary, or None if not found.
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        return None

    conversation["mode"] = mode
    save_conversation(conversation)
    return conversation


def add_workflow_message(
    conversation_id: str,
    user_input: str,
    workflow_id: str,
    workflow_name: str,
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    final_output: str,
    status: str = "completed",
    error: Optional[str] = None,
    token_usage: Optional[Dict[str, Any]] = None,
) -> None:
    """Append a custom workflow execution record to a conversation.

    Args:
        conversation_id (str): Conversation identifier.
        user_input (str): Original user prompt submitted to the workflow.
        workflow_id (str): Unique identifier of the executed workflow.
        workflow_name (str): Display name of the workflow.
        nodes (List[Dict[str, Any]]): List of node execution states and outputs.
        edges (List[Dict[str, Any]]): Graph edge definitions connecting the nodes.
        final_output (str): Consolidated final output text produced by the graph.
        status (str): Workflow status ('completed', 'failed', or 'cancelled').
        error (Optional[str]): Error description if workflow failed.
        token_usage (Optional[Dict[str, Any]]): Aggregated token counts and costs.

    Raises:
        ValueError: If the conversation is not found in storage.
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    turn_tokens = token_usage or {
        "total_tokens": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "tokens_saved": 0,
        "total_cost": 0.0,
        "total_cost_saved": 0.0,
        "by_model": {},
    }

    message: Dict[str, Any] = {
        "role": "assistant",
        "type": "workflow",
        "workflow_id": workflow_id,
        "workflow_name": workflow_name,
        "action_request": user_input,
        "input": user_input,
        "nodes": nodes,
        "edges": edges,
        "final_output": final_output,
        "summary": final_output,
        "error": error,
        "status": status,
        "token_usage": turn_tokens,
    }

    conversation["messages"].append(message)
    conversation["mode"] = "custom_workflows"
    conversation["token_usage"] = compute_conversation_token_usage(conversation)
    save_conversation(conversation)
