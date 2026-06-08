import inspect
import sys
import os
import asyncio

sys.path.insert(0, os.path.abspath('.'))

from backend.mcp_tools import MCPToolExecutor

async def main():
    executor = MCPToolExecutor()
    await executor._ensure_connected()
    
    print("--- Local Tools ---")
    for name, method in inspect.getmembers(executor, predicate=inspect.ismethod):
        if not name.startswith('_') and name not in ['execute_tools', 'get_tool_descriptions', 'get_tool_names', 'connect_mcp_servers']:
            doc = inspect.getdoc(method)
            if doc:
                first_line = doc.strip().split('\n')[0]
                print(f"- {name}: {first_line}")
                
    print("\n--- Remote MCP Tools ---")
    for t in executor.mcp_tools:
        print(f"- {t['name']} (from {t['server']}): {t['description']}")
        
    await executor._exit_stack.aclose()

if __name__ == "__main__":
    asyncio.run(main())
