"""
Token and Context Compression Layer for LLM Council.

Supports:
- Headroom (headroom-ai): Content-aware context optimization (SmartCrusher for JSON, AST code compression)
- Heuristic / Semantic Pruning: Whitespace, delimiter, boilerplate, and log deduplication
- Adaptive: Hybrid multi-stage compression (Heuristic pre-pass + Headroom)
"""

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    import tiktoken
    _TIKTOKEN_ENC = tiktoken.get_encoding("cl100k_base")
except Exception:
    _TIKTOKEN_ENC = None

try:
    import headroom
    _HAS_HEADROOM = True
except ImportError:
    headroom = None
    _HAS_HEADROOM = False


@dataclass
class CompressionResult:
    messages: List[Dict[str, Any]]
    tokens_before: int
    tokens_after: int
    tokens_saved: int
    compression_ratio: float
    algorithm: str
    transforms_applied: List[str] = field(default_factory=list)


_COMPRESSION_STATS: Dict[str, Any] = {
    "total_queries": 0,
    "tokens_before": 0,
    "tokens_after": 0,
    "tokens_saved": 0,
    "algorithm_counts": {},
}


def estimate_tokens(text: Optional[str]) -> int:
    """Estimate token count for a text string using tiktoken or 4-char heuristic fallback."""
    if not text:
        return 0
    if _TIKTOKEN_ENC is not None:
        try:
            return len(_TIKTOKEN_ENC.encode(text))
        except Exception:
            pass
    return max(1, len(text) // 4)


def estimate_messages_tokens(messages: List[Dict[str, Any]]) -> int:
    """Estimate token count for a list of message dicts."""
    total = 0
    for m in messages:
        content = m.get("content") or ""
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and "text" in part:
                    total += estimate_tokens(str(part["text"]))
                elif isinstance(part, str):
                    total += estimate_tokens(part)
        else:
            total += estimate_tokens(str(content))
        total += 3  # message overhead
    return total


def map_model_for_headroom(model: Optional[str]) -> str:
    """Map OpenRouter model identifier to a Headroom-compatible model ID."""
    if not model:
        return "gpt-4o"
    m_lower = model.lower()
    if "gpt" in m_lower or "o1" in m_lower or "o3" in m_lower:
        return "gpt-4o"
    if "claude" in m_lower:
        return "claude-3-5-sonnet"
    if "gemini" in m_lower:
        return "gemini-1.5-pro"
    return "gpt-4o"


def compress_heuristic_text(text: str) -> Tuple[str, List[str]]:
    """Apply heuristic compression rules to a text string."""
    if not text or len(text) < 40:
        return text, []

    transforms = []
    compressed = text

    # Compact long horizontal lines / delimiters
    delim_pattern = re.compile(r"([=\-_*#~]{4,})")
    if delim_pattern.search(compressed):
        compressed = delim_pattern.sub("---", compressed)
        transforms.append("compact_delimiters")

    # Collapse 3+ newlines to 2
    if "\n\n\n" in compressed:
        compressed = re.sub(r"\n{3,}", "\n\n", compressed)
        transforms.append("collapse_newlines")

    # Collapse 3+ spaces to 1
    if "   " in compressed:
        compressed = re.sub(r"[^\S\r\n]{3,}", " ", compressed)
        transforms.append("collapse_spaces")

    # Strip conversational preambles
    preambles = [
        re.compile(
            r"^(Sure|Certainly|Of course)!\s*(I would be happy to|Here is|I can help with).*?:\s*\n*",
            re.IGNORECASE,
        ),
        re.compile(r"^As an AI language model,\s*", re.IGNORECASE),
    ]
    for p in preambles:
        if p.search(compressed):
            compressed = p.sub("", compressed)
            transforms.append("strip_preamble")

    # Compact multi-line JSON blocks
    def compact_json_match(match):
        raw_json = match.group(0)
        try:
            parsed = json.loads(raw_json)
            return json.dumps(parsed, separators=(",", ":"))
        except Exception:
            return raw_json

    if "{\n" in compressed and "}" in compressed:
        json_pattern = re.compile(r"\{[^{}]*:[^{}]*\}", re.DOTALL)
        new_text = json_pattern.sub(compact_json_match, compressed)
        if len(new_text) < len(compressed):
            compressed = new_text
            transforms.append("compact_json")

    return compressed, transforms


def compress_with_heuristic(
    messages: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Heuristic compression over messages array."""
    new_messages = []
    all_transforms = set()
    for m in messages:
        new_m = dict(m)
        content = m.get("content")
        if isinstance(content, str):
            comp_content, transforms = compress_heuristic_text(content)
            new_m["content"] = comp_content
            all_transforms.update(transforms)
        new_messages.append(new_m)
    return new_messages, list(all_transforms)


def compress_with_headroom(
    messages: List[Dict[str, Any]], model: str = "gpt-4o"
) -> Tuple[List[Dict[str, Any]], int, int, List[str]]:
    """Compress messages using Headroom AI SDK."""
    if not _HAS_HEADROOM:
        logger.warning("headroom package not installed, falling back to heuristic.")
        comp_msgs, transforms = compress_with_heuristic(messages)
        t_before = estimate_messages_tokens(messages)
        t_after = estimate_messages_tokens(comp_msgs)
        return comp_msgs, t_before, t_after, transforms

    target_model = map_model_for_headroom(model)
    try:
        result = headroom.compress(
            messages=messages,
            model=target_model,
            compress_user_messages=True,
            optimize=True,
        )
        t_before = getattr(result, "tokens_before", None)
        if t_before is None:
            t_before = estimate_messages_tokens(messages)
        t_after = getattr(result, "tokens_after", None)
        if t_after is None:
            t_after = estimate_messages_tokens(result.messages)
        transforms = getattr(result, "transforms_applied", [])
        if not transforms:
            transforms = ["headroom_content_router"]
        return result.messages, t_before, t_after, transforms
    except Exception as e:
        logger.warning("Headroom compression error: %s; falling back to heuristic.", e)
        comp_msgs, transforms = compress_with_heuristic(messages)
        t_before = estimate_messages_tokens(messages)
        t_after = estimate_messages_tokens(comp_msgs)
        return comp_msgs, t_before, t_after, transforms


def compress_messages(
    messages: List[Dict[str, Any]],
    model: str = "gpt-4o",
    algorithm: str = "headroom",
    enabled: bool = True,
) -> CompressionResult:
    """
    Compress a message list using the specified algorithm if enabled.
    Tracks global compression statistics.
    """
    tokens_before = estimate_messages_tokens(messages)
    if not enabled:
        return CompressionResult(
            messages=messages,
            tokens_before=tokens_before,
            tokens_after=tokens_before,
            tokens_saved=0,
            compression_ratio=0.0,
            algorithm="disabled",
            transforms_applied=[],
        )

    algo = (algorithm or "headroom").lower()
    transforms_applied = []
    compressed_messages = messages
    tokens_after = tokens_before

    try:
        if algo == "heuristic":
            compressed_messages, transforms = compress_with_heuristic(messages)
            transforms_applied.extend(transforms)
            tokens_after = estimate_messages_tokens(compressed_messages)
        elif algo == "adaptive":
            h_msgs, h_transforms = compress_with_heuristic(messages)
            transforms_applied.extend(h_transforms)
            compressed_messages, _, t_after, hr_transforms = compress_with_headroom(
                h_msgs, model=model
            )
            transforms_applied.extend(hr_transforms)
            tokens_after = t_after
        else:  # headroom
            compressed_messages, _, tokens_after, hr_transforms = compress_with_headroom(
                messages, model=model
            )
            transforms_applied.extend(hr_transforms)
    except Exception as e:
        logger.exception("Unexpected error in compress_messages: %s", e)
        compressed_messages = messages
        tokens_after = tokens_before

    # If compression increased tokens, keep original
    if tokens_after > tokens_before:
        compressed_messages = messages
        tokens_after = tokens_before

    tokens_saved = max(0, tokens_before - tokens_after)
    ratio = round(tokens_saved / tokens_before, 4) if tokens_before > 0 else 0.0

    # Update cumulative statistics
    _COMPRESSION_STATS["total_queries"] += 1
    _COMPRESSION_STATS["tokens_before"] += tokens_before
    _COMPRESSION_STATS["tokens_after"] += tokens_after
    _COMPRESSION_STATS["tokens_saved"] += tokens_saved
    _COMPRESSION_STATS["algorithm_counts"][algo] = (
        _COMPRESSION_STATS["algorithm_counts"].get(algo, 0) + 1
    )

    return CompressionResult(
        messages=compressed_messages,
        tokens_before=tokens_before,
        tokens_after=tokens_after,
        tokens_saved=tokens_saved,
        compression_ratio=ratio,
        algorithm=algo,
        transforms_applied=list(dict.fromkeys(transforms_applied)),
    )


def get_compression_stats() -> Dict[str, Any]:
    """Retrieve cumulative compression statistics."""
    total_before = _COMPRESSION_STATS["tokens_before"]
    total_saved = _COMPRESSION_STATS["tokens_saved"]
    ratio = round(total_saved / total_before, 4) if total_before > 0 else 0.0
    dollars_saved = round(total_saved * 0.0000005, 6)
    return {
        "total_queries": _COMPRESSION_STATS["total_queries"],
        "tokens_before": total_before,
        "tokens_after": _COMPRESSION_STATS["tokens_after"],
        "tokens_saved": total_saved,
        "compression_ratio": ratio,
        "estimated_dollars_saved": dollars_saved,
        "algorithm_counts": dict(_COMPRESSION_STATS["algorithm_counts"]),
        "headroom_available": _HAS_HEADROOM,
    }


def reset_compression_stats() -> None:
    """Reset cumulative compression statistics to zero."""
    _COMPRESSION_STATS["total_queries"] = 0
    _COMPRESSION_STATS["tokens_before"] = 0
    _COMPRESSION_STATS["tokens_after"] = 0
    _COMPRESSION_STATS["tokens_saved"] = 0
    _COMPRESSION_STATS["algorithm_counts"].clear()
