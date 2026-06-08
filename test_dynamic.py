import asyncio
from backend.council import stage4_generate_action_plan
from backend.mcp_tools import executor

async def main():
    print(await executor.get_tool_descriptions())
    print(await executor.get_tool_names())
    await executor._exit_stack.aclose()

asyncio.run(main())
