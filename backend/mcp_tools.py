"""MCP Tools for the LLM Council - handles actual action execution."""

import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp


class MCPToolExecutor:
    """Handles execution of MCP tools called by the council."""

    async def execute_command(self, command: str, timeout: int = 30) -> Dict[str, Any]:
        """
        Execute a shell command.

        Args:
            command: Command to execute
            timeout: Timeout in seconds

        Returns:
            Dict with stdout, stderr, returncode
        """
        try:
            process = await asyncio.create_subprocess_shell(
                command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
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
        """
        Read a file from the filesystem.

        Args:
            path: File path to read

        Returns:
            Dict with content or error
        """
        try:
            file_path = Path(path)
            if not file_path.exists():
                return {"success": False, "error": f"File not found: {path}"}

            content = file_path.read_text()
            return {"success": True, "content": content, "size": len(content)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def write_file(
        self, path: str, content: str, mode: str = "write"
    ) -> Dict[str, Any]:
        """
        Write content to a file.

        Args:
            path: File path to write
            content: Content to write
            mode: "write" (overwrite) or "append"

        Returns:
            Dict with success status
        """
        try:
            file_path = Path(path)
            file_path.parent.mkdir(parents=True, exist_ok=True)

            if mode == "append":
                with open(file_path, "a") as f:
                    f.write(content)
            else:
                file_path.write_text(content)

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
        """
        Make an HTTP request.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE, etc.)
            url: Request URL
            headers: Optional request headers
            data: Optional request body (will be JSON encoded)
            timeout: Timeout in seconds

        Returns:
            Dict with response data
        """
        try:
            async with aiohttp.ClientSession() as session:
                kwargs = {
                    "headers": headers or {},
                    "timeout": aiohttp.ClientTimeout(total=timeout),
                }
                if data:
                    kwargs["json"] = data

                async with session.request(method, url, **kwargs) as response:
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
        """
        Execute a list of tool calls from the council decision.

        Args:
            tool_calls: List of tool call dicts with 'tool' and 'params' keys

        Returns:
            Dict with execution results
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
                    # Route to external MCP server
                    from .mcp_client_manager import mcp_manager
                    result = await mcp_manager.call_tool(
                        server_name, tool_name, params
                    )

                results.append(
                    {
                        "tool": tool_name,
                        "server": server_name,
                        "params": params,
                        "result": result,
                    }
                )
            except Exception as e:
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


# Singleton instance
executor = MCPToolExecutor()
