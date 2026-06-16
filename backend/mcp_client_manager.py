"""Manager for connecting to and orchestrating multiple stdio-based MCP servers."""

import base64
import json
import logging
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any, Dict, List, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger("llm_council.mcp_client_manager")


class MCPClientManager:
    """Orchestrates standard stdio MCP client connections to external servers."""

    def __init__(self):
        self.sessions: Dict[str, ClientSession] = {}
        self.exit_stack: Optional[AsyncExitStack] = None
        self.config_path = Path(__file__).resolve().parent.parent / "mcp_servers.json"

    async def start_all_servers(self):
        """Load mcp_servers.json config and start all servers."""
        if not self.config_path.exists():
            logger.warning(f"MCP servers config file not found at {self.config_path}")
            return

        try:
            with open(self.config_path, "r") as f:
                config_data = json.load(f)
            servers = config_data.get("mcpServers", {})
        except Exception as e:
            logger.error(f"Failed to read mcp_servers.json: {e}")
            return

        self.exit_stack = AsyncExitStack()

        for name, server_config in servers.items():
            command = server_config.get("command")
            args = server_config.get("args", [])
            env = server_config.get("env")

            if not command:
                logger.warning(
                    f"Server '{name}' configuration is missing 'command'. Skipping."
                )
                continue

            logger.info(
                f"Starting MCP server '{name}' via command: {command} {args}"
            )
            try:
                # Wrap the server invocation in a python filter script that swallows non-JSON lines
                # from stdout (e.g. npm installs, node version warnings, progress bars).
                full_cmd = [command] + args
                
                filter_script = f"""
import subprocess, sys, threading, json

proc = subprocess.Popen(
    {repr(full_cmd)},
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=sys.stderr
)

def pipe_stdin():
    try:
        for line in iter(sys.stdin.buffer.readline, b''):
            proc.stdin.write(line)
            proc.stdin.flush()
    except Exception:
        pass

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
                encoded_script = base64.b64encode(filter_script.encode('utf-8')).decode('utf-8')
                wrapped_command = "python"
                wrapped_args = ["-u", "-c", f"import base64; exec(base64.b64decode('{encoded_script}').decode('utf-8'))"]

                params = StdioServerParameters(command=wrapped_command, args=wrapped_args, env=env)
                
                # Enter stdio client context
                read, write = await self.exit_stack.enter_async_context(
                    stdio_client(params)
                )
                session = await self.exit_stack.enter_async_context(
                    ClientSession(read, write)
                )
                await session.initialize()
                self.sessions[name] = session
                logger.info(f"Successfully connected to MCP server '{name}'")
            except Exception as e:
                logger.error(f"Failed to start MCP server '{name}': {e}")

    async def stop_all_servers(self):
        """Stop all started MCP servers and clean up resources."""
        if self.exit_stack:
            logger.info("Stopping all MCP servers...")
            await self.exit_stack.aclose()
            self.sessions.clear()
            self.exit_stack = None
            logger.info("All MCP servers stopped.")

    async def get_available_tools(self) -> List[Dict[str, Any]]:
        """
        List all available tools exposed by all running servers.

        Returns:
            List of dicts representing tools, each with server, name, description, schema
        """
        all_tools = []
        for server_name, session in self.sessions.items():
            try:
                result = await session.list_tools()
                tools_list = getattr(result, "tools", [])
                for tool in tools_list:
                    all_tools.append(
                        {
                            "server": server_name,
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.inputSchema,
                        }
                    )
            except Exception as e:
                logger.error(
                    f"Failed to list tools for server '{server_name}': {e}"
                )
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
