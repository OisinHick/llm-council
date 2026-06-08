import inspect
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from backend.mcp_tools import MCPToolExecutor

executor = MCPToolExecutor()
for name, method in inspect.getmembers(executor, predicate=inspect.ismethod):
    if not name.startswith('_') and name not in ['execute_tools', 'get_tool_descriptions']:
        doc = inspect.getdoc(method)
        if doc:
            first_line = doc.strip().split('\n')[0]
            print(f"- {name}: {first_line}")
