import tempfile
from pathlib import Path
from unittest.mock import patch

from backend.storage import (
    add_agent_message,
    add_assistant_message,
    add_user_message,
    add_workflow_message,
    create_conversation,
    delete_conversation,
    empty_token_usage,
    get_conversation,
    get_conversation_mode_from_messages,
    list_conversations,
    merge_token_usages,
    update_conversation_mode,
    update_conversation_title,
)


def test_token_usage_math():
    empty = empty_token_usage()
    assert empty["total_tokens"] == 0
    assert empty["prompt_tokens"] == 0
    assert empty["completion_tokens"] == 0

    u1 = {
        "prompt_tokens": 100,
        "completion_tokens": 50,
        "total_tokens": 150,
        "tokens_saved": 20,
        "by_model": {
            "model-1": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
                "tokens_saved": 20,
            }
        },
    }
    u2 = {
        "prompt_tokens": 200,
        "completion_tokens": 100,
        "total_tokens": 300,
        "tokens_saved": 10,
        "by_model": {
            "model-2": {
                "prompt_tokens": 200,
                "completion_tokens": 100,
                "total_tokens": 300,
                "tokens_saved": 10,
            }
        },
    }
    merged = merge_token_usages(u1, u2)
    assert merged["prompt_tokens"] == 300
    assert merged["completion_tokens"] == 150
    assert merged["total_tokens"] == 450
    assert merged["tokens_saved"] == 30
    assert "model-1" in merged["by_model"]
    assert "model-2" in merged["by_model"]


def test_conversation_crud_and_messages():
    with tempfile.TemporaryDirectory() as tmp_dir:
        data_dir = Path(tmp_dir) / "conversations"
        with patch("backend.storage.DATA_DIR", str(data_dir)):
            # Create conversation
            conv = create_conversation(conversation_id="conv-123", mode="informational")
            assert conv["id"] == "conv-123"
            assert conv["mode"] == "informational"
            assert conv["messages"] == []

            # Add user message
            add_user_message("conv-123", "Hello Council!")
            loaded = get_conversation("conv-123")
            assert len(loaded["messages"]) == 1
            assert loaded["messages"][0]["role"] == "user"
            assert loaded["messages"][0]["content"] == "Hello Council!"

            # Add assistant message (Stage 1-3)
            stage1 = [
                {
                    "model": "m1",
                    "response": "resp 1",
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 20,
                        "total_tokens": 30,
                    },
                }
            ]
            stage2 = [
                {
                    "model": "m1",
                    "ranking": "rank 1",
                    "usage": {
                        "prompt_tokens": 5,
                        "completion_tokens": 5,
                        "total_tokens": 10,
                    },
                }
            ]
            stage3 = {
                "model": "m_chair",
                "response": "synthesis",
                "usage": {
                    "prompt_tokens": 20,
                    "completion_tokens": 40,
                    "total_tokens": 60,
                },
            }
            add_assistant_message("conv-123", stage1, stage2, stage3)

            loaded = get_conversation("conv-123")
            assert len(loaded["messages"]) == 2
            assert loaded["messages"][1]["role"] == "assistant"
            assert loaded["token_usage"]["total_tokens"] > 0
            assert loaded["mode"] == "informational"

            # Update title
            update_conversation_title("conv-123", "Custom Test Title")
            loaded = get_conversation("conv-123")
            assert loaded["title"] == "Custom Test Title"

            # Update mode
            update_conversation_mode("conv-123", "agentic")
            loaded = get_conversation("conv-123")
            assert loaded["mode"] == "agentic"

            # Add agent message
            add_agent_message(
                conversation_id="conv-123",
                user_request="Build something",
                initial_council={"stage1": stage1, "stage2": stage2, "stage3": stage3},
                steps=[{"step": 1, "thought": "thinking", "action": "read_file"}],
                artifacts=["file.txt"],
                summary="Done!",
                status="completed",
            )
            loaded = get_conversation("conv-123")
            assert len(loaded["messages"]) == 3
            assert loaded["messages"][2]["type"] == "agent"
            assert loaded["messages"][2]["artifacts"] == ["file.txt"]
            assert loaded["mode"] == "agentic"

            # Add workflow message
            add_workflow_message(
                conversation_id="conv-123",
                user_input="Run flow",
                workflow_id="wf-1",
                workflow_name="My Flow",
                nodes=[{"id": "n1", "output": "res"}],
                edges=[],
                final_output="Output text",
            )
            loaded = get_conversation("conv-123")
            assert len(loaded["messages"]) == 4
            assert loaded["messages"][3]["type"] == "workflow"
            assert loaded["mode"] == "custom_workflows"

            # Test list conversations
            all_convs = list_conversations()
            assert len(all_convs) == 1
            assert all_convs[0]["id"] == "conv-123"
            assert all_convs[0]["title"] == "Custom Test Title"

            # Delete conversation
            deleted = delete_conversation("conv-123")
            assert deleted is True
            assert get_conversation("conv-123") is None
            assert len(list_conversations()) == 0


def test_mode_inference():
    messages_agent = [{"role": "user"}, {"role": "assistant", "type": "agent"}]
    assert get_conversation_mode_from_messages(messages_agent) == "agentic"

    messages_wf = [{"role": "user"}, {"role": "assistant", "type": "workflow"}]
    assert get_conversation_mode_from_messages(messages_wf) == "custom_workflows"

    messages_action = [{"role": "user"}, {"role": "assistant", "stage4": {}}]
    assert get_conversation_mode_from_messages(messages_action) == "one_shot"

    messages_info = [{"role": "user"}, {"role": "assistant", "stage3": {}}]
    assert get_conversation_mode_from_messages(messages_info) == "informational"
