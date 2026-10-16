"""MCP Tools for the LLM Council - handles actual action execution.

This module provides the `MCPToolExecutor` engine responsible for executing
actions synthesized by the LLM Council or emitted during single-action execution.
It provides two primary capabilities:
1. Legacy built-in local primitives:
   - `execute_command`: Asynchronous subprocess shell execution with configurable timeout.
   - `read_file`: Filesystem read operations with error trapping and size recording.
   - `write_file`: Filesystem write/append operations creating parent folders automatically.
   - `http_request`: Outbound asynchronous HTTP calls via `aiohttp.ClientSession`.
2. Dynamic external MCP forwarding:
   - Routing tool requests targeted at registered external MCP servers to `mcp_manager`.
"""

import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from .mcp_client_manager import mcp_manager


class MCPToolExecutor:
    """Handles execution of MCP tools called by the council.

    This executor acts as a dispatch router between built-in local tools
    (shell commands, local file reading/writing, HTTP requests) and external
    MCP servers connected via stdio or SSE transports.
    """

    async def execute_command(self, command: str, timeout: int = 30) -> Dict[str, Any]:
        """Execute a shell command asynchronously with a timeout limit.

        Spawns a subprocess shell, captures stdout and stderr via asyncio streams,
        and enforces an execution timeout to prevent runaway processes.

        Args:
            command: Shell command string to execute in the system environment.
            timeout: Maximum execution duration in seconds before killing the process
                and raising a TimeoutError (defaults to 30 seconds).

        Returns:
            Dict[str, Any]: Execution result payload containing:
                - success (bool): True if returncode is 0, False otherwise.
                - stdout (str): Standard output decoded as UTF-8 (replacement on error).
                - stderr (str): Standard error decoded as UTF-8 (replacement on error).
                - returncode (int): Subprocess exit code (or -1 if timed out/failed).
                - error (str, optional): Diagnostic message if an exception was caught.
        """
        try:
            # Spawn asynchronous subprocess with pipes for stdout and stderr
            process = await asyncio.create_subprocess_shell(
                command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            # Await completion or timeout
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=timeout
            )

            return {
                "success": process.returncode == 0,
                "stdout": stdout.decode("utf-8", errors="replace"),
                "stderr": stderr.decode("utf-8", errors="replace"),
                "returncode": process.returncode,
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": f"Command timed out after {timeout} seconds",
                "stdout": "",
                "stderr": "",
                "returncode": -1,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "stdout": "",
                "stderr": "",
                "returncode": -1,
            }

    async def read_file(self, path: str) -> Dict[str, Any]:
        """Read a file from the local filesystem.

        Validates file existence and returns raw text contents along with byte count.

        Args:
            path: Relative or absolute filesystem path to read.

        Returns:
            Dict[str, Any]: A result dictionary:
                - On success: `{"success": True, "content": <text>, "size": <char_len>}`
                - On failure: `{"success": False, "error": <err_msg>}`
        """
        try:
            file_path = Path(path)
            if not file_path.exists():
                return {"success": False, "error": f"File not found: {path}"}

            content = file_path.read_text(encoding="utf-8", errors="replace")
            return {"success": True, "content": content, "size": len(content)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def write_file(
        self, path: str, content: str, mode: str = "write"
    ) -> Dict[str, Any]:
        """Write text content to a file on the local filesystem.

        Automatically creates any missing parent directories before writing.
        Supports both atomic overwrite ('write') and append ('append') modes.

        Args:
            path: Target file path to write.
            content: Raw string content to write or append.
            mode: Writing mode, either "write" (overwrites existing file)
                or "append" (appends to end of file). Defaults to "write".

        Returns:
            Dict[str, Any]: Status payload:
                - On success: `{"success": True, "message": ..., "size": <char_len>}`
                - On failure: `{"success": False, "error": <err_msg>}`
        """
        try:
            file_path = Path(path)
            # Ensure parent directories exist
            file_path.parent.mkdir(parents=True, exist_ok=True)

            if mode == "append":
                with open(file_path, "a", encoding="utf-8") as f:
                    f.write(content)
            else:
                file_path.write_text(content, encoding="utf-8")

            return {
                "success": True,
                "message": f"File written: {path}",
                "size": len(content),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def http_request(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        data: Optional[Dict[str, Any]] = None,
        timeout: int = 30,
    ) -> Dict[str, Any]:
        """Make an asynchronous HTTP request.

        Performs outbound HTTP calls, serializing data to JSON if supplied,
        and parses response bodies as JSON or text fallback.

        Args:
            method: HTTP method (e.g., 'GET', 'POST', 'PUT', 'DELETE', 'PATCH').
            url: Target URL endpoint.
            headers: Optional dictionary of HTTP request headers.
            data: Optional dictionary payload; automatically sent as JSON if provided.
            timeout: Maximum request duration in seconds before aborting (default 30s).

        Returns:
            Dict[str, Any]: Response dictionary containing:
                - success (bool): True if HTTP status code is < 400.
                - status_code (int): HTTP status code returned by remote server.
                - response (Any): Parsed JSON object, or plain string if JSON decode fails.
                - error (str, optional): Timeout or network exception details if failed.
        """
        try:
            async with aiohttp.ClientSession() as session:
                kwargs: Dict[str, Any] = {
                    "headers": headers or {},
                    "timeout": aiohttp.ClientTimeout(total=timeout),
                }
                if data:
                    kwargs["json"] = data

                async with session.request(method, url, **kwargs) as response:
                    # Attempt JSON parsing first, falling back to plain text
                    try:
                        response_data = await response.json()
                    except Exception:
                        response_data = await response.text()

                    return {
                        "success": response.status < 400,
                        "status_code": response.status,
                        "response": response_data,
                    }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": f"Request timed out after {timeout} seconds",
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def execute_tools(self, tool_calls: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Execute a batch of tool calls determined by the council action plan.

        Inspects the server target for each tool call:
        - If server is "local", routes to internal methods (`execute_command`, `read_file`,
          `write_file`, `http_request`).
        - Otherwise, forwards the invocation to the `mcp_manager` to execute on the
          appropriate connected external MCP server.

        Catches errors per tool call so that individual tool failures do not abort
        the entire batch prematurely.

        Args:
            tool_calls: List of tool specification dictionaries, each typically containing:
                - 'tool': Name of the tool to invoke.
                - 'server': Server identifier ("local" or external MCP server name).
                - 'params': Parameter dictionary matching the tool's schema.

        Returns:
            Dict[str, Any]: Aggregated batch execution payload:
                - executed_tools (int): Total number of tool calls processed.
                - results (List[Dict[str, Any]]): Ordered list of per-tool execution records.
                - all_successful (bool): True if every executed tool succeeded.
        """
        results = []

        for call in tool_calls:
            tool_name = call.get("tool")
            server_name = call.get("server", "local")
            params = call.get("params", {})

            try:
                if server_name == "local":
                    # Run legacy local tools
                    if tool_name == "execute_command":
                        result = await self.execute_command(**params)
                    elif tool_name == "read_file":
                        result = await self.read_file(**params)
                    elif tool_name == "write_file":
                        result = await self.write_file(**params)
                    elif tool_name == "http_request":
                        result = await self.http_request(**params)
                    else:
                        result = {
                            "success": False,
                            "error": f"Unknown local tool: {tool_name}",
                        }
                else:
                    # Route to external MCP server through the MCP manager
                    result = await mcp_manager.call_tool(server_name, tool_name, params)

                results.append(
                    {
                        "tool": tool_name,
                        "server": server_name,
                        "params": params,
                        "result": result,
                    }
                )
            except Exception as e:
                # Isolate exceptions per call so subsequent calls can still execute
                results.append(
                    {
                        "tool": tool_name,
                        "server": server_name,
                        "params": params,
                        "result": {"success": False, "error": str(e)},
                    }
                )

        return {
            "executed_tools": len(results),
            "results": results,
            "all_successful": all(r["result"].get("success", False) for r in results),
        }


# Singleton instance for application-wide tool execution
executor = MCPToolExecutor()
