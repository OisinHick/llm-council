"""Agent tools for the LLM Council autonomous agent.

Provides robust file reading, writing, editing, directory inspection,
shell command execution, and MCP tool forwarding. Designed to provide safe,
line-indexed, and uniquely-targeted primitives that the Chairperson model
can invoke during its autonomous ReAct loop.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from pathlib import Path
from typing import Any

from .config import BASE_DIR

# Directory names ignored during directory scans to keep payload sizes reasonable
IGNORED_DIR_NAMES = frozenset({".git", "__pycache__", "node_modules", ".venv"})


def _truncate_stream_output(text: str, max_chars: int = 4000) -> tuple[str, bool]:
    """Truncate command output strings exceeding max_chars to keep payload manageable.

    Args:
        text: The raw output stream string (stdout or stderr).
        max_chars: Maximum allowed characters before appending a truncation notice.
            Defaults to 4000.

    Returns:
        tuple[str, bool]: A pair of (possibly-truncated text, whether truncation occurred).
    """
    if len(text) > max_chars:
        return text[:max_chars] + f"\n... [Output truncated to {max_chars} chars]", True
    return text, False


class AgentToolExecutor:
    """Executes tools on behalf of the Chairperson agent.

    This executor provides file manipulation and environment execution primitives
    tailored for autonomous agents:
    - Path resolution relative to an isolated or project workspace root.
    - 1-indexed, line-numbered file reading with bounds checking.
    - Automatic parent directory creation on file creation/overwrite.
    - Exact single-occurrence search-and-replace editing to prevent ambiguous edits.
    - Filtered directory listing (respecting recursive depth and ignoring heavy folders).
    - Subprocess execution with process killing on timeout and output stream truncation.
    """

    def __init__(self, workspace_root: Path | None = None):
        """Initialize the AgentToolExecutor with a designated workspace root.

        Args:
            workspace_root: Optional base path for resolving relative paths.
                Defaults to BASE_DIR if not provided.
        """
        self.workspace_root = workspace_root or BASE_DIR

    def _resolve_path(self, path_str: str) -> Path:
        """Resolve a relative or absolute path against the workspace root.

        Args:
            path_str: String representation of the target path.

        Returns:
            Path: Absolute resolved Path object.
        """
        p = Path(path_str)
        return p.resolve() if p.is_absolute() else (self.workspace_root / p).resolve()

    async def read_file(
        self,
        path: str,
        start_line: int | None = None,
        end_line: int | None = None,
    ) -> dict[str, Any]:
        """Read the contents of a file, optionally bounded by line numbers (1-indexed).

        Prepends line numbers (e.g., '1: content') to aid the LLM in understanding
        the exact line indices for subsequent modifications or reference.

        Args:
            path: Target file path (relative to workspace or absolute).
            start_line: Optional 1-indexed starting line number (inclusive).
            end_line: Optional 1-indexed ending line number (inclusive).

        Returns:
            dict[str, Any]: Result dictionary containing:
                - success (bool): True if reading succeeded, False otherwise.
                - path (str): String representation of the resolved file path.
                - total_lines (int): Total number of lines in the file.
                - start_line (int): Effective start line.
                - end_line (int): Effective end line.
                - content (str): Line-numbered text content.
                - error (str, optional): Error message if file not found or reading failed.
        """
        try:
            file_path = self._resolve_path(path)
            if not file_path.exists():
                return {"success": False, "error": f"File not found: {path}"}
            if not file_path.is_file():
                return {"success": False, "error": f"Path is not a file: {path}"}

            lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
            total_lines = len(lines)

            # Apply line range if provided, ensuring bounds are respected
            s = max(1, start_line) if start_line is not None else 1
            e = min(total_lines, end_line) if end_line is not None else total_lines

            # Handle edge case where start_line is greater than the total lines
            if s > total_lines:
                return {
                    "success": True,
                    "content": "",
                    "total_lines": total_lines,
                    "message": f"Start line {s} exceeds total lines {total_lines}.",
                }

            # Slice lines and format with 1-indexed prefixes
            selected_lines = lines[s - 1 : e]
            numbered = [
                f"{i}: {line}" for i, line in enumerate(selected_lines, start=s)
            ]

            return {
                "success": True,
                "path": str(file_path),
                "total_lines": total_lines,
                "start_line": s,
                "end_line": e,
                "content": "\n".join(numbered),
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to read file: {e}"}

    async def write_file(self, path: str, content: str) -> dict[str, Any]:
        """Create or overwrite a file with the given content.

        Creates parent directories automatically if needed. Emits relative path
        if within workspace_root, along with bytes written and line count.

        Args:
            path: Target file path to write.
            content: Complete string content to write into the file.

        Returns:
            dict[str, Any]: Result dictionary containing:
                - success (bool): True if writing succeeded.
                - path (str): Relative path if within workspace, otherwise absolute path.
                - bytes_written (int): Byte count of written UTF-8 content.
                - line_count (int): Number of lines written.
                - message (str): Human-readable success message.
                - error (str, optional): Error description if write operation failed.
        """
        try:
            file_path = self._resolve_path(path)
            # Create any missing parent directories
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")

            rel_path = (
                str(file_path.relative_to(self.workspace_root))
                if file_path.is_relative_to(self.workspace_root)
                else str(file_path)
            )

            return {
                "success": True,
                "path": rel_path,
                "bytes_written": len(content.encode("utf-8")),
                "line_count": len(content.splitlines()),
                "message": f"Successfully wrote {rel_path}",
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to write file: {e}"}

    async def edit_file(
        self, path: str, target_content: str, replacement_content: str
    ) -> dict[str, Any]:
        """Replace target_content with replacement_content in an existing file.

        Enforces uniqueness: target_content must appear exactly once in the file.
        If target_content is not found or appears multiple times, the operation
        fails with an informative error instructing the model how to fix it.

        Args:
            path: Path to the target file to modify.
            target_content: Exact substring to search for (including whitespace).
            replacement_content: Substring to replace target_content with.

        Returns:
            dict[str, Any]: Result dictionary containing:
                - success (bool): True if replacement was performed cleanly.
                - path (str): File path that was edited.
                - message (str): Success confirmation.
                - error (str, optional): Diagnostic explanation if target was missing or non-unique.
        """
        try:
            file_path = self._resolve_path(path)
            if not file_path.exists():
                return {"success": False, "error": f"File not found: {path}"}

            original = file_path.read_text(encoding="utf-8", errors="replace")

            occurrences = original.count(target_content)
            if occurrences == 0:
                return {
                    "success": False,
                    "error": (
                        f"Target content not found in {path}. "
                        "Ensure exact match including whitespace and indentation."
                    ),
                }
            if occurrences > 1:
                return {
                    "success": False,
                    "error": (
                        f"Target content found {occurrences} times in {path}. "
                        "Provide more surrounding context to make it unique."
                    ),
                }

            # Replace single exact match
            updated = original.replace(target_content, replacement_content, 1)
            file_path.write_text(updated, encoding="utf-8")

            return {
                "success": True,
                "path": str(file_path),
                "message": f"Successfully edited {path}",
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to edit file: {e}"}

    async def list_directory(
        self, path: str = ".", recursive: bool = False, max_depth: int = 2
    ) -> dict[str, Any]:
        """List files and subdirectories within a directory.

        Filters out hidden files and common build/dependency caches
        (such as `.git`, `__pycache__`, `node_modules`, `.venv`). In non-recursive
        mode, includes file sizes. Caps output to 150 entries to avoid prompt overflow.

        Args:
            path: Directory path to scan (defaults to workspace root ".").
            recursive: Whether to walk subdirectories recursively.
            max_depth: Maximum directory depth to traverse when recursive=True (default 2).

        Returns:
            dict[str, Any]: Result dictionary containing:
                - success (bool): True if directory was successfully read.
                - directory (str): Target directory path.
                - count (int): Total number of matching entries discovered.
                - entries (list[dict[str, Any]]): Capped list of entries with metadata.
                - error (str, optional): Error details if path does not exist or is not a directory.
        """
        try:
            dir_path = self._resolve_path(path)
            if not dir_path.exists():
                return {"success": False, "error": f"Directory not found: {path}"}
            if not dir_path.is_dir():
                return {"success": False, "error": f"Path is not a directory: {path}"}

            items = []
            if recursive:
                # Walk filesystem recursively up to max_depth
                for root, dirs, files in os.walk(dir_path):
                    rel_root = Path(root).relative_to(dir_path)
                    depth = len(rel_root.parts)
                    if depth > max_depth:
                        continue

                    # Filter hidden dirs and ignored build/cache directories in-place
                    dirs[:] = [
                        d
                        for d in dirs
                        if not d.startswith(".") and d not in IGNORED_DIR_NAMES
                    ]

                    for d in dirs:
                        rel_d = (rel_root / d).as_posix() if str(rel_root) != "." else d
                        items.append({"path": rel_d, "type": "directory"})

                    for f in files:
                        if f.startswith("."):
                            continue
                        rel_f = (rel_root / f).as_posix() if str(rel_root) != "." else f
                        items.append({"path": rel_f, "type": "file"})
            else:
                # Flat directory listing
                for entry in sorted(dir_path.iterdir()):
                    if entry.name.startswith(".") or entry.name in IGNORED_DIR_NAMES:
                        continue
                    items.append(
                        {
                            "name": entry.name,
                            "type": "directory" if entry.is_dir() else "file",
                            "size": entry.stat().st_size if entry.is_file() else None,
                        }
                    )

            return {
                "success": True,
                "directory": str(dir_path),
                "count": len(items),
                "entries": items[:150],  # Cap output size to prevent context overflow
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to list directory: {e}"}

    async def execute_command(self, command: str, timeout: int = 60) -> dict[str, Any]:
        """Execute a shell command within the workspace root with a timeout.

        If execution exceeds the timeout, the process is killed asynchronously
        and a failure payload is returned. Output streams (stdout and stderr)
        are truncated if they exceed 4000 characters to keep context windows clean.

        Args:
            command: Shell command string to execute.
            timeout: Maximum allowed execution time in seconds (default 60s).

        Returns:
            dict[str, Any]: Subprocess execution result containing:
                - success (bool): True if returncode is 0.
                - returncode (int): Integer exit code of the process (-1 on timeout/error).
                - stdout (str): Standard output (truncated if exceeding limits).
                - stderr (str): Standard error (truncated if exceeding limits).
                - truncated (bool): True if either stdout or stderr was truncated.
                - error (str, optional): Diagnostic message on timeout or exception.
        """
        try:
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=str(self.workspace_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=timeout
                )
            except TimeoutError:
                # Forcefully kill runaway subprocess on timeout
                with suppress(Exception):
                    process.kill()
                    await process.wait()
                return {
                    "success": False,
                    "error": f"Command timed out after {timeout} seconds",
                    "stdout": "",
                    "stderr": "",
                    "returncode": -1,
                }

            stdout_str, out_trunc = _truncate_stream_output(
                stdout.decode("utf-8", errors="replace")
            )
            stderr_str, err_trunc = _truncate_stream_output(
                stderr.decode("utf-8", errors="replace")
            )

            return {
                "success": process.returncode == 0,
                "returncode": process.returncode,
                "stdout": stdout_str,
                "stderr": stderr_str,
                "truncated": out_trunc or err_trunc,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "stdout": "",
                "stderr": "",
                "returncode": -1,
            }

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Return schema descriptions of available tools for the Chairperson prompt.

        These definitions are injected into the agent's system prompt so the
        model understands which action primitives exist, what each does,
        and the parameter schemas expected.

        Returns:
            list[dict[str, Any]]: List of tool definition dictionaries.
        """
        return [
            {
                "name": "write_file",
                "description": "Create or overwrite a file with given content. Ideal for writing code or markdown documents.",
                "parameters": {
                    "path": "Relative path to file (e.g. 'src/module.py', 'README.md')",
                    "content": "Full text content to write into the file",
                },
            },
            {
                "name": "read_file",
                "description": "Read contents of a file with line numbers.",
                "parameters": {
                    "path": "Path to file",
                    "start_line": "Optional 1-indexed start line",
                    "end_line": "Optional 1-indexed end line",
                },
            },
            {
                "name": "edit_file",
                "description": "Perform an exact search-and-replace modification inside a file.",
                "parameters": {
                    "path": "Path to file",
                    "target_content": "Exact substring to replace",
                    "replacement_content": "New replacement substring",
                },
            },
            {
                "name": "list_directory",
                "description": "List files and subdirectories in a directory path.",
                "parameters": {
                    "path": "Directory path (default '.')",
                    "recursive": "Whether to list recursively (boolean, default false)",
                },
            },
            {
                "name": "execute_command",
                "description": "Run a shell/bash command (e.g. running python scripts, tests, npm commands, linters).",
                "parameters": {
                    "command": "Command string to run",
                    "timeout": "Optional timeout in seconds (default 60)",
                },
            },
            {
                "name": "consult_council",
                "description": "Consult the full LLM Council for multi-model cross-referenced guidance on an architectural choice, difficult bug, code structure, or fact-check.",
                "parameters": {
                    "question": "The specific question or dilemma for the council",
                    "context": "Relevant context, code snippets, or error trace to evaluate",
                },
            },
            {
                "name": "complete_task",
                "description": "Declare the overall task completed when all code, documents, and verification tests are done.",
                "parameters": {
                    "summary": "Comprehensive explanation of what was achieved and how it was verified",
                    "artifacts": "List of paths to files or documents created/modified",
                },
            },
        ]


# Default singleton instance for the Chairperson agent
agent_executor = AgentToolExecutor()
