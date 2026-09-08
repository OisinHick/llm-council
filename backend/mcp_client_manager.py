"""Manager for connecting to and orchestrating multiple stdio-based MCP servers."""

import asyncio
import base64
import json
import logging
import os
import urllib.request
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Dict, List, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger("llm_council.mcp_client_manager")


def check_kali_tools_health() -> bool:
    url = os.environ.get("KALI_API_URL", "http://127.0.0.1:5000") + "/health"
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return response.getcode() == 200
    except Exception:
        return False


class MCPClientManager:
    """Orchestrates standard stdio MCP client connections to external servers."""

    def __init__(self):
        self.sessions: Dict[str, ClientSession] = {}
        self.exit_stacks: Dict[str, AsyncExitStack] = {}
        self.config_path = Path(__file__).resolve().parent.parent / "mcp_servers.json"
        self.configured_servers: List[str] = []
        self.server_statuses: Dict[str, str] = {}
        self.cached_tools: List[Dict[str, Any]] = []
        self.polling_task: Optional[asyncio.Task] = None

    def _read_config(self) -> Dict[str, Any]:
        """Read and parse the mcp_servers.json configuration file."""
        if not self.config_path.exists():
            return {"mcpServers": {}}
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read mcp_servers.json: {e}")
            return {"mcpServers": {}}

    def _write_config(self, config_data: Dict[str, Any]) -> None:
        """Write configuration to mcp_servers.json with clean formatting."""
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=2)
                f.write("\n")
        except Exception as e:
            logger.error(f"Failed to write mcp_servers.json: {e}")
            raise

    def is_server_enabled(
        self, name: str, config_data: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Check if a given MCP server is enabled.
        Defaults to True unless explicitly disabled.
        """
        if config_data is None:
            config_data = self._read_config()
        servers = config_data.get("mcpServers", {})
        srv = servers.get(name, {})
        if srv.get("disabled") is True:
            return False
        return srv.get("enabled", True)

    async def start_server(self, name: str, server_config: Dict[str, Any]) -> bool:
        """
        Start an individual MCP server process and establish a ClientSession.
        """
        # Stop any existing instance first
        await self.stop_server(name)

        command = server_config.get("command")
        args = server_config.get("args", [])
        env = server_config.get("env")

        if not command:
            logger.warning(
                f"Server '{name}' configuration is missing 'command'. Skipping."
            )
            self.server_statuses[name] = "configuration_error"
            return False

        logger.info(f"Starting MCP server '{name}' via command: {command} {args}")
        stack = AsyncExitStack()
        try:
            full_cmd = [command] + args

            # Wrap the server invocation in a python filter script that swallows non-JSON lines
            # from stdout (e.g. npm installs, node version warnings, progress bars).
            filter_script = f"""
import subprocess, sys, threading, json, os

for fd in range(3, 1024):
    try:
        os.close(fd)
    except OSError:
        pass

proc = subprocess.Popen(
    {repr(full_cmd)},
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=sys.stderr,
    close_fds=True,
)

def pipe_stdin():
    try:
        for line in iter(sys.stdin.buffer.readline, b''):
            proc.stdin.write(line)
            proc.stdin.flush()
    except Exception:
        pass
    finally:
        try:
            proc.terminate()
        except Exception:
            pass
        os._exit(0)

t = threading.Thread(target=pipe_stdin, daemon=True)
t.start()

for line in iter(proc.stdout.readline, b''):
    try:
        json.loads(line.strip().decode('utf-8', errors='ignore'))
        sys.stdout.buffer.write(line)
        sys.stdout.buffer.flush()
    except Exception:
        pass
"""
            encoded_script = base64.b64encode(filter_script.encode("utf-8")).decode("utf-8")
            wrapped_command = "python"
            wrapped_args = [
                "-u",
                "-c",
                f"import base64; exec(base64.b64decode('{encoded_script}').decode('utf-8'))",
            ]

            params = StdioServerParameters(
                command=wrapped_command, args=wrapped_args, env=env
            )

            read, write = await stack.enter_async_context(stdio_client(params))
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()

            self.exit_stacks[name] = stack
            self.sessions[name] = session
            self.server_statuses[name] = "connected"
            logger.info(f"Successfully connected to MCP server '{name}'")
            return True
        except Exception as e:
            logger.error(f"Failed to start MCP server '{name}': {e}")
            self.server_statuses[name] = f"failed: {str(e)}"
            try:
                await stack.aclose()
            except Exception:
                pass
            return False

    async def stop_server(self, name: str) -> None:
        """
        Stop an individual running MCP server and release its resources.
        """
        stack = self.exit_stacks.pop(name, None)
        if stack:
            try:
                logger.info(f"Stopping MCP server '{name}'...")
                await stack.aclose()
            except Exception as e:
                logger.warning(f"Error closing exit stack for '{name}': {e}")

        self.sessions.pop(name, None)
        # Remove cached tools belonging to this stopped server
        self.cached_tools = [t for t in self.cached_tools if t.get("server") != name]

    async def start_all_servers(self) -> None:
        """Load mcp_servers.json config and start all enabled servers."""
        config_data = self._read_config()
        servers = config_data.get("mcpServers", {})

        self.configured_servers = list(servers.keys())
        self.server_statuses = {}

        for name, server_config in servers.items():
            if self.is_server_enabled(name, config_data):
                await self.start_server(name, server_config)
            else:
                self.server_statuses[name] = "disabled"
                logger.info(f"MCP server '{name}' is disabled; skipping startup.")

        # Run initial tools check to populate the cache
        await self.get_available_tools(bypass_cache=True)
        # Start background polling task
        if not self.polling_task:
            self.polling_task = asyncio.create_task(self._poll_servers_loop())

    async def stop_all_servers(self) -> None:
        """Stop all started MCP servers and clean up resources."""
        if self.polling_task:
            self.polling_task.cancel()
            self.polling_task = None

        for name in list(self.exit_stacks.keys()):
            await self.stop_server(name)

        self.sessions.clear()
        self.exit_stacks.clear()
        self.cached_tools.clear()
        logger.info("All MCP servers stopped.")

    async def set_server_enabled(self, name: str, enabled: bool) -> Dict[str, Any]:
        """
        Enable or disable a specific MCP server, update mcp_servers.json,
        and start or stop the corresponding process.
        """
        config_data = self._read_config()
        servers = config_data.get("mcpServers", {})
        if name not in servers:
            raise ValueError(f"MCP server '{name}' not found in configuration.")

        server_config = servers[name]
        server_config["enabled"] = bool(enabled)
        server_config.pop("disabled", None)  # Clean up legacy key if present
        self._write_config(config_data)

        if enabled:
            await self.start_server(name, server_config)
        else:
            await self.stop_server(name)
            self.server_statuses[name] = "disabled"

        # Refresh tools cache
        await self.get_available_tools(bypass_cache=True)

        return {
            "name": name,
            "enabled": enabled,
            "status": self.server_statuses.get(name, "unknown"),
            "servers": self.get_servers_metadata(),
            "tools": self.cached_tools,
        }

    def get_servers_metadata(self) -> List[Dict[str, Any]]:
        """
        Return structured metadata for all configured MCP servers.
        """
        config_data = self._read_config()
        servers = config_data.get("mcpServers", {})
        metadata = []

        for name, cfg in servers.items():
            enabled = self.is_server_enabled(name, config_data)
            status = self.server_statuses.get(
                name, "disabled" if not enabled else "disconnected"
            )
            tool_count = len([t for t in self.cached_tools if t.get("server") == name])
            metadata.append(
                {
                    "name": name,
                    "enabled": enabled,
                    "status": status,
                    "command": cfg.get("command", ""),
                    "args": cfg.get("args", []),
                    "tools_count": tool_count,
                }
            )
        return metadata

    async def _poll_servers_loop(self) -> None:
        """Periodically refresh tools and statuses in the background."""
        while True:
            try:
                await self.get_available_tools(bypass_cache=True)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in MCP polling loop: {e}")
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                break

    async def get_available_tools(
        self, bypass_cache: bool = False
    ) -> List[Dict[str, Any]]:
        """
        List all available tools exposed by all enabled, running servers.

        Returns:
            List of dicts representing tools, each with server, name, description, schema
        """
        if not bypass_cache and self.cached_tools:
            return self.cached_tools

        config_data = self._read_config()
        servers = config_data.get("mcpServers", {})
        self.configured_servers = list(servers.keys())

        for name in self.configured_servers:
            if name not in self.server_statuses:
                enabled = self.is_server_enabled(name, config_data)
                self.server_statuses[name] = "disconnected" if enabled else "disabled"

        all_tools = []
        for server_name, session in list(self.sessions.items()):
            # Double check that server is enabled
            if not self.is_server_enabled(server_name, config_data):
                continue

            if server_name == "kali-tools":
                if not check_kali_tools_health():
                    self.server_statuses[server_name] = (
                        "error: Kali Linux Docker backend is offline"
                    )
                    continue

            try:
                result = await session.list_tools()
                tools_list = getattr(result, "tools", [])
                for tool in tools_list:
                    schema = getattr(tool, "input_schema", getattr(tool, "inputSchema", {}))
                    all_tools.append(
                        {
                            "server": server_name,
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": schema,
                        }
                    )
                self.server_statuses[server_name] = "connected"
            except Exception as e:
                logger.error(f"Failed to list tools for server '{server_name}': {e}")
                self.server_statuses[server_name] = f"error: {str(e)}"

        self.cached_tools = all_tools
        return all_tools

    async def call_tool(
        self, server_name: str, tool_name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Execute a tool call on a specific running server.

        Args:
            server_name: The name of the target MCP server
            tool_name: The name of the tool to invoke
            arguments: Dict of parameters for the tool

        Returns:
            Dict representing result status and text payload
        """
        if not self.is_server_enabled(server_name):
            return {
                "success": False,
                "error": f"MCP server '{server_name}' is disabled.",
            }

        session = self.sessions.get(server_name)
        if not session:
            return {
                "success": False,
                "error": f"MCP server '{server_name}' is not running",
            }

        try:
            logger.info(
                f"Calling tool '{tool_name}' on server '{server_name}' with args: {arguments}"
            )
            result = await session.call_tool(tool_name, arguments=arguments)
            content_list = getattr(result, "content", [])
            is_error = getattr(result, "isError", False)

            # Extract text elements from content list
            text_parts = []
            for item in content_list:
                # TextContent items have a 'text' property
                if hasattr(item, "text"):
                    text_parts.append(item.text)
                else:
                    text_parts.append(str(item))

            full_text = "\n".join(text_parts)

            return {
                "success": not is_error,
                "content": full_text,
                "raw_result": str(result),
            }
        except Exception as e:
            logger.error(
                f"Error calling tool '{tool_name}' on server '{server_name}': {e}"
            )
            return {"success": False, "error": str(e)}


# Global client manager singleton
mcp_manager = MCPClientManager()
