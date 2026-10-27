from backend.compression import (
    compress_heuristic_text,
    compress_messages,
    estimate_tokens,
    get_compression_stats,
    map_model_for_headroom,
    reset_compression_stats,
)


def test_estimate_tokens():
    assert estimate_tokens("") == 0
    assert estimate_tokens(None) == 0
    # "Hello, world!" has 13 chars -> max(1, 13//4) = 3
    assert estimate_tokens("Hello, world!") >= 1


def test_map_model_for_headroom():
    assert map_model_for_headroom("openai/gpt-4o") == "gpt-4o"
    assert map_model_for_headroom("anthropic/claude-3-haiku") == "claude-3-5-sonnet"
    assert map_model_for_headroom("google/gemini-2.5-flash") == "gemini-1.5-pro"
    assert map_model_for_headroom("meta-llama/llama-3.3-70b-instruct") == "gpt-4o"


def test_compress_heuristic_text():
    # 1. Delimiter normalization
    text = "Section 1\n==============\nContent here with lots of info that exceeds forty chars."
    compressed, transforms = compress_heuristic_text(text)
    assert "---" in compressed
    assert "compact_delimiters" in transforms

    # 2. Whitespace collapsing
    text2 = "Some word    with    multiple spaces that are long enough to pass 40 characters limit."
    compressed2, transforms2 = compress_heuristic_text(text2)
    assert "    " not in compressed2
    assert "collapse_spaces" in transforms2

    # 3. Newline collapsing
    text3 = "Paragraph 1\n\n\n\nParagraph 2 with enough length to be processed by heuristic."
    compressed3, transforms3 = compress_heuristic_text(text3)
    assert "\n\n\n" not in compressed3
    assert "collapse_newlines" in transforms3

    # 4. Preamble removal
    text4 = "Certainly! I can help with that:\nHere is the answer to your very important inquiry."
    compressed4, transforms4 = compress_heuristic_text(text4)
    assert "Certainly!" not in compressed4
    assert "strip_preamble" in transforms4


def test_compress_messages_lifecycle():
    reset_compression_stats()
    messages = [
        {
            "role": "user",
            "content": "Certainly! I can help with that:\n\n\nHere is a very detailed plan that has plenty of characters to exceed the threshold.",
        },
    ]

    # Disabled
    res_disabled = compress_messages(messages, enabled=False)
    assert res_disabled.algorithm == "disabled"
    assert res_disabled.tokens_saved == 0

    # Heuristic
    res_heur = compress_messages(messages, algorithm="heuristic", enabled=True)
    assert res_heur.algorithm == "heuristic"
    assert res_heur.tokens_before >= res_heur.tokens_after

    stats = get_compression_stats()
    assert stats["total_queries"] >= 1
    assert "heuristic" in stats["algorithm_counts"]

    reset_compression_stats()
    stats_after_reset = get_compression_stats()
    assert stats_after_reset["total_queries"] == 0
