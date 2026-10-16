"""3-stage LLM Council orchestration.

This module coordinates multi-model deliberation through a structured consensus pipeline:
- Stage 1 (Divergence): Concurrently queries all configured council models with the user
  prompt to gather diverse, independent perspectives without cross-contamination.
- Stage 2 (Blind Peer Review & Ranking): Anonymizes each response under synthetic labels
  ('Response A', 'Response B', ...) to eliminate brand bias. Council models evaluate and rank
  their peers' answers, from best to worst.
- Stage 3 (Convergence & Synthesis): The Chairman model inspects the full council
  transcripts—including individual proposals and peer ranking distributions—and synthesizes
  a final authoritative consensus answer.
- Stage 4 (Action Planning): Translates the top-ranked solution into concrete, schema-valid
  tool calls for execution across local primitives or external MCP servers.
- Sub-Council Deliberation: Enables the autonomous agent to spin up on-demand micro-councils
  with streaming event callbacks for architectural dilemmas or error diagnostics.
"""

import json
import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from .config import get_chairman_model, get_council_models
from .mcp_client_manager import mcp_manager
from .mcp_tools import executor
from .openrouter import query_model, query_models_parallel

logger = logging.getLogger("llm_council.council")

# Precompiled regular expressions for robust parsing of model rankings and JSON payloads
_RE_FINAL_RANKING_HEADER = re.compile(r"FINAL RANKING:\s*(.*)", re.DOTALL | re.IGNORECASE)
_RE_NUMBERED_RESPONSE = re.compile(r"\d+\.\s*Response\s*([A-Z])", re.IGNORECASE)
_RE_RESPONSE_LABEL = re.compile(r"Response\s*([A-Z])", re.IGNORECASE)
_RE_JSON_CODE_BLOCK = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_RE_OUTER_JSON = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """Helper to safely extract and parse a JSON dictionary from raw LLM text.

    Uses a two-phase extraction strategy:
    1. Attempts to locate a fenced markdown code block (````json ... ````).
    2. Falls back to finding the outermost matching curly braces (`{...}`).

    Args:
        text: Raw text response received from an LLM.

    Returns:
        Optional[Dict[str, Any]]: Parsed JSON dictionary if valid, or None if extraction failed.
    """
    if not text:
        return None
    # 1. Try markdown code block
    m = _RE_JSON_CODE_BLOCK.search(text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 2. Try outer bracket search
    m = _RE_OUTER_JSON.search(text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return None


async def stage1_collect_responses(user_query: str) -> List[Dict[str, Any]]:
    """Stage 1: Collect individual responses from all council models.

    Fans out parallel queries to all models configured in the council using
    `query_models_parallel` with a 180-second timeout. Filters out any models
    that failed or timed out, returning only successful outputs with token usage.

    Args:
        user_query: The user's input query or problem statement.

    Returns:
        List[Dict[str, Any]]: List of response dictionaries, each containing:
            - model (str): OpenRouter model identifier.
            - response (str): Generated textual response.
            - usage (dict): Token consumption dictionary (prompt, completion, total).
    """
    messages = [{"role": "user", "content": user_query}]

    # Query all models in parallel with an overall timeout of 180 seconds
    responses = await query_models_parallel(get_council_models(), messages, timeout=180.0)

    # Format results, filtering out models that timed out or errored (response is None)
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append(
                {
                    "model": model,
                    "response": response.get("content", ""),
                    "usage": response.get(
                        "usage",
                        {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    ),
                }
            )

    return stage1_results


async def stage2_collect_rankings(
    user_query: str, stage1_results: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Stage 2: Each model ranks the anonymized responses.

    To eliminate brand bias and ensure impartial peer review:
    1. Maps each model's Stage 1 response to an anonymous label ('Response A', 'Response B', ...).
    2. Builds a structured evaluation prompt presenting all anonymized proposals.
    3. Dispatches the prompt in parallel to all council models.
    4. Parses the model's critique and structured 'FINAL RANKING:' section.

    Args:
        user_query: The original user question.
        stage1_results: The collection of responses gathered in Stage 1.

    Returns:
        Tuple[List[Dict[str, Any]], Dict[str, str]]:
            - stage2_results: List of per-model evaluation dictionaries with raw text,
              parsed ranking order, and token usage.
            - label_to_model: Dictionary mapping anonymous labels to real model IDs.
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result["model"]
        for label, result in zip(labels, stage1_results)
    }

    # Build the ranking prompt with anonymized proposals
    responses_text = "\n\n".join(
        [
            f"Response {label}:\n{result['response']}"
            for label, result in zip(labels, stage1_results)
        ]
    )

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel with an overall timeout
    responses = await query_models_parallel(get_council_models(), messages, timeout=90.0)

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get("content", "")
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append(
                {
                    "model": model,
                    "ranking": full_text,
                    "parsed_ranking": parsed,
                    "usage": response.get(
                        "usage",
                        {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    ),
                }
            )

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Stage 3: Chairman synthesizes final response based on Stage 1 & 2 outputs.

    Provides the Chairman model with:
    - Full individual model responses from Stage 1.
    - Peer reviews, rankings, and critique summaries from Stage 2.
    Instructs the Chairman to synthesize an authoritative, coherent solution reflecting
    the collective consensus and resolving conflicting claims.

    Args:
        user_query: The original user question.
        stage1_results: Individual model responses from Stage 1.
        stage2_results: Evaluations and rankings from Stage 2.

    Returns:
        Dict[str, Any]: Result dictionary containing:
            - model (str): Chairman model identifier.
            - response (str): Synthesized final response.
            - usage (dict): Token consumption dictionary.
    """
    # Build comprehensive context for chairman
    stage1_text = "\n\n".join(
        [
            f"Model: {result['model']}\nResponse: {result['response']}"
            for result in stage1_results
        ]
    )

    stage2_text = "\n\n".join(
        [
            f"Model {result['model']} ranking: {', '.join(result.get('parsed_ranking', []))}\nEvaluation Summary: {result['ranking'][:400]}..."
            if len(result.get('ranking', '')) > 400
            else f"Model {result['model']} ranking: {', '.join(result.get('parsed_ranking', []))}\nEvaluation: {result.get('ranking', '')}"
            for result in stage2_results
        ]
    )

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Ranking Summaries:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model with 120s timeout
    chairman = get_chairman_model()
    response = await query_model(chairman, messages, timeout=120.0)

    if response is None:
        # Fallback if chairman query times out or fails
        return {
            "model": chairman,
            "response": "Error: Unable to generate final synthesis.",
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    return {
        "model": chairman,
        "response": response.get("content", ""),
        "usage": response.get(
            "usage",
            {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        ),
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """Parse the FINAL RANKING section from a model's Stage 2 evaluation text.

    Extraction order:
    1. Identifies the "FINAL RANKING:" header and restricts search to text following it.
    2. Searches for numbered entries (e.g. "1. Response A", "2. Response B").
    3. If no numbered list is found, searches for all occurrences of "Response X" in order.
    4. If the section was not found or yielded nothing, falls back to scanning the entire text.

    Args:
        ranking_text: Raw evaluation string returned by a council model.

    Returns:
        List[str]: Ordered list of normalized response labels (e.g., ["Response A", "Response B"]).
    """
    if not ranking_text:
        return []

    # Look for "FINAL RANKING:" section
    m_section = _RE_FINAL_RANKING_HEADER.search(ranking_text)
    search_target = m_section.group(1) if m_section else ranking_text

    # Extract numbered list format (e.g., "1. Response A" -> "Response A")
    numbered_matches = _RE_NUMBERED_RESPONSE.findall(search_target)
    if numbered_matches:
        return [f"Response {letter.upper()}" for letter in numbered_matches]

    # Fallback: Extract all "Response X" patterns in order
    matches = _RE_RESPONSE_LABEL.findall(search_target)
    if matches:
        return [f"Response {letter.upper()}" for letter in matches]

    # Overall fallback across entire response text if not found in section
    if search_target != ranking_text:
        fallback_matches = _RE_RESPONSE_LABEL.findall(ranking_text)
        return [f"Response {letter.upper()}" for letter in fallback_matches]

    return []


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]], label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """Calculate aggregate rankings across all models.

    Computes the arithmetic mean rank position for each model across all
    peer votes. Lower average rank numbers indicate higher peer preference
    (1.0 is the best possible score).

    Args:
        stage2_results: List of Stage 2 evaluation dicts containing parsed rankings.
        label_to_model: Mapping from anonymous labels ('Response A') to model IDs.

    Returns:
        List[Dict[str, Any]]: List of ranking summary dicts sorted best to worst:
            - model (str): Model identifier.
            - average_rank (float): Average position assigned by peers.
            - rankings_count (int): Number of models that ranked this proposal.
    """
    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking["ranking"]

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append(
                {
                    "model": model,
                    "average_rank": round(avg_rank, 2),
                    "rankings_count": len(positions),
                }
            )

    # Sort by average rank (lower is better, e.g. 1.0 > 2.5)
    aggregate.sort(key=lambda x: x["average_rank"])

    return aggregate


async def generate_conversation_title(
    user_query: str, conversation_id: Optional[str] = None
) -> str:
    """Generate a short title for a conversation based on the first user message.

    Prompts the Chairman model to produce a concise 3-5 word summary without quotes.
    If a `conversation_id` is supplied, records the token usage in conversation storage.

    Args:
        user_query: The initial user message text.
        conversation_id: Optional UUID of the conversation for token tracking.

    Returns:
        str: Cleaned conversation title string (at most 50 characters).
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use chairman model for title generation
    chairman = get_chairman_model()
    response = await query_model(chairman, messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title if chairman query fails
        return "New Conversation"

    if conversation_id and response.get("usage"):
        try:
            from . import storage
            storage.record_standalone_tokens(
                conversation_id, chairman, response.get("usage")
            )
        except Exception as e:
            logger.debug("Could not record standalone tokens for conversation %s: %s", conversation_id, e)

    title = response.get("content", "New Conversation").strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip("\"'")

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def run_full_council(user_query: str) -> Tuple[List, List, Dict, Dict]:
    """Run the complete 3-stage council deliberation pipeline.

    1. Executes Stage 1 to collect independent responses from all council models.
    2. Handles total failure fallback if no models responded.
    3. Executes Stage 2 to collect blind peer rankings and computes aggregate scores.
    4. Executes Stage 3 to produce the Chairman's synthesized consensus answer.

    Args:
        user_query: The user's question or prompt.

    Returns:
        Tuple[List, List, Dict, Dict]:
            - stage1_results: Individual model responses.
            - stage2_results: Peer evaluations and parsed rankings.
            - stage3_result: Final synthesis dictionary from Chairman.
            - metadata: Auxiliary data (label_to_model map, aggregate rankings).
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query)

    # If no models responded successfully, return error
    if not stage1_results:
        return (
            [],
            [],
            {
                "model": "error",
                "response": "All models failed to respond. Please try again.",
            },
            {},
        )

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(
        user_query, stage1_results
    )

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query, stage1_results, stage2_results
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings,
    }

    return stage1_results, stage2_results, stage3_result, metadata


async def stage4_generate_action_plan(
    user_request: str,
    stage1_results: List[Dict[str, Any]],
    aggregate_rankings: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Stage 4: Generate an executable tool action plan based on the top-ranked response.

    Identifies the model voted #1 by the council peers, gathers all currently
    available tool schemas (local primitives and external MCP tools), and prompts
    the Chairman to translate the recommended solution into a structured JSON
    action plan with specific tool calls.

    Args:
        user_request: The original user request or operational task.
        stage1_results: Individual model responses from Stage 1.
        aggregate_rankings: Sorted aggregate rankings from Stage 2.

    Returns:
        Dict[str, Any]: Generation outcome dictionary containing:
            - success (bool): True if a valid action plan was generated and parsed.
            - action_plan (dict, optional): Parsed JSON action plan with description,
              reasoning, and list of tool calls.
            - best_response_model (str): Name of the model whose response was selected.
            - error (str, optional): Diagnostic error message on failure.
    """
    # Find the best response based on aggregate rankings
    if not aggregate_rankings or not stage1_results:
        return {
            "success": False,
            "error": "No valid responses to generate action plan from",
        }

    # Get the top-ranked response model
    best_model_name = aggregate_rankings[0]["model"]
    best_response = None
    for result in stage1_results:
        if result["model"] == best_model_name:
            best_response = result["response"]
            break

    if not best_response:
        return {"success": False, "error": "Could not find the best response"}

    # Gather external tools from the manager
    external_tools = await mcp_manager.get_available_tools()

    # Document local legacy tools
    tools_doc = """1. Local Tools (server: "local"):
   - execute_command: Run shell/system commands (ideal for Kali Linux tools)
     Parameters: {"command": str, "timeout": int (optional, default 30)}
   - read_file: Read file contents from filesystem
     Parameters: {"path": str}
   - write_file: Create/modify files
     Parameters: {"path": str, "content": str, "mode": "write"|"append" (optional, default "write")}
   - http_request: Send HTTP requests to external APIs
     Parameters: {"method": "GET"|"POST"|..., "url": str, "headers": dict (optional), "data": dict (optional), "timeout": int (optional)}
"""

    # Document dynamically loaded external tools
    if external_tools:
        tools_doc += "\n2. External MCP Server Tools:\n"
        for i, tool in enumerate(external_tools, 1):
            tools_doc += f'   - {tool["name"]} (server: "{tool["server"]}")\n'
            tools_doc += f"     Description: {tool['description']}\n"
            tools_doc += f"     Parameters Schema: {json.dumps(tool['input_schema'])}\n"

    # Create prompt for action generation
    action_prompt = f"""You are an expert at converting natural language requests into executable actions.

The user wants: {user_request}

The council's best solution (voted by AI peers) is:
{best_response}

Based on this solution, generate the specific tool calls needed to execute it.
You can use these tools:
{tools_doc}

CRITICAL: Respond with ONLY valid JSON, no other text. The JSON must have this exact structure:
{{
  "description": "Brief summary of what will be executed",
  "reasoning": "Why this approach solves the problem",
  "tool_calls": [
    {{
      "tool": "tool_name",
      "server": "local|server_name",
      "params": {{
        // parameters satisfying the schema of the tool
      }},
      "description": "What this call does"
    }}
  ]
}}

Now generate the action plan JSON:"""

    messages = [{"role": "user", "content": action_prompt}]

    # Query chairman to generate action plan
    chairman = get_chairman_model()
    response = await query_model(chairman, messages)

    if response is None:
        return {"success": False, "error": "Failed to generate action plan"}

    response_text = response.get("content", "")

    # Parse JSON from response
    action_plan = _extract_json_object(response_text)
    if not action_plan:
        return {
            "success": False,
            "error": "Could not parse valid JSON action plan from response",
            "raw_response": response_text,
            "model": chairman,
            "usage": response.get("usage") if response else None,
        }

    return {
        "success": True,
        "action_plan": action_plan,
        "best_response_model": best_model_name,
        "model": chairman,
        "usage": response.get("usage") if response else None,
    }


async def execute_action_plan(action_plan_response: Dict[str, Any]) -> Dict[str, Any]:
    """Execute the MCP tool calls from a generated action plan.

    Validates the generated plan and dispatches all tool calls via `executor.execute_tools`.

    Args:
        action_plan_response: Outcome dictionary returned by `stage4_generate_action_plan`.

    Returns:
        Dict[str, Any]: Execution result payload containing:
            - success (bool): True if all tool executions succeeded.
            - action_plan (dict): The original action plan that was run.
            - execution_results (dict): Per-tool execution statuses and outputs.
    """
    if not action_plan_response.get("success"):
        return {
            "success": False,
            "error": "Action plan generation failed",
            "details": action_plan_response,
        }

    action_plan = action_plan_response.get("action_plan", {})
    tool_calls = action_plan.get("tool_calls", [])

    if not tool_calls:
        return {"success": False, "error": "No tool calls in action plan"}

    # Execute all tool calls
    execution_result = await executor.execute_tools(tool_calls)

    return {
        "success": execution_result.get("all_successful", False),
        "action_plan": action_plan,
        "execution_results": execution_result,
    }


async def run_full_council_with_action(
    user_request: str, execute: bool = True
) -> Dict[str, Any]:
    """Run the complete 4-stage council process with optional action execution.

    Coordinates Stages 1-3 deliberation, Stage 4 action plan generation,
    and conditionally executes the plan if `execute=True`.

    Args:
        user_request: The user's request or task instructions.
        execute: Whether to immediately execute the tool action plan. Defaults to True.

    Returns:
        Dict[str, Any]: Complete council run result including stage1, stage2, stage3,
            metadata, stage4_action_plan, and execution results.
    """
    # Stages 1-3: Run the council
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        user_request
    )

    # Stage 4: Generate action plan based on voting
    action_plan_result = await stage4_generate_action_plan(
        user_request, stage1_results, metadata.get("aggregate_rankings", [])
    )

    result = {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata,
        "stage4_action_plan": action_plan_result,
    }

    # Execute if requested and plan succeeded
    if execute and action_plan_result.get("success"):
        execution_result = await execute_action_plan(action_plan_result)
        result["execution"] = execution_result

    return result


async def run_sub_council(
    question: str,
    context: Optional[str] = None,
    on_event: Optional[Any] = None,
) -> Dict[str, Any]:
    """Run an on-demand sub-council deliberation on a specific subtask, code problem, or dilemma.

    Used by the autonomous agent to request targeted peer review during its ReAct loop
    (e.g., when resolving test failures or checking deliverable completeness).
    Supports streaming progress updates via the `on_event` callback.

    Args:
        question: The specific dilemma or problem statement for the sub-council.
        context: Optional background context (code snippets, error traces, file diffs).
        on_event: Optional async callable for streaming sub-council stage events.

    Returns:
        Dict[str, Any]: Comprehensive deliberation result containing:
            - question (str): The evaluated question.
            - context (str, optional): The provided context.
            - stage1 (list): Individual model responses.
            - stage2 (list): Peer rankings.
            - stage3 (dict): Synthesized recommendation.
            - aggregate_rankings (list): Aggregate peer rankings.
            - consensus_recommendation (str): Synthesized advice text.
    """
    full_prompt = question
    if context:
        full_prompt = f"Context:\n{context}\n\nQuestion/Dilemma:\n{question}"

    if on_event:
        await on_event("sub_council_stage1_start", {"question": question})

    stage1 = await stage1_collect_responses(full_prompt)
    if on_event:
        await on_event("sub_council_stage1_complete", {"data": stage1})

    if on_event:
        await on_event("sub_council_stage2_start", {})

    stage2, label_to_model = await stage2_collect_rankings(full_prompt, stage1)
    aggregate = calculate_aggregate_rankings(stage2, label_to_model)
    if on_event:
        await on_event(
            "sub_council_stage2_complete",
            {"data": stage2, "aggregate_rankings": aggregate},
        )

    if on_event:
        await on_event("sub_council_stage3_start", {})

    stage3 = await stage3_synthesize_final(full_prompt, stage1, stage2)
    if on_event:
        await on_event("sub_council_stage3_complete", {"data": stage3})

    return {
        "question": question,
        "context": context,
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
        "aggregate_rankings": aggregate,
        "consensus_recommendation": stage3.get("response", ""),
    }

