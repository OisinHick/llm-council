import asyncio
from backend.council import stage4_generate_action_plan
from backend.mcp_tools import executor

async def main():
    print(executor.get_tool_descriptions())
    print(executor.get_tool_names())

asyncio.run(main())
