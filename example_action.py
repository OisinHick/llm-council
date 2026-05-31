#!/usr/bin/env python3
"""
Example script demonstrating LLM Council MCP action execution.

This shows how to use the council to vote on approaches and execute them.
"""

import httpx
import json
import asyncio
import sys


async def perform_action(task: str, execute: bool = True, stream: bool = False):
    """
    Perform a task using the LLM Council with MCP action execution.
    
    Args:
        task: The task description
        execute: Whether to actually execute the action (default True)
        stream: Whether to stream results (default False)
    """
    
    url = "http://localhost:8001/api/action"
    if stream:
        url += "/stream"
    
    payload = {
        "request": task,
        "execute": execute
    }
    
    print(f"\n📋 Council Task: {task}\n")
    print(f"{'Execute' if execute else 'Plan only'} | {'Streaming' if stream else 'Full response'}\n")
    
    async with httpx.AsyncClient() as client:
        try:
            if stream:
                await stream_events(client, url, payload)
            else:
                await fetch_full_response(client, url, payload)
        except httpx.ConnectError:
            print("❌ Error: Could not connect to backend at localhost:8001")
            print("   Make sure the backend is running: python -m backend.main")
            sys.exit(1)
        except Exception as e:
            print(f"❌ Error: {e}")
            sys.exit(1)


async def stream_events(client, url: str, payload: dict):
    """Stream events from the council."""
    
    async with client.stream("POST", url, json=payload, timeout=600.0) as response:
        if response.status_code != 200:
            print(f"❌ Error: {response.status_code}")
            return
        
        async for line in response.aiter_lines():
            if line.startswith("data: "):
                try:
                    event = json.loads(line[6:])
                    print_event(event)
                except json.JSONDecodeError:
                    pass


def print_event(event: dict):
    """Pretty print an event."""
    
    event_type = event.get("type")
    
    if event_type == "stage1_start":
        print("🤔 Stage 1: Council members generating approaches...")
    elif event_type == "stage1_complete":
        data = event.get("data", [])
        print(f"✓ Stage 1 complete: {len(data)} approaches generated\n")
        for i, approach in enumerate(data, 1):
            model = approach.get("model", "Unknown").split("/")[-1]
            print(f"  {i}. {model}")
    
    elif event_type == "stage2_start":
        print("\n🗳️  Stage 2: Council voting on approaches (anonymized)...")
    elif event_type == "stage2_complete":
        print("✓ Stage 2 complete: Voting finished\n")
        metadata = event.get("metadata", {})
        rankings = metadata.get("aggregate_rankings", [])
        if rankings:
            print("  Results by vote:")
            for rank in rankings:
                model = rank.get("model", "Unknown").split("/")[-1]
                avg = rank.get("average_rank", 0)
                count = rank.get("rankings_count", 0)
                print(f"    • {model}: rank {avg} (from {count} votes)")
    
    elif event_type == "stage3_start":
        print("\n📝 Stage 3: Chairman synthesizing solution...")
    elif event_type == "stage3_complete":
        print("✓ Stage 3 complete: Solution synthesized")
    
    elif event_type == "stage4_start":
        print("\n⚙️  Stage 4: Generating action plan...")
    elif event_type == "stage4_action_plan":
        plan = event.get("data", {})
        if plan.get("success"):
            action = plan.get("action_plan", {})
            print(f"✓ Stage 4 complete: Action plan ready")
            print(f"  Description: {action.get('description', 'N/A')}")
            tool_calls = action.get("tool_calls", [])
            print(f"  Tools: {len(tool_calls)} actions to execute")
            for i, call in enumerate(tool_calls, 1):
                tool = call.get("tool", "unknown")
                desc = call.get("description", "")
                print(f"    {i}. {tool}: {desc}")
        else:
            print(f"✗ Failed to generate action plan: {plan.get('error', 'Unknown error')}")
    
    elif event_type == "execution_start":
        print("\n🚀 Executing action plan...")
    elif event_type == "execution_complete":
        result = event.get("data", {})
        if result.get("success"):
            print("✓ Execution complete: All actions succeeded!")
            exec_results = result.get("execution_results", {})
            for tool_result in exec_results.get("results", []):
                tool = tool_result.get("tool", "unknown")
                success = tool_result.get("result", {}).get("success", False)
                status = "✓" if success else "✗"
                print(f"  {status} {tool}")
        else:
            print(f"✗ Execution failed: {result.get('error', 'Unknown error')}")
    
    elif event_type == "complete":
        print("\n✅ Council process complete!\n")
    
    elif event_type == "error":
        print(f"\n❌ Error: {event.get('message', 'Unknown error')}\n")


