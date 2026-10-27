"""Manager for connecting to and orchestrating multiple stdio-based MCP servers.

This module implements the client management layer for the Model Context Protocol (MCP),
allowing LLM Council to discover, connect to, monitor, and execute tools exposed by external
stdio MCP server processes (e.g., kali-tools, filesystem servers, memory servers, git tools).

Key Architecture & Robustness Mechanisms:
    1. Subprocess Stdio Isolation & Stream Filtering:
       - External MCP servers (such as npm packages or npx runners) frequently emit noisy,
         non-JSON text to standard output during startup (e.g. npm update notices, node version
         warnings, compilation logs, or progress bars).
       - Because the MCP JSON-RPC protocol specification mandates that stdout carry strictly
         valid JSON-RPC frames, arbitrary non-JSON stdout lines will immediately corrupt the
         transport session and terminate the connection.
       - To solve this, `start_server` wraps the server invocation in a lightweight Python
         filter subprocess that intercepts stdout, validates each line as valid JSON, and only
         passes validated JSON-RPC lines downstream to the MCP ClientSession while discarding noise.
    2. Atomic Configuration Management:
       - Configured servers and their enabled/disabled states are stored in `mcp_servers.json`.
       - All modifications to `mcp_servers.json` use atomic temporary file replacement (`os.replace`)
         and `os.fsync`.
    3. Health Checks & Resilient Tool Discovery:
       - Servers like `kali-tools` depend on background docker containers; health checks are
         performed before routing calls to avoid cascading failures.
       - A background polling loop (`_poll_servers_loop`) periodically reconciles server states
         and refreshes available tool schemas in the background.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import tempfile
import urllib.request
from contextlib import AsyncExitStack, suppress
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger("llm_council.mcp_client_manager")


def check_kali_tools_health() -> bool:
    """Check if the Kali Linux tools HTTP backend service is healthy and responding.

    Probes the health endpoint specified by `KALI_API_URL` (default: http://127.0.0.1:5000/health)
    with a short 2-second timeout.

    Returns:
        bool: True if the endpoint returns HTTP 200, False otherwise.
    """
    url = os.environ.get("KALI_API_URL", "http://127.0.0.1:5000") + "/health"
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return response.getcode() == 200
    except Exception:
        return False


class MCPClientManager:
    """Orchestrates standard stdio MCP client connections to external tool servers.

    Manages the lifecycle of subprocess-based MCP servers:
      - Starts and stops subprocesses safely.
      - Maintains active `ClientSession` instances inside an `AsyncExitStack`.
      - Exposes aggregated tool definitions across all enabled servers.
      - Routes tool execution calls to the appropriate running server session.
    """

    def __init__(self) -> None:
        """Initialize the MCP client manager with empty sessions, caches, and file paths."""
        self.sessions: dict[str, ClientSession] = {}
        self.exit_stacks: dict[str, AsyncExitStack] = {}
        self.config_path: Path = (
            Path(__file__).resolve().parent.parent / "mcp_servers.json"
        )
        self.configured_servers: list[str] = []
        self.server_statuses: dict[str, str] = {}
        self.cached_tools: list[dict[str, Any]] = []
        self.polling_task: asyncio.Task | None = None

    def _read_config(self) -> dict[str, Any]:
        """Read and parse the `mcp_servers.json` configuration file from disk.

        Returns:
            dict[str, Any]: Parsed configuration dictionary with a 'mcpServers' object mapping,
                or a default empty schema `{"mcpServers": {}}` if missing or unparseable.
        """
        if not self.config_path.exists():
            return {"mcpServers": {}}
        try:
            with self.config_path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error("Failed to read mcp_servers.json: %s", e)
            return {"mcpServers": {}}

    def _write_config(self, config_data: dict[str, Any]) -> None:
        """Write updated configuration to `mcp_servers.json` using atomic temporary file write.

        Args:
            config_data: Complete MCP configuration dictionary to persist.

        Raises:
            OSError: If temporary file writing or replacement fails.
        """
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w",
                dir=str(self.config_path.parent),
                delete=False,
                encoding="utf-8",
            ) as tf:
                json.dump(config_data, tf, indent=2)
                tf.write("\n")
                tf.flush()
                os.fsync(tf.fileno())
                temp_name = tf.name
            os.replace(temp_name, self.config_path)
        except Exception as e:
            logger.error("Failed to write mcp_servers.json: %s", e)
            raise

    def is_server_enabled(
        self, name: str, config_data: dict[str, Any] | None = None
    ) -> bool:
        """Check whether a given MCP server is enabled in configuration.

        Defaults to True unless the server configuration explicitly specifies
        `disabled: true` or `enabled: false`.

        Args:
            name: Server name key in `mcp_servers.json`.
            config_data: Pre-loaded configuration data. If None, reads fresh
                configuration from disk.

        Returns:
            bool: True if the server is enabled and allowed to run, False otherwise.
        """
        if config_data is None:
            config_data = self._read_config()
        servers = config_data.get("mcpServers", {})
        srv = servers.get(name, {})
        if srv.get("disabled") is True:
            return False
        return srv.get("enabled", True)

    async def start_server(self, name: str, server_config: dict[str, Any]) -> bool:
        """Start an individual MCP server process, filter its stdout, and establish a ClientSession.

        Launches the server executable via a Python wrapper script that filters out non-JSON
        stdout lines before feeding them into the stdio transport. Initializes the client session
        and records the server status.

        Args:
            name: Identifier name for the server (e.g. 'kali-tools').
            server_config: Server configuration containing 'command', optional 'args',
                and optional 'env' variables.

        Returns:
            bool: True if connection succeeded, False if configuration was invalid or launch failed.
        """
        # Stop any existing instance first to prevent orphan subprocesses
        await self.stop_server(name)

        command = server_config.get("command")
        args = server_config.get("args", [])
        env = server_config.get("env")

        if not command:
            logger.warning(
                "Server '%s' configuration is missing 'command'. Skipping.", name
            )
            self.server_statuses[name] = "configuration_error"
            return False

        logger.info("Starting MCP server '%s' via command: %s %s", name, command, args)
        stack = AsyncExitStack()
        try:
            full_cmd = [command, *args]

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
            encoded_script = base64.b64encode(filter_script.encode("utf-8")).decode(
                "utf-8"
            )
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
            logger.info("Successfully connected to MCP server '%s'", name)
            return True
        except Exception as e:
            logger.error("Failed to start MCP server '%s': %s", name, e)
            self.server_statuses[name] = f"failed: {e}"
            with suppress(Exception):
                await stack.aclose()
            return False

    async def stop_server(self, name: str) -> None:
        """Stop an individual running MCP server and release all associated resources.

        Closes the server's `AsyncExitStack`, terminates the subprocess, and removes
        its registered session and cached tools.

        Args:
            name: Identifier of the server to stop.
        """
        stack = self.exit_stacks.pop(name, None)
        if stack:
            try:
                logger.info("Stopping MCP server '%s'...", name)
                await stack.aclose()
            except Exception as e:
                logger.warning("Error closing exit stack for '%s': %s", name, e)

        self.sessions.pop(name, None)
        # Remove cached tools belonging to this stopped server
        self.cached_tools = [t for t in self.cached_tools if t.get("server") != name]

    async def start_all_servers(self) -> None:
        """Load `mcp_servers.json` configuration and start all enabled servers.

        Populates initial tools cache and launches background status polling task.
        """
        config_data = self._read_config()
        servers = config_data.get("mcpServers", {})

        self.configured_servers = list(servers.keys())
        self.server_statuses = {}

        for name, server_config in servers.items():
            if self.is_server_enabled(name, config_data):
                await self.start_server(name, server_config)
            else:
                self.server_statuses[name] = "disabled"
                logger.info("MCP server '%s' is disabled; skipping startup.", name)

        # Run initial tools check to populate the cache
        await self.get_available_tools(bypass_cache=True)
        # Start background polling task
        if not self.polling_task:
            self.polling_task = asyncio.create_task(self._poll_servers_loop())

    async def stop_all_servers(self) -> None:
        """Stop all running MCP servers, cancel background polling, and clean up resources."""
        if self.polling_task:
            self.polling_task.cancel()
            self.polling_task = None

        for name in list(self.exit_stacks.keys()):
            await self.stop_server(name)

        self.sessions.clear()
        self.exit_stacks.clear()
        self.cached_tools.clear()
        logger.info("All MCP servers stopped.")

    async def set_server_enabled(self, name: str, enabled: bool) -> dict[str, Any]:
        """Enable or disable a specific MCP server, update configuration, and adjust runtime state.

        If enabled=True, writes config and launches the server subprocess.
        If enabled=False, writes config and terminates the server subprocess.

        Args:
            name: Server identifier name.
            enabled: New enabled status.

        Returns:
            dict[str, Any]: Summary dictionary containing name, enabled, status, servers metadata, and tools list.

        Raises:
            ValueError: If the requested server is not defined in `mcp_servers.json`.
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

    def get_servers_metadata(self) -> list[dict[str, Any]]:
        """Return structured status and configuration metadata for all configured MCP servers.

        Reads configuration and collects runtime status ('connected', 'disconnected', 'disabled',
        or error description) along with tool counts for each server.

        Returns:
            list[dict[str, Any]]: List of server metadata dictionaries, each containing:
                - "name" (str): Unique server identifier.
                - "enabled" (bool): Whether the server is active.
                - "status" (str): Runtime status description.
                - "command" (str): Executable command string.
                - "args" (list[str]): Command line arguments.
                - "tools_count" (int): Number of tools registered by this server.
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
                    "env": cfg.get("env"),
                    "tools_count": tool_count,
                }
            )
        return metadata

    async def add_server(
        self,
        name: str,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        enabled: bool = True,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Add a new MCP server configuration and optionally start its process.

        Args:
            name: Identifier name for the server (letters, numbers, hyphens, underscores, dots).
            command: Executable command (e.g. 'npx', 'uvx', 'python').
            args: Command line arguments list.
            env: Environment variables dict.
            enabled: Whether to enable and start the server immediately.
            overwrite: Whether to allow overwriting an existing server configuration.

        Returns:
            dict[str, Any]: Result dictionary containing name, enabled, status, servers, and tools.

        Raises:
            ValueError: If name or command is invalid, or server already exists and overwrite is False.
        """
        clean_name = name.strip() if name else ""
        if not clean_name:
            raise ValueError("Server name cannot be empty.")
        if not re.match(r"^[a-zA-Z0-9_\-\.]+$", clean_name):
            raise ValueError(
                "Server name can only contain letters, numbers, hyphens, underscores, and dots."
            )

        clean_cmd = command.strip() if command else ""
        if not clean_cmd:
            raise ValueError("Command cannot be empty.")

        config_data = self._read_config()
        servers = config_data.setdefault("mcpServers", {})

        if clean_name in servers and not overwrite:
            raise ValueError(f"MCP server '{clean_name}' already exists.")

        clean_args = [str(a) for a in (args or [])]
        clean_env = (
            {str(k).strip(): str(v) for k, v in env.items() if str(k).strip()}
            if env
            else None
        )

        server_entry: dict[str, Any] = {
            "command": clean_cmd,
            "args": clean_args,
            "enabled": bool(enabled),
        }
        if clean_env:
            server_entry["env"] = clean_env

        servers[clean_name] = server_entry
        self._write_config(config_data)
        self.configured_servers = list(servers.keys())

        if enabled:
            await self.start_server(clean_name, server_entry)
        else:
            await self.stop_server(clean_name)
            self.server_statuses[clean_name] = "disabled"

        # Refresh tools cache
        await self.get_available_tools(bypass_cache=True)

        return {
            "name": clean_name,
            "enabled": bool(enabled),
            "status": self.server_statuses.get(clean_name, "unknown"),
            "servers": self.get_servers_metadata(),
            "tools": self.cached_tools,
        }

    async def remove_server(self, name: str) -> dict[str, Any]:
        """Remove an MCP server from configuration and terminate its session.

        Args:
            name: Identifier name of server to remove.

        Returns:
            dict[str, Any]: Result dictionary with deleted flag, servers metadata, and tools list.

        Raises:
            ValueError: If server is not found in configuration.
        """
        config_data = self._read_config()
        servers = config_data.get("mcpServers", {})

        if name not in servers:
            raise ValueError(f"MCP server '{name}' not found.")

        # Stop server process and clear exit stack/session/cache
        await self.stop_server(name)
        self.server_statuses.pop(name, None)

        del servers[name]
        self._write_config(config_data)
        self.configured_servers = list(servers.keys())

        # Refresh tools cache
        await self.get_available_tools(bypass_cache=True)

        return {
            "name": name,
            "deleted": True,
            "servers": self.get_servers_metadata(),
            "tools": self.cached_tools,
        }

    async def _poll_servers_loop(self) -> None:
        """Background coroutine that periodically refreshes tools and connection statuses.

        Runs continuously every 10 seconds until cancelled on shutdown. Safely catches and logs
        any exceptions to keep the polling worker alive.
        """
        while True:
            try:
                await self.get_available_tools(bypass_cache=True)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in MCP polling loop: %s", e)
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                break

    async def get_available_tools(
        self, bypass_cache: bool = False
    ) -> list[dict[str, Any]]:
        """Discover and aggregate all tools exposed by enabled and running MCP servers.

        Queries each connected `ClientSession` via `session.list_tools()`. For special services
        like `kali-tools`, verifies container health before attempting tool discovery.
        Updates the internal cache (`self.cached_tools`) and server health statuses.

        Args:
            bypass_cache: If True, queries all active server sessions over stdio;
                if False and cached tools exist, returns the cached tool definitions immediately.

        Returns:
            list[dict[str, Any]]: List of available tool definitions, each containing:
                - "server" (str): Originating MCP server name.
                - "name" (str): Function/tool identifier.
                - "description" (str): Human and LLM readable documentation.
                - "input_schema" (dict): JSON Schema describing accepted arguments.
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

            if server_name == "kali-tools" and not check_kali_tools_health():
                self.server_statuses[server_name] = (
                    "error: Kali Linux Docker backend is offline"
                )
                continue

            try:
                result = await session.list_tools()
                tools_list = getattr(result, "tools", [])
                for tool in tools_list:
                    schema = getattr(
                        tool, "input_schema", getattr(tool, "inputSchema", {})
                    )
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
                logger.error("Failed to list tools for server '%s': %s", server_name, e)
                self.server_statuses[server_name] = f"error: {e}"

        self.cached_tools = all_tools
        return all_tools

    async def call_tool(
        self, server_name: str, tool_name: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute a tool call against a specific running MCP server.

        Validates that the server is enabled and running, invokes `session.call_tool(...)`,
        parses TextContent elements out of the returned MCP content list, and returns
        a standardized success/failure payload.

        Args:
            server_name: Identifier name of target MCP server (e.g. 'kali-tools').
            tool_name: Name of the tool function to call on the server.
            arguments: Dictionary of arguments matching the tool's input schema.

        Returns:
            dict[str, Any]: Standardized execution outcome dictionary:
                - "success" (bool): True if tool executed without error.
                - "content" (str): Consolidated textual output from tool response.
                - "raw_result" (str): String representation of the raw protocol response.
                - "error" (str, optional): Error message if execution failed.
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
                "Calling tool '%s' on server '%s' with args: %s",
                tool_name,
                server_name,
                arguments,
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
                "Error calling tool '%s' on server '%s': %s",
                tool_name,
                server_name,
                e,
            )
            return {"success": False, "error": str(e)}


# Global client manager singleton
mcp_manager = MCPClientManager()
