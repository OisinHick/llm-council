"""Agent tools for the LLM Council autonomous agent.

Provides robust file reading, writing, editing, directory inspection,
shell command execution, and MCP tool forwarding.
"""

import asyncio
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import BASE_DIR
from .mcp_client_manager import mcp_manager


class AgentToolExecutor:
    """Executes tools on behalf of the Chairperson agent."""

    def __init__(self, workspace_root: Optional[Path] = None):
        self.workspace_root = workspace_root or BASE_DIR

    def _resolve_path(self, path_str: str) -> Path:
        """Resolve a relative or absolute path against the workspace root."""
        p = Path(path_str)
        if not p.is_absolute():
            p = (self.workspace_root / p).resolve()
        else:
            p = p.resolve()
        return p

    async def read_file(
        self,
        path: str,
        start_line: Optional[int] = None,
        end_line: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Read the contents of a file, optionally bounded by line numbers (1-indexed).
        """
        try:
            file_path = self._resolve_path(path)
            if not file_path.exists():
                return {"success": False, "error": f"File not found: {path}"}
            if not file_path.is_file():
                return {"success": False, "error": f"Path is not a file: {path}"}

            lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
            total_lines = len(lines)

            # Apply line range if provided
            s = max(1, start_line) if start_line is not None else 1
            e = min(total_lines, end_line) if end_line is not None else total_lines

            if s > total_lines:
                return {
                    "success": True,
                    "content": "",
                    "total_lines": total_lines,
                    "message": f"Start line {s} exceeds total lines {total_lines}.",
                }

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
            return {"success": False, "error": f"Failed to read file: {str(e)}"}

    async def write_file(self, path: str, content: str) -> Dict[str, Any]:
        """
        Create or overwrite a file with the given content.
        Creates parent directories automatically if needed.
        """
        try:
            file_path = self._resolve_path(path)
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
            return {"success": False, "error": f"Failed to write file: {str(e)}"}

    async def edit_file(
        self, path: str, target_content: str, replacement_content: str
    ) -> Dict[str, Any]:
        """
        Replace target_content with replacement_content in a file.
        target_content must exist uniquely in the file.
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

            updated = original.replace(target_content, replacement_content, 1)
            file_path.write_text(updated, encoding="utf-8")

            return {
                "success": True,
                "path": str(file_path),
                "message": f"Successfully edited {path}",
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to edit file: {str(e)}"}

    async def list_directory(
        self, path: str = ".", recursive: bool = False, max_depth: int = 2
    ) -> Dict[str, Any]:
        """
        List files and subdirectories within a directory.
        """
        try:
            dir_path = self._resolve_path(path)
            if not dir_path.exists():
                return {"success": False, "error": f"Directory not found: {path}"}
            if not dir_path.is_dir():
                return {"success": False, "error": f"Path is not a directory: {path}"}

            items = []
            if recursive:
                for root, dirs, files in os.walk(dir_path):
                    rel_root = Path(root).relative_to(dir_path)
                    depth = len(rel_root.parts)
                    if depth > max_depth:
                        continue

                    # Filter hidden dirs like .git, __pycache__, .venv
                    dirs[:] = [
                        d
                        for d in dirs
                        if not d.startswith(".")
                        and d not in ("__pycache__", "node_modules", ".venv")
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
                for entry in sorted(dir_path.iterdir()):
                    if entry.name.startswith(".") or entry.name in (
                        "__pycache__",
                        "node_modules",
                        ".venv",
                    ):
                        continue
                    items.append({
                        "name": entry.name,
                        "type": "directory" if entry.is_dir() else "file",
                        "size": entry.stat().st_size if entry.is_file() else None,
                    })

            return {
                "success": True,
                "directory": str(dir_path),
                "count": len(items),
                "entries": items[:150],  # Cap output size
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to list directory: {str(e)}"}

    async def execute_command(
        self, command: str, timeout: int = 60
    ) -> Dict[str, Any]:
        """
        Execute a shell command with a timeout.
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
            except asyncio.TimeoutError:
                try:
                    process.kill()
                    await process.wait()
                except Exception:
                    pass
                return {
                    "success": False,
                    "error": f"Command timed out after {timeout} seconds",
                    "stdout": "",
                    "stderr": "",
                    "returncode": -1,
                }

            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            # Truncate if gigantic
            max_chars = 4000
            truncated = False
            if len(stdout_str) > max_chars:
                stdout_str = stdout_str[:max_chars] + f"\n... [Output truncated to {max_chars} chars]"
                truncated = True
            if len(stderr_str) > max_chars:
                stderr_str = stderr_str[:max_chars] + f"\n... [Output truncated to {max_chars} chars]"
                truncated = True

            return {
                "success": process.returncode == 0,
                "returncode": process.returncode,
                "stdout": stdout_str,
                "stderr": stderr_str,
                "truncated": truncated,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "stdout": "",
                "stderr": "",
                "returncode": -1,
            }

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """Return schema descriptions of available tools for the Chairperson prompt."""
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


# Default singleton instance
agent_executor = AgentToolExecutor()
