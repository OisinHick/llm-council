"""MCP Tools for the LLM Council - handles actual action execution."""

import asyncio
import inspect
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp
from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp.client.session import ClientSession


class MCPToolExecutor:
    """Handles execution of MCP tools called by the council."""

    def __init__(self):
        self.mcp_clients: Dict[str, ClientSession] = {}
        self._exit_stack = AsyncExitStack()
        self.mcp_tools = []
        self._connected = False

    async def connect_mcp_servers(self):
        """Connect to configured external MCP servers."""
        if self._connected:
            return
            
        import os
        try:
            from .config import MCP_SERVERS
        except ImportError:
            MCP_SERVERS = {}
            
        for name, config in MCP_SERVERS.items():
            try:
                server_params = StdioServerParameters(
                    command=config["command"],
                    args=config.get("args", []),
                    env={**os.environ}
                )
                stdio_transport = await self._exit_stack.enter_async_context(stdio_client(server_params))
                read, write = stdio_transport
                session = await self._exit_stack.enter_async_context(ClientSession(read, write))
                await session.initialize()
                self.mcp_clients[name] = session
                
                # Fetch tools
                tools_result = await session.list_tools()
                for t in tools_result.tools:
                    self.mcp_tools.append({
                        "server": name,
                        "tool": t,
                        "name": t.name,
                        "description": t.description
                    })
            except Exception as e:
                print(f"Error connecting to MCP server {name}: {e}")
                
        self._connected = True

    async def _ensure_connected(self):
        await self.connect_mcp_servers()

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

    async def get_tool_descriptions(self) -> str:
        """
        Dynamically discover available tools and return their descriptions.
        """
        await self._ensure_connected()
        
        descriptions = []
        index = 1
        # Local tools
        for name, method in inspect.getmembers(self, predicate=inspect.ismethod):
            if not name.startswith("_") and name not in ["execute_tools", "get_tool_descriptions", "get_tool_names", "connect_mcp_servers"]:
                doc = inspect.getdoc(method)
                if doc:
                    first_line = doc.strip().split("\n")[0]
                    descriptions.append(f"{index}. {name} - {first_line}")
                    index += 1
                    
        # Remote MCP tools
        for t in self.mcp_tools:
            descriptions.append(f"{index}. {t['name']} (from {t['server']}) - {t['description']}")
            index += 1
        
        if not descriptions:
            return "No tools available."
        return "\n".join(descriptions)

    async def get_tool_names(self) -> List[str]:
        """
        Dynamically discover available tools and return their names.
        """
        await self._ensure_connected()
        
        names = []
        # Local tools
        for name, method in inspect.getmembers(self, predicate=inspect.ismethod):
            if not name.startswith("_") and name not in ["execute_tools", "get_tool_descriptions", "get_tool_names", "connect_mcp_servers"]:
                names.append(name)
                
        # Remote MCP tools
        for t in self.mcp_tools:
            names.append(t["name"])
            
        return names

    async def execute_tools(self, tool_calls: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Execute a list of tool calls from the council decision.

        Args:
            tool_calls: List of tool call dicts with 'tool' and 'params' keys

        Returns:
            Dict with execution results
        """
        await self._ensure_connected()
        
        results = []

        for call in tool_calls:
            tool_name = call.get("tool")
            params = call.get("params", {})

            try:
                # Local tool execution
                if hasattr(self, tool_name) and callable(getattr(self, tool_name)) and tool_name not in ["execute_tools", "get_tool_descriptions", "get_tool_names", "connect_mcp_servers"] and not tool_name.startswith("_"):
                    method = getattr(self, tool_name)
                    result = await method(**params)
                else:
                    # Remote MCP tool execution
                    remote_tool = next((t for t in self.mcp_tools if t["name"] == tool_name), None)
                    if remote_tool:
                        session = self.mcp_clients[remote_tool["server"]]
                        try:
                            mcp_result = await session.call_tool(tool_name, arguments=params)
                            
                            content = []
                            is_error = mcp_result.isError
                            
                            for item in mcp_result.content:
                                if hasattr(item, "text"):
                                    content.append(item.text)
                                else:
                                    content.append(str(item))
                                    
                            result_text = "\n".join(content)
                            
                            result = {
                                "success": not is_error,
                                "output": result_text,
                                "raw_result": mcp_result.model_dump() if hasattr(mcp_result, "model_dump") else str(mcp_result)
                            }
                        except Exception as e:
                            result = {"success": False, "error": f"MCP execution error: {str(e)}"}
                    else:
                        result = {"success": False, "error": f"Unknown tool: {tool_name}"}

                results.append({"tool": tool_name, "params": params, "result": result})
            except Exception as e:
                results.append(
                    {
                        "tool": tool_name,
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
