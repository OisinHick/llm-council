"""Council Autonomous Agent orchestration.

The Chairperson model acts as the executive agent, running a multi-step
ReAct loop to write code, generate documents, run commands, and verify results,
advised by cross-referenced Council deliberations.
"""

import asyncio
import json
import logging
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .agent_tools import agent_executor
from .config import get_chairman_model
from .council import run_sub_council
from .mcp_client_manager import mcp_manager
from .openrouter import query_model

logger = logging.getLogger("llm_council.agent")


class CouncilAgent:
    """Autonomous agent driven by the Council Chairperson model."""

    def __init__(
        self,
        user_request: str,
        initial_council: Dict[str, Any],
        max_steps: int = 20,
    ):
        self.user_request = user_request
        self.initial_council = initial_council
        self.max_steps = max_steps
        self.steps: List[Dict[str, Any]] = []
        self.artifacts: List[str] = []
        self.summary: Optional[str] = None
        self.is_completed: bool = False
        self.is_cancelled: bool = False
        self.error: Optional[str] = None

    def cancel(self):
        """Signal the agent to abort execution."""
        self.is_cancelled = True

    def _build_system_prompt(self, external_tools: List[Dict[str, Any]]) -> str:
        tools_doc = """Available Tools:
1. write_file: Create or overwrite a file with given content.
   Parameters: {"path": "file/path.ext", "content": "file text content"}

2. read_file: Read file contents with line numbers.
   Parameters: {"path": "file/path.ext", "start_line": optional int, "end_line": optional int}

3. edit_file: Exact search-and-replace edit within an existing file.
   Parameters: {"path": "file/path.ext", "target_content": "exact string to replace", "replacement_content": "new string"}

4. list_directory: List files and subdirectories.
   Parameters: {"path": "optional dir path, default .", "recursive": optional bool}

5. execute_command: Run a shell command in the workspace (e.g. bash, python, pytest, npm, linters).
   Parameters: {"command": "command string", "timeout": optional int seconds (default 60)}

6. consult_council: Consult the full LLM Council for multi-model cross-referenced answers on a tricky bug, architectural dilemma, code design, or fact verification.
   Parameters: {"question": "specific question for the council", "context": "relevant code, error trace, or context"}

7. complete_task: Declare the task completed when all deliverables, documents, code, and verification are finished.
   Parameters: {"summary": "detailed summary of what was accomplished and verified", "artifacts": ["list", "of", "created", "files"]}
"""
        if external_tools:
            tools_doc += "\nExternal Connected MCP Tools:\n"
            for t in external_tools:
                tools_doc += f"- {t['name']} (server: {t['server']}): {t['description']}\n"
                tools_doc += f"  Parameters Schema: {json.dumps(t.get('input_schema', {}))}\n"

        return f"""You are the Chairperson of the LLM Council, acting as an autonomous software engineer, architect, and technical writer.

Your goal is to accomplish the user's task with the highest precision, accuracy, and thoroughness.
You have at your disposal a cross-referenced Initial Council Deliberation produced by multiple AI models and peer-reviewed for quality.

CRITICAL OPERATIONAL RULES:
1. Always plan carefully before taking action.
2. Write complete, working, production-quality code and thorough, well-structured documents. Never leave placeholder comments like '// TODO' or '...rest of code...'.
3. Always verify your work! Use execute_command to run test scripts, compile code, execute tests, or check file outputs before calling complete_task.
4. If you face a complex bug, architectural fork, or need multi-perspective validation, use `consult_council` to obtain consensus from your AI council.
5. In every step, you MUST respond with a JSON object in this EXACT format (wrapped in ```json ... ``` or raw JSON):

```json
{{
  "thought": "Detailed reasoning about the current state, what was learned from the previous observation, and why this specific tool action is being taken.",
  "action": "tool_name",
  "params": {{
    // parameters matching the tool schema
  }}
}}
```
6. When all tasks, files, documents, and tests are complete, invoke the `complete_task` action.
"""

    def _format_initial_briefing(self) -> str:
        s3 = self.initial_council.get("stage3", {}).get("response", "No synthesis available.")
        rankings = self.initial_council.get("metadata", {}).get("aggregate_rankings", [])
        rankings_str = ", ".join(
            [f"{r.get('model', '').split('/')[-1]} (avg rank: {r.get('average_rank')})" for r in rankings]
        ) if rankings else "Council votes recorded."

        return f"""### INITIAL COUNCIL CROSS-REFERENCED BLUEPRINT & STRATEGY
The Council deliberated on this user request and produced the following consensus:
Peer Ranking Consensus: {rankings_str}

Consensus Synthesis & Strategy:
{s3}
"""

    def _extract_json(self, text: str) -> Optional[Dict[str, Any]]:
        """Extract and parse JSON from model output."""
        if not text:
            return None

        # Look for ```json ... ```
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # Look for outermost { ... }
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        return None

    async def run(
        self,
        on_event: Optional[Callable[[str, Dict[str, Any]], Awaitable[None]]] = None,
    ) -> Dict[str, Any]:
        """
        Execute the autonomous agent loop until task completion or max steps.
        """
        external_tools = await mcp_manager.get_available_tools()
        system_prompt = self._build_system_prompt(external_tools)
        initial_briefing = self._format_initial_briefing()

        # Build initial conversation history for Chairperson
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"USER TASK:\n{self.user_request}\n\n"
                    f"{initial_briefing}\n\n"
                    "Please begin executing the task step by step. Respond with your thought and first tool action."
                ),
            },
        ]

        if on_event:
            await on_event(
                "agent_loop_start",
                {
                    "user_request": self.user_request,
                    "max_steps": self.max_steps,
                },
            )

        chairman_model = get_chairman_model()

        step_count = 0
        while step_count < self.max_steps:
            if self.is_cancelled:
                self.error = "Agent execution was cancelled by user."
                if on_event:
                    await on_event("agent_cancelled", {"message": self.error})
                break

            step_count += 1

            if on_event:
                await on_event("agent_step_start", {"step": step_count})

            # Query the chairperson model
            response = await query_model(chairman_model, messages, timeout=120.0)
            if not response or not response.get("content"):
                self.error = f"Chairperson model ({chairman_model}) failed to respond at step {step_count}."
                if on_event:
                    await on_event("agent_error", {"error": self.error, "step": step_count})
                break

            response_text = response.get("content", "")
            parsed = self._extract_json(response_text)

            if not parsed or "action" not in parsed:
                # Prompt the model to correct its formatting
                messages.append({"role": "assistant", "content": response_text})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "ERROR: Could not parse your response. You MUST respond with a valid JSON object "
                            "containing 'thought', 'action', and 'params'. Example:\n"
                            '```json\n{"thought": "...", "action": "write_file", "params": {"path": "...", "content": "..."}}\n```'
                        ),
                    }
                )
                continue

            thought = parsed.get("thought", "")
            action = parsed.get("action", "")
            params = parsed.get("params", {})

            step_record: Dict[str, Any] = {
                "step": step_count,
                "thought": thought,
                "action": action,
                "params": params,
                "observation": None,
                "council_consultation": None,
            }

            if on_event:
                await on_event(
                    "agent_thought",
                    {
                        "step": step_count,
                        "thought": thought,
                        "action": action,
                        "params": params,
                    },
                )

            # Check for task completion
            if action == "complete_task":
                self.is_completed = True
                self.summary = params.get("summary", thought or "Task completed.")
                task_artifacts = params.get("artifacts", [])
                if isinstance(task_artifacts, list):
                    for a in task_artifacts:
                        if a not in self.artifacts:
                            self.artifacts.append(str(a))

                step_record["observation"] = {
                    "success": True,
                    "message": "Task completed successfully.",
                    "artifacts": self.artifacts,
                }
                self.steps.append(step_record)

                if on_event:
                    await on_event(
                        "agent_complete",
                        {
                            "summary": self.summary,
                            "artifacts": self.artifacts,
                            "total_steps": step_count,
                        },
                    )
                break

            # Execute tool action
            observation: Dict[str, Any] = {}
            council_data: Optional[Dict[str, Any]] = None

            try:
                if action == "write_file":
                    p = params.get("path", "")
                    c = params.get("content", "")
                    observation = await agent_executor.write_file(p, c)
                    if observation.get("success") and p not in self.artifacts:
                        self.artifacts.append(p)

                elif action == "read_file":
                    p = params.get("path", "")
                    s = params.get("start_line")
                    e = params.get("end_line")
                    observation = await agent_executor.read_file(p, s, e)

                elif action == "edit_file":
                    p = params.get("path", "")
                    t = params.get("target_content", "")
                    r = params.get("replacement_content", "")
                    observation = await agent_executor.edit_file(p, t, r)
                    if observation.get("success") and p not in self.artifacts:
                        self.artifacts.append(p)

                elif action == "list_directory":
                    p = params.get("path", ".")
                    rec = params.get("recursive", False)
                    observation = await agent_executor.list_directory(p, recursive=rec)

                elif action == "execute_command":
                    cmd = params.get("command", "")
                    tout = params.get("timeout", 60)
                    observation = await agent_executor.execute_command(cmd, timeout=tout)

                elif action == "consult_council":
                    q = params.get("question", "")
                    ctx = params.get("context", "")

                    if on_event:
                        await on_event(
                            "consult_council_start",
                            {"question": q, "context": ctx, "step": step_count},
                        )

                    async def sub_event_forwarder(sub_type, sub_data):
                        if on_event:
                            await on_event(
                                "sub_council_event",
                                {"event": sub_type, "data": sub_data, "step": step_count},
                            )

                    council_data = await run_sub_council(
                        q, context=ctx, on_event=sub_event_forwarder
                    )
                    observation = {
                        "success": True,
                        "consensus_recommendation": council_data.get("consensus_recommendation", ""),
                        "aggregate_rankings": council_data.get("aggregate_rankings", []),
                        "message": "Council cross-referencing completed.",
                    }

                    if on_event:
                        await on_event(
                            "consult_council_complete",
                            {
                                "step": step_count,
                                "council_data": council_data,
                            },
                        )
                else:
                    # Check if it is an external MCP tool
                    is_external = any(t["name"] == action for t in external_tools)
                    if is_external:
                        matching_tool = next(t for t in external_tools if t["name"] == action)
                        observation = await mcp_manager.call_tool(
                            matching_tool["server"], action, params
                        )
                    else:
                        observation = {
                            "success": False,
                            "error": f"Unknown tool: '{action}'. Consult tool documentation.",
                        }

            except Exception as ex:
                logger.exception("Error executing action %s", action)
                observation = {"success": False, "error": f"Execution error: {str(ex)}"}

            step_record["observation"] = observation
            step_record["council_consultation"] = council_data
            self.steps.append(step_record)

            if on_event:
                await on_event(
                    "agent_tool_result",
                    {
                        "step": step_count,
                        "action": action,
                        "observation": observation,
                    },
                )

            # Record in Chairperson conversation history
            messages.append({"role": "assistant", "content": response_text})
            obs_str = json.dumps(observation, indent=2)
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"TOOL '{action}' OBSERVATION:\n{obs_str}\n\n"
                        "Continue with your next thought and action, or complete_task if finished."
                    ),
                }
            )

        if not self.is_completed and not self.error and not self.is_cancelled:
            self.error = f"Reached maximum allowed steps ({self.max_steps}) without completion."
            if on_event:
                await on_event("agent_error", {"error": self.error})

        return {
            "success": self.is_completed,
            "steps": self.steps,
            "artifacts": self.artifacts,
            "summary": self.summary,
            "error": self.error,
        }
