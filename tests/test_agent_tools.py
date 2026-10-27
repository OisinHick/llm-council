import tempfile
from pathlib import Path

import pytest

from backend.agent_tools import AgentToolExecutor, _truncate_stream_output


def test_truncate_stream_output():
    short_text = "Hello World"
    truncated, was_trunc = _truncate_stream_output(short_text, max_chars=50)
    assert truncated == short_text
    assert was_trunc is False

    long_text = "A" * 100
    truncated_long, was_trunc_long = _truncate_stream_output(long_text, max_chars=50)
    assert len(truncated_long) > 50  # includes suffix message
    assert was_trunc_long is True
    assert "Output truncated to 50 chars" in truncated_long


@pytest.mark.asyncio
async def test_agent_tool_executor_files():
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        executor = AgentToolExecutor(workspace_root=root)

        # 1. Write file
        w_res = await executor.write_file("sub/test.txt", "line 1\nline 2\nline 3\n")
        assert w_res["success"] is True
        assert (root / "sub" / "test.txt").exists()

        # 2. Read file
        r_res = await executor.read_file("sub/test.txt")
        assert r_res["success"] is True
        assert r_res["total_lines"] == 3
        assert "1: line 1" in r_res["content"]
        assert "2: line 2" in r_res["content"]

        # Partial line read
        r_part = await executor.read_file("sub/test.txt", start_line=2, end_line=2)
        assert r_part["success"] is True
        assert "2: line 2" in r_part["content"]
        assert "1: line 1" not in r_part["content"]

        # 3. Edit file (exact replacement)
        e_res = await executor.edit_file("sub/test.txt", "line 2", "line TWO modified")
        assert e_res["success"] is True

        r_after = await executor.read_file("sub/test.txt")
        assert "line TWO modified" in r_after["content"]

        # 4. Edit non-existent target should fail
        e_fail = await executor.edit_file("sub/test.txt", "nonexistent string", "bar")
        assert e_fail["success"] is False

        # 5. List directory
        list_res = await executor.list_directory("sub")
        assert list_res["success"] is True
        assert any(e["name"] == "test.txt" for e in list_res["entries"])

        # 6. Execute command
        cmd_res = await executor.execute_command("python -c \"print('from bash')\"")
        assert cmd_res["success"] is True
        assert "from bash" in cmd_res["stdout"]
