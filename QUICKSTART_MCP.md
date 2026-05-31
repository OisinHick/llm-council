# Quick Start: MCP Integration for LLM Council

## Installation

Install the new dependency:
```bash
pip install -e .
# or
pip install aiohttp>=3.9.0
```

## Start the Backend

```bash
python -m backend.main
```

The API will be available at `http://localhost:8001`

## Test the Integration

### Option 1: Using the Example Script

```bash
python example_action.py "List all files in /tmp directory"
```

Output shows real-time council voting and execution:
```
📋 Council Task: List all files in /tmp directory

🤔 Stage 1: Council members generating approaches...
✓ Stage 1 complete: 4 approaches generated

🗳️  Stage 2: Council voting on approaches (anonymized)...
✓ Stage 2 complete: Voting finished

📝 Stage 3: Chairman synthesizing solution...
✓ Stage 3 complete: Solution synthesized

⚙️  Stage 4: Generating action plan...
✓ Stage 4 complete: Action plan ready

🚀 Executing action plan...
✓ Execution complete: All actions succeeded!
```

### Option 2: Using curl

```bash
# Review the plan (don't execute yet)
curl -X POST http://localhost:8001/api/action \
  -H "Content-Type: application/json" \
  -d '{
    "request": "Find all Python files in current directory",
    "execute": false
  }' | jq

# Execute the plan
curl -X POST http://localhost:8001/api/action \
  -H "Content-Type: application/json" \
  -d '{
    "request": "Find all Python files in current directory",
    "execute": true
  }' | jq
```

### Option 3: Python Client

```python
import asyncio
import httpx

async def test():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8001/api/action",
            json={
                "request": "Check system uptime",
                "execute": True
            },
            timeout=300.0
        )
        result = response.json()
        
        # Check execution result
        if result.get("execution", {}).get("success"):
            print("✓ Task executed successfully!")
        else:
            print("✗ Task failed")

asyncio.run(test())
```

## Streaming Example

For real-time updates with Server-Sent Events:

```bash
curl -X POST http://localhost:8001/api/action/stream \
  -H "Content-Type: application/json" \
  -d '{
    "request": "Scan for common open ports",
    "execute": false
  }' \
  --stream | grep "data:"
```

## How It Works

1. **You submit a task** to the council
2. **Stage 1**: Council members each propose their approach
3. **Stage 2**: Members vote anonymously on the best approach  
4. **Stage 3**: Chairman synthesizes the top-voted approach
5. **Stage 4**: The chairman generates MCP tool calls to execute that approach
6. **Execution**: The tool calls are executed (if you set `execute: true`)

## Use Cases

### Security Assessment
```bash
python example_action.py "Check for common vulnerabilities: open SSH ports, weak sudo config, world-writable directories"
```

### System Monitoring
```bash
python example_action.py "Gather system information: OS, running services, disk usage, and save to /tmp/sysinfo.txt"
```

### Network Scanning
```bash
python example_action.py "Scan the local network 192.168.1.0/24 for active hosts and save results"
```

### File Analysis
```bash
python example_action.py "Find all executable files in /usr/local/bin and create a CSV with permissions"
```

## Available Tools

The council can use these tools to execute actions:

| Tool | Purpose |
|------|---------|
| `execute_command` | Run shell commands (Kali Linux tools, system commands) |
| `read_file` | Read file contents from filesystem |
| `write_file` | Create or modify files |
| `http_request` | Make API calls to external services |

## Review Before Executing

Always review the action plan before execution:

```bash
# Get the plan (don't execute)
curl -X POST http://localhost:8001/api/action \
  -H "Content-Type: application/json" \
  -d '{"request": "your task", "execute": false}' > plan.json

# Review the plan
cat plan.json | jq '.stage4_action_plan.action_plan'

# If it looks good, execute
curl -X POST http://localhost:8001/api/action \
  -H "Content-Type: application/json" \
  -d '{"request": "your task", "execute": true}'
```

## Response Structure

### Top-Level Fields

```json
{
  "stage1": [{"model": "...", "response": "..."}],
  "stage2": [{"model": "...", "ranking": "...", "parsed_ranking": [...]}],
  "stage3": {"model": "...", "response": "..."},
  "metadata": {
    "label_to_model": {...},
    "aggregate_rankings": [...]
  },
  "stage4_action_plan": {
    "success": true,
    "action_plan": {...},
    "best_response_model": "..."
  },
  "execution": {
    "success": true,
    "execution_results": {...}
  }
}
```

## Debugging

If a task fails:

1. **Check the action plan** - Is it correct?
2. **Check permissions** - Do you have permission for file operations?
3. **Check syntax** - Are commands valid?
4. **Simplify the request** - Try a simpler task first
5. **Check connectivity** - For API calls, verify network access

View full error details:
```bash
curl -X POST http://localhost:8001/api/action \
  -H "Content-Type: application/json" \
  -d '{"request": "your task", "execute": false}' | jq '.stage4_action_plan'
```

## More Information

- See [MCP_INTEGRATION.md](MCP_INTEGRATION.md) for complete documentation
- See [CLAUDE.md](CLAUDE.md) for architecture notes
- See [example_action.py](example_action.py) for code examples

## Key Features

✅ **Council Voting** - Multiple models vote on best approach  
✅ **Anonymous Peer Review** - Models don't know who proposed what  
✅ **Transparent Decision** - You see all proposals and votes  
✅ **Automated Execution** - Voted approach is automatically executed  
✅ **Flexible Tools** - Command execution, file ops, API calls  
✅ **Optional Execution** - Review plans before running  
✅ **Streaming Support** - Real-time updates via SSE  
✅ **Error Handling** - Graceful degradation on failures  

## Security Reminder ⚠️

The council will execute arbitrary commands. Use with caution:
- Only enable execution when sure about the task
- Run in isolated environments for sensitive operations
- Monitor execution results
- Review plans before executing (`execute: false` first)