async def fetch_full_response(client, url: str, payload: dict):
    """Fetch full response without streaming."""
    
    response = await client.post(url, json=payload, timeout=600.0)
    
    if response.status_code != 200:
        print(f"❌ Error: {response.status_code}")
        return
    
    result = response.json()
    
    # Summary
    print("=" * 60)
    print("COUNCIL PROCESS SUMMARY")
    print("=" * 60)
    
    # Stage 1
    stage1 = result.get("stage1", [])
    print(f"\n📝 Stage 1 - Approaches Generated: {len(stage1)}")
    for approach in stage1:
        model = approach.get("model", "Unknown").split("/")[-1]
        text = approach.get("response", "")[:100]
        print(f"  • {model}: {text}...")
    
    # Stage 2
    stage2 = result.get("stage2", [])
    metadata = result.get("metadata", {})
    rankings = metadata.get("aggregate_rankings", [])
    print(f"\n🗳️  Stage 2 - Voting Results:")
    for rank in rankings:
        model = rank.get("model", "Unknown").split("/")[-1]
        avg = rank.get("average_rank", 0)
        print(f"  • {model}: average rank {avg}")
    
    # Stage 3
    stage3 = result.get("stage3", {})
    print(f"\n✨ Stage 3 - Final Synthesis:")
    synthesis = stage3.get("response", "")[:200]
    print(f"  {synthesis}...")
    
    # Stage 4
    stage4 = result.get("stage4_action_plan", {})
    if stage4.get("success"):
        action = stage4.get("action_plan", {})
        print(f"\n⚙️  Stage 4 - Action Plan:")
        print(f"  {action.get('description', 'N/A')}")
        tools = action.get("tool_calls", [])
        print(f"  Tools: {len(tools)} actions")
    
    # Execution
    execution = result.get("execution", {})
    if execution:
        if execution.get("success"):
            print(f"\n✅ Execution - All actions succeeded!")
        else:
            print(f"\n❌ Execution - Failed: {execution.get('error', 'Unknown')}")
    
    print("\n" + "=" * 60)
    print("\nFull response:")
    print(json.dumps(result, indent=2))


async def main():
    """Main entry point."""
    
    # Example tasks
    examples = [
        ("basic", "List all files in /tmp directory", False),
        ("command", "Find all Python files in the current directory", False),
        ("plan", "Check system for open ports (plan only, don't execute)", False),
        ("network", "Scan localhost for open ports on common services", True),
    ]
    
    if len(sys.argv) > 1:
        task = " ".join(sys.argv[1:])
        execute = not task.startswith("--plan")
        if execute:
            await perform_action(task, execute=True, stream=True)
        else:
            task = task.replace("--plan ", "")
            await perform_action(task, execute=False, stream=True)
    else:
        print("LLM Council MCP Action Executor\n")
        print("Usage: python example_action.py [TASK DESCRIPTION]\n")
        print("Example tasks:")
        for label, task, execute in examples:
            cmd = f"python example_action.py {task}"
            marker = "(will execute)" if execute else "(plan only)"
            print(f"  {cmd} {marker}")
        
        print("\n" + "=" * 60)
        print("Running example: List files in /tmp")
        print("=" * 60)
        
        await perform_action("List all files in /tmp", execute=False, stream=True)


if __name__ == "__main__":
    asyncio.run(main())
