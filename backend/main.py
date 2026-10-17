"""FastAPI backend for LLM Council.

This module exposes the complete REST and Server-Sent Events (SSE) API surface
for the LLM Council application, orchestrating:
1. Application Lifecycle:
   - Startup initialization: Starting configured MCP stdio/SSE servers and initiating
     background OpenRouter dynamic pricing prefetch & periodic 15-minute refresh.
   - Shutdown cleanup: Terminating active background refresh tasks and stopping all MCP servers.
2. Streaming Protocols (SSE):
   - Real-time progress updates for 3-stage council deliberation (`/message/stream`).
   - Real-time 4-stage action planning and tool execution (`/action/stream`).
   - Asynchronous multi-turn autonomous agent execution (`/agent/stream`).
3. Core REST Endpoints:
   - Conversation management (CRUD operations, title generation, mode updates).
   - Dynamic pricing queries and model discovery via OpenRouter.
   - Token compression statistics, preview dry-runs, and counter resets.
   - External MCP tool discovery, status checks, and server toggling.
   - System configuration and user preferences persistence.
"""

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from contextlib import asynccontextmanager

from . import storage
from .config import (
    get_default_mode,
    get_sensitivity_config,
    get_settings,
    save_settings,
)
from .openrouter import (
    fetch_openrouter_models,
    fetch_dynamic_pricing,
)
from .council import (
    calculate_aggregate_rankings,
    execute_action_plan,
    generate_conversation_title,
    run_full_council,
    run_full_council_with_action,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
    stage4_generate_action_plan,
)
from .agent import CouncilAgent
from .mcp_client_manager import mcp_manager
from .compression import (
    compress_messages,
    get_compression_stats,
    reset_compression_stats,
)
from .workflows import (
    load_workflows,
    get_workflow,
    save_workflow,
    delete_workflow,
    execute_workflow_stream,
    validate_workflow,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup and shutdown lifecycles.

    On startup:
    1. Boots up all enabled MCP servers (stdio subprocesses and SSE connections).
    2. Spawns a background task to prefetch real-time OpenRouter model pricing rates.
    3. Initializes a recurring background task to auto-refresh pricing every 15 minutes.

    On shutdown:
    1. Cancels the background pricing refresh loop.
    2. Gracefully disconnects and terminates all active MCP server client sessions.
    """
    # Start all configured MCP servers on startup
    await mcp_manager.start_all_servers()
    # Prefetch dynamic OpenRouter pricing in the background
    asyncio.create_task(fetch_dynamic_pricing())

    # Periodically auto-refresh OpenRouter pricing in the background
    async def periodic_pricing_refresh():
        """Background coroutine refreshing OpenRouter pricing every 900 seconds."""
        while True:
            try:
                await asyncio.sleep(900)  # 15 minutes
                await fetch_dynamic_pricing(force_refresh=True)
                logger.info("Auto-refreshed dynamic OpenRouter pricing rates.")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Error in background pricing refresh: %s", e)

    refresh_task = asyncio.create_task(periodic_pricing_refresh())
    yield
    refresh_task.cancel()
    # Stop all active MCP servers on shutdown
    await mcp_manager.stop_all_servers()


app = FastAPI(title="LLM Council API", lifespan=lifespan)


# Basic logging configuration for application tracing
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("llm_council.backend")


def _sse_event(event_type: str, data: Any = None, **kwargs) -> str:
    """Format a Server-Sent Event (SSE) data packet.

    Builds a JSON payload adhering to the standard SSE event format:
    `data: {"type": <event_type>, "data": <data>, ...}\n\n`.

    Args:
        event_type: String identifier representing the event kind (e.g. 'stage1_start').
        data: Optional payload associated with this event.
        **kwargs: Additional key-value pairs included directly at the top level of the payload.

    Returns:
        str: Serialized SSE event frame string.
    """
    payload: Dict[str, Any] = {"type": event_type, **kwargs}
    if data is not None:
        payload["data"] = data
    return f"data: {json.dumps(payload)}\n\n"


# Enable CORS for local development and containerized setups
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request payload for creating a new conversation."""

    mode: Optional[str] = "informational"


class UpdateConversationModeRequest(BaseModel):
    """Request payload for updating the conversation mode."""

    mode: str



class SendMessageRequest(BaseModel):
    """Request payload for submitting a user message to a conversation."""

    content: str


class ActionRequest(BaseModel):
    """Request payload for executing a single action via 4-stage council deliberation."""

    request: str
    execute: bool = True  # Whether to actually execute the action plan tools
    conversation_id: Optional[str] = None


class ExecuteStoredActionRequest(BaseModel):
    """Request payload to execute an existing action plan stored in a conversation."""

    conversation_id: str


class AgentRunRequest(BaseModel):
    """Request payload to start an autonomous Council Chairperson agent run."""

    request: str
    conversation_id: Optional[str] = None
    max_steps: Optional[int] = 20
    deliberation_sensitivity: Optional[str] = "medium"
    sensitivity_config: Optional[Dict[str, Any]] = None


class CancelAgentRequest(BaseModel):
    """Request payload to abort an active agent execution."""

    conversation_id: str


class UpdateSettingsRequest(BaseModel):
    """Request payload for updating application configuration settings."""

    openrouter_api_key: Optional[str] = None
    council_models: Optional[List[str]] = None
    chairman_model: Optional[str] = None
    show_token_count: Optional[bool] = None
    show_tokens_per_model: Optional[bool] = None
    show_spend_value: Optional[bool] = None
    show_saved_tokens: Optional[bool] = None
    enable_token_compression: Optional[bool] = None
    compression_algorithm: Optional[str] = None
    show_all_deliberation_steps: Optional[bool] = None
    assistant_color: Optional[str] = None
    user_color: Optional[str] = None
    sensitivity_config: Optional[Dict[str, Any]] = None
    default_mode: Optional[str] = None


class CompressionPreviewRequest(BaseModel):
    """Request payload to preview token compression effects on sample messages."""

    messages: List[Dict[str, Any]]
    model: Optional[str] = "openai/gpt-4o-mini"
    algorithm: Optional[str] = "headroom"


class ToggleMcpServerRequest(BaseModel):
    """Request payload to toggle or explicitly set the enabled status for an MCP server."""

    enabled: Optional[bool] = None


class AddMcpServerRequest(BaseModel):
    """Request payload to add or configure a new MCP server."""

    name: str
    command: str
    args: Optional[List[str]] = []
    env: Optional[Dict[str, str]] = None
    enabled: bool = True
    overwrite: bool = False


class SaveWorkflowRequest(BaseModel):
    """Request payload to create or update a custom workflow."""

    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    is_template: Optional[bool] = False
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]


class RunWorkflowRequest(BaseModel):
    """Request payload to run a custom workflow via streaming."""

    workflow_id: Optional[str] = None
    workflow: Optional[Dict[str, Any]] = None
    input: str
    conversation_id: Optional[str] = None


class ConversationMetadata(BaseModel):
    """Summary metadata representation of a conversation for list views."""

    id: str
    created_at: str
    title: str
    message_count: int
    mode: Optional[str] = "informational"
    token_usage: Optional[Dict[str, Any]] = None


class Conversation(BaseModel):
    """Complete conversation model including full message history and token usage."""

    id: str
    created_at: str
    title: str
    mode: Optional[str] = "informational"
    messages: List[Dict[str, Any]]
    token_usage: Optional[Dict[str, Any]] = None


@app.get("/api/health")
async def health_check():
    """Health check endpoint confirming API service readiness."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/models")
async def get_openrouter_models_endpoint(api_key: Optional[str] = None):
    """Fetch available OpenRouter models."""
    try:
        models = await fetch_openrouter_models(api_key)
        return {"success": True, "models": models}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/pricing")
async def get_pricing_endpoint():
    """Get dynamic model pricing rates fetched from OpenRouter."""
    try:
        pricing_data = await fetch_dynamic_pricing()
        return {"success": True, **pricing_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pricing/refresh")
async def refresh_pricing_endpoint():
    """Force refresh dynamic model pricing rates from OpenRouter."""
    try:
        pricing_data = await fetch_dynamic_pricing(force_refresh=True)
        return {"success": True, **pricing_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/settings")
async def get_settings_endpoint():
    """Get current configuration settings."""
    return get_settings()


@app.post("/api/settings")
async def save_settings_endpoint(request: UpdateSettingsRequest):
    """Update and persist configuration settings."""
    try:
        data = (
            request.model_dump(exclude_unset=True)
            if hasattr(request, "model_dump")
            else request.dict(exclude_unset=True)
        )
        updated = save_settings(data)
        return {"success": True, "settings": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/compression/stats")
async def get_compression_stats_endpoint():
    """Get cumulative token compression metrics across the current backend session.

    Returns:
        Dict[str, Any]: Aggregate statistics including:
            - total_tokens_before (int): Cumulative uncompressed token count.
            - total_tokens_after (int): Cumulative compressed token count.
            - total_tokens_saved (int): Net tokens saved across all compressed prompts.
            - total_calls (int): Number of compression operations invoked.
            - by_algorithm (dict): Per-algorithm breakdown of usage and savings.
    """
    try:
        stats = get_compression_stats()
        return {"success": True, "stats": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/compression/preview")
async def preview_compression_endpoint(request: CompressionPreviewRequest):
    """Dry-run preview of prompt token compression without modifying conversation state.

    Executes the specified compression algorithm against sample messages to preview
    token savings, applied transformations (e.g. whitespace collapsing, comment stripping),
    and compression ratios before committing them to live model interactions.

    Args:
        request: CompressionPreviewRequest containing messages, model, and algorithm.

    Returns:
        Dict[str, Any]: Detailed preview payload with before/after token counts and
            the transformed message list.
    """
    try:
        result = compress_messages(
            messages=request.messages,
            model=request.model or "openai/gpt-4o-mini",
            algorithm=request.algorithm or "headroom",
            enabled=True,
        )
        return {
            "success": True,
            "result": {
                "tokens_before": result.tokens_before,
                "tokens_after": result.tokens_after,
                "tokens_saved": result.tokens_saved,
                "compression_ratio": result.compression_ratio,
                "algorithm": result.algorithm,
                "transforms_applied": result.transforms_applied,
                "messages": result.messages,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/compression/reset-stats")
async def reset_compression_stats_endpoint():
    """Reset cumulative in-memory compression metrics back to zero.

    Returns:
        Dict[str, Any]: Confirmation message.
    """
    try:
        reset_compression_stats()
        return {"success": True, "message": "Compression stats reset successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/mcp/tools")
async def get_mcp_tools():
    """Get all available tools from connected MCP servers and their operational statuses.

    Returns:
        Dict[str, Any]: Aggregated dictionary containing:
            - tools: List of tool schemas across all active servers.
            - statuses: Per-server connection health statuses ('connected', 'connecting', 'stopped', 'error').
            - servers: Configuration metadata for all known MCP servers.
    """
    try:
        tools = await mcp_manager.get_available_tools()
        return {
            "success": True,
            "tools": tools,
            "statuses": mcp_manager.server_statuses,
            "servers": mcp_manager.get_servers_metadata(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/mcp/servers")
async def get_mcp_servers():
    """Get metadata and connection statuses for all configured MCP servers.

    Returns:
        Dict[str, Any]: Server metadata list including name, command, transport, and enabled status.
    """
    try:
        return {
            "success": True,
            "servers": mcp_manager.get_servers_metadata(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mcp/servers/{server_name}/toggle")
async def toggle_mcp_server(
    server_name: str, request: Optional[ToggleMcpServerRequest] = None
):
    """Enable or disable a specific MCP server dynamically at runtime.

    Starting or stopping the server process and updating the persisted settings.

    Args:
        server_name: The registered name of the target MCP server.
        request: Optional body specifying desired enabled state; toggles current state if omitted.

    Returns:
        Dict[str, Any]: Result dictionary containing updated server status.
    """
    try:
        if request and request.enabled is not None:
            target_enabled = request.enabled
        else:
            current_enabled = mcp_manager.is_server_enabled(server_name)
            target_enabled = not current_enabled

        result = await mcp_manager.set_server_enabled(server_name, target_enabled)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mcp/servers")
async def add_mcp_server(request: AddMcpServerRequest):
    """Add and optionally connect to a new MCP server.

    Validates parameters, saves configuration to mcp_servers.json, and starts
    the server subprocess if enabled.
    """
    try:
        result = await mcp_manager.add_server(
            name=request.name,
            command=request.command,
            args=request.args,
            env=request.env,
            enabled=request.enabled,
            overwrite=request.overwrite,
        )
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Failed to add MCP server: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/mcp/servers/{server_name}")
async def delete_mcp_server(server_name: str):
    """Delete an MCP server, terminate its subprocess, and remove from configuration."""
    try:
        result = await mcp_manager.remove_server(server_name)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Failed to delete MCP server: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List summary metadata for all conversations, sorted newest first.

    Used by the frontend sidebar to populate conversation history.

    Returns:
        List[ConversationMetadata]: Conversation descriptors with ID, title, message count,
            mode, and cumulative token usage.
    """
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: Optional[CreateConversationRequest] = None):
    """Create a new empty conversation with a generated UUID.

    Args:
        request: Optional request specifying the conversation mode ('informational',
            'one_shot', or 'agentic'). Defaults to 'informational'.

    Returns:
        Conversation: Newly initialized conversation object.
    """
    mode = request.mode if request and request.mode else get_default_mode()
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id, mode=mode)
    return conversation


@app.patch("/api/conversations/{conversation_id}/mode")
async def update_conversation_mode_endpoint(
    conversation_id: str, request: UpdateConversationModeRequest
):
    """Update the operating mode of an existing conversation.

    Args:
        conversation_id: Unique UUID of the target conversation.
        request: Payload containing the new mode string.

    Returns:
        Dict[str, str]: Status confirmation and new mode.
    """
    updated = storage.update_conversation_mode(conversation_id, request.mode)
    if updated is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "ok", "mode": request.mode}


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Retrieve a complete conversation record including full message transcript and token metrics.

    Args:
        conversation_id: Unique UUID of the conversation.

    Returns:
        Conversation: Full conversation schema.
    """
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """Send a user message and synchronously execute the 3-stage council deliberation.

    Blocks until Stage 1 (divergence), Stage 2 (peer ranking), and Stage 3 (synthesis)
    complete. Automatically generates a descriptive title if this is the first message.
    Saves user and assistant entries into storage before returning.

    Args:
        conversation_id: Unique UUID of the conversation.
        request: Payload containing the user's message text.

    Returns:
        Dict[str, Any]: Complete deliberation outcome with stage1, stage2, stage3,
            metadata, and cumulative token usage.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(
            request.content, conversation_id=conversation_id
        )
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id, stage1_results, stage2_results, stage3_result
    )

    conv_updated = storage.get_conversation(conversation_id)
    token_usage = conv_updated.get("token_usage") if conv_updated else None

    # Return the complete response with metadata and token_usage
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata,
        "token_usage": token_usage,
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """Send a user message and stream the 3-stage council process via Server-Sent Events (SSE).

    Emits live events as deliberation progresses:
    - `stage1_start`, `stage1_complete`
    - `stage2_start`, `stage2_complete`
    - `stage3_start`, `stage3_complete`
    - `title_complete` (if first message)
    - `complete` (with updated conversation token usage)

    Args:
        conversation_id: Unique UUID of the conversation.
        request: Payload containing the user's message text.

    Returns:
        StreamingResponse: SSE stream formatted with text/event-stream.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        """Asynchronous generator yielding formatted SSE frames for each stage."""
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(
                        request.content, conversation_id=conversation_id
                    )
                )

            # Stage 1: Collect responses
            yield _sse_event("stage1_start")
            stage1_results = await stage1_collect_responses(request.content)
            yield _sse_event("stage1_complete", stage1_results)

            # Stage 2: Collect rankings
            yield _sse_event("stage2_start")
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.content, stage1_results
            )
            aggregate_rankings = calculate_aggregate_rankings(
                stage2_results, label_to_model
            )
            yield _sse_event(
                "stage2_complete",
                stage2_results,
                metadata={
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings,
                },
            )

            # Stage 3: Synthesize final answer
            yield _sse_event("stage3_start")
            stage3_result = await stage3_synthesize_final(
                request.content, stage1_results, stage2_results
            )
            yield _sse_event("stage3_complete", stage3_result)

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield _sse_event("title_complete", {"title": title})

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id, stage1_results, stage2_results, stage3_result
            )

            conv_updated = storage.get_conversation(conversation_id)
            conv_tokens = conv_updated.get("token_usage") if conv_updated else None

            # Send completion event with updated token usage
            yield _sse_event("complete", {"token_usage": conv_tokens}, token_usage=conv_tokens)

        except Exception as e:
            # Send error event
            yield _sse_event("error", message=str(e))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/action")
async def perform_action(request: ActionRequest):
    """Execute a 4-stage council deliberation with action plan generation and tool execution.

    Stages:
    - Stage 1: Collect proposals from all models.
    - Stage 2: Peer ranking and vote aggregation.
    - Stage 3: Chairman synthesizes best response.
    - Stage 4: Synthesize structured action plan and execute MCP/local tool calls.

    Args:
        request: ActionRequest specifying user request, execution flag, and optional conversation ID.

    Returns:
        Dict[str, Any]: Comprehensive result including all stages and execution outputs.
    """
    if request.conversation_id is not None:
        conversation = storage.get_conversation(request.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        is_first_message = len(conversation["messages"]) == 0
        storage.add_user_message(request.conversation_id, request.request)
        if is_first_message:
            title = await generate_conversation_title(
                request.request, conversation_id=request.conversation_id
            )
            storage.update_conversation_title(request.conversation_id, title)

    try:
        result = await run_full_council_with_action(
            request.request, execute=request.execute
        )

        if request.conversation_id is not None:
            storage.add_assistant_message(
                request.conversation_id,
                result["stage1"],
                result["stage2"],
                result["stage3"],
                stage4=result.get("stage4_action_plan"),
                execution=result.get("execution"),
                action_request=request.request,
            )
            conv_updated = storage.get_conversation(request.conversation_id)
            if conv_updated:
                result["token_usage"] = conv_updated.get("token_usage")

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Action failed: {str(e)}")


@app.post("/api/action/stream")
async def perform_action_stream(request: ActionRequest):
    """Stream a 4-stage action deliberation and execution pipeline via SSE.

    Emits events:
    - `stage1_start`, `stage1_complete`
    - `stage2_start`, `stage2_complete`
    - `stage3_start`, `stage3_complete`
    - `stage4_start`, `stage4_action_plan`
    - `execution_start`, `execution_complete` (if execute is True)
    - `complete`

    Args:
        request: ActionRequest specifying task, execution flag, and optional conversation ID.

    Returns:
        StreamingResponse: Real-time event stream.
    """
    conversation = None
    is_first_message = False
    if request.conversation_id is not None:
        conversation = storage.get_conversation(request.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        """Asynchronous generator yielding SSE events for action synthesis and execution."""
        try:
            if request.conversation_id is not None:
                storage.add_user_message(request.conversation_id, request.request)
                if is_first_message:
                    title_task = asyncio.create_task(
                        generate_conversation_title(
                            request.request, conversation_id=request.conversation_id
                        )
                    )
                else:
                    title_task = None
            else:
                title_task = None

            # Stage 1: Collect responses
            yield _sse_event("stage1_start")
            stage1_results = await stage1_collect_responses(request.request)
            yield _sse_event("stage1_complete", stage1_results)

            if not stage1_results:
                yield _sse_event("error", message="All models failed to respond")
                return

            # Stage 2: Collect rankings
            yield _sse_event("stage2_start")
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.request, stage1_results
            )
            aggregate_rankings = calculate_aggregate_rankings(
                stage2_results, label_to_model
            )
            yield _sse_event(
                "stage2_complete",
                stage2_results,
                metadata={
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings,
                },
            )

            # Stage 3: Synthesize
            yield _sse_event("stage3_start")
            stage3_result = await stage3_synthesize_final(
                request.request, stage1_results, stage2_results
            )
            yield _sse_event("stage3_complete", stage3_result)

            # Stage 4: Generate action plan
            yield _sse_event("stage4_start")
            action_plan_result = await stage4_generate_action_plan(
                request.request, stage1_results, aggregate_rankings
            )
            yield _sse_event("stage4_action_plan", action_plan_result)

            execution_result = None
            # Execute if requested
            if request.execute and action_plan_result.get("success"):
                yield _sse_event("execution_start")
                execution_result = await execute_action_plan(action_plan_result)
                yield _sse_event("execution_complete", execution_result)

            if request.conversation_id is not None:
                storage.add_assistant_message(
                    request.conversation_id,
                    stage1_results,
                    stage2_results,
                    stage3_result,
                    stage4=action_plan_result,
                    execution=execution_result,
                    action_request=request.request,
                )

            if title_task:
                title = await title_task
                storage.update_conversation_title(request.conversation_id, title)
                yield _sse_event("title_complete", {"title": title})

            conv_tokens = None
            if request.conversation_id is not None:
                conv_updated = storage.get_conversation(request.conversation_id)
                conv_tokens = conv_updated.get("token_usage") if conv_updated else None

            yield _sse_event("complete", {"token_usage": conv_tokens}, token_usage=conv_tokens)

        except Exception as e:
            yield _sse_event("error", message=str(e))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/action/execute/stream")
async def execute_stored_action_stream(request: ExecuteStoredActionRequest):
    """Execute a previously synthesized action plan stored in a conversation transcript.

    Scans the conversation history for the latest assistant message containing
    a Stage 4 action plan, dispatches the tool calls, updates the message
    in storage with the execution output, and streams progress over SSE.

    Args:
        request: ExecuteStoredActionRequest with the conversation ID.

    Returns:
        StreamingResponse: Stream of execution events (`execution_start`, `execution_complete`, `complete`).
    """
    conversation = storage.get_conversation(request.conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Find the most recent assistant message with a generated action plan.
    action_message = None
    for msg in reversed(conversation["messages"]):
        if msg.get("role") == "assistant" and msg.get("stage4"):
            action_message = msg
            break

    if action_message is None:
        raise HTTPException(
            status_code=400, detail="No stored action plan found in conversation"
        )

    async def event_generator():
        """Asynchronous generator yielding execution progress events."""
        try:
            yield _sse_event("execution_start")
            execution_result = await execute_action_plan(action_message["stage4"])
            storage.update_last_assistant_message(
                request.conversation_id,
                lambda msg: {**msg, "execution": execution_result},
            )
            yield _sse_event("execution_complete", execution_result)
            yield _sse_event("complete")
        except Exception as e:
            yield _sse_event("error", message=str(e))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


# In-memory registry of active agent runs mapped by conversation ID
active_agents: Dict[str, CouncilAgent] = {}


@app.post("/api/agent/cancel")
async def cancel_agent(request: CancelAgentRequest):
    """Cancel an active autonomous agent execution.

    Signals the `CouncilAgent` instance associated with the conversation
    to abort at its next iteration.

    Args:
        request: CancelAgentRequest containing the target conversation_id.

    Returns:
        Dict[str, Any]: Status payload indicating whether an active agent was found and signalled.
    """
    agent = active_agents.get(request.conversation_id)
    if agent:
        agent.cancel()
        return {"success": True, "message": "Agent cancellation requested."}
    return {"success": False, "message": "No active agent found for conversation."}


@app.post("/api/agent/stream")
async def run_agent_stream(request: AgentRunRequest):
    """Run autonomous CouncilAgent with initial Council Deliberation and streaming ReAct loop.

    Execution Pipeline:
    - Phase 1 (Deliberation): Runs Stages 1-3 to create a peer-voted strategy blueprint.
    - Phase 2 (Autonomous ReAct Loop): Spawns `CouncilAgent` which reads/writes code, executes tests,
      and consults sub-councils, forwarding live thoughts and tool results to the client over SSE.
    - Phase 3 (Persistence): Persists the complete run, artifacts, and token metrics to conversation storage.

    Args:
        request: AgentRunRequest with user prompt, conversation ID, max steps, and sensitivity settings.

    Returns:
        StreamingResponse: Comprehensive SSE stream with real-time thought and action updates.
    """
    conversation = None
    is_first_message = False
    conv_id = request.conversation_id

    if conv_id is not None:
        conversation = storage.get_conversation(conv_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        """Asynchronous generator orchestrating initial deliberation and agent loop SSE streaming."""
        nonlocal is_first_message
        title_task = None
        agent = None
        try:
            if conv_id is not None:
                storage.add_user_message(conv_id, request.request)
                if is_first_message:
                    title_task = asyncio.create_task(
                        generate_conversation_title(
                            request.request, conversation_id=conv_id
                        )
                    )

            # --- PHASE 1: INITIAL COUNCIL CROSS-REFERENCED DELIBERATION ---
            yield _sse_event("council_deliberation_start")

            # Stage 1: Collect proposals from all council models
            yield _sse_event("stage1_start")
            stage1_results = await stage1_collect_responses(request.request)
            yield _sse_event("stage1_complete", stage1_results)

            if not stage1_results:
                yield _sse_event(
                    "error",
                    message="All models failed to respond in council deliberation.",
                )
                return

            # Stage 2: Peer ranking & evaluation
            yield _sse_event("stage2_start")
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.request, stage1_results
            )
            aggregate_rankings = calculate_aggregate_rankings(
                stage2_results, label_to_model
            )
            yield _sse_event(
                "stage2_complete",
                stage2_results,
                metadata={
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings,
                },
            )

            # Stage 3: Cross-referenced synthesis & blueprint
            yield _sse_event("stage3_start")
            stage3_result = await stage3_synthesize_final(
                request.request, stage1_results, stage2_results
            )
            yield _sse_event("stage3_complete", stage3_result)

            initial_council = {
                "stage1": stage1_results,
                "stage2": stage2_results,
                "stage3": stage3_result,
                "metadata": {
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings,
                },
            }

            # --- PHASE 2: CHAIRPERSON AUTONOMOUS AGENT LOOP ---
            saved_sensitivity = get_sensitivity_config()
            effective_sensitivity_config = (
                request.sensitivity_config
                if request.sensitivity_config is not None
                else saved_sensitivity
            )
            max_steps_val = (
                effective_sensitivity_config.get("max_steps")
                if "max_steps" in effective_sensitivity_config
                else request.max_steps
            )
            if max_steps_val is None:
                max_steps_val = 20

            delib_sensitivity = (
                request.deliberation_sensitivity
                or effective_sensitivity_config.get("level")
                or "medium"
            )

            agent = CouncilAgent(
                user_request=request.request,
                initial_council=initial_council,
                max_steps=max_steps_val,
                deliberation_sensitivity=delib_sensitivity,
                sensitivity_config=effective_sensitivity_config,
            )

            if conv_id:
                active_agents[conv_id] = agent

            # Event forwarder from agent to SSE
            queue = asyncio.Queue()

            async def on_agent_event(event_type: str, data: Dict[str, Any]):
                """Queue agent lifecycle and tool execution events for SSE emission."""
                await queue.put((event_type, data))

            # Run agent loop as a task so we can stream events from queue
            agent_task = asyncio.create_task(agent.run(on_event=on_agent_event))

            while not agent_task.done() or not queue.empty():
                try:
                    event_type, data = await asyncio.wait_for(queue.get(), timeout=0.1)
                    yield _sse_event(event_type, data)
                except asyncio.TimeoutError:
                    continue

            agent_result = await agent_task

            # Save agent run into conversation storage
            if conv_id is not None:
                storage.add_agent_message(
                    conversation_id=conv_id,
                    user_request=request.request,
                    initial_council=initial_council,
                    steps=agent.steps,
                    artifacts=agent.artifacts,
                    summary=agent.summary,
                    error=agent.error,
                    status="cancelled" if agent.is_cancelled else ("completed" if agent.is_completed else "failed"),
                    token_usage=agent_result.get("token_usage"),
                )

            if title_task:
                title = await title_task
                storage.update_conversation_title(conv_id, title)
                yield _sse_event("title_complete", {"title": title})

            conv_tokens = None
            if conv_id is not None:
                conv_updated = storage.get_conversation(conv_id)
                conv_tokens = conv_updated.get("token_usage") if conv_updated else None

            yield _sse_event("complete", agent_result, token_usage=conv_tokens)

        except Exception as e:
            logger.exception("Error in agent stream: %s", str(e))
            yield _sse_event("error", message=str(e))
        finally:
            if conv_id and conv_id in active_agents:
                active_agents.pop(conv_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


# ==============================================================================
# Custom Workflows Endpoints
# ==============================================================================

@app.get("/api/workflows")
async def list_workflows_endpoint():
    """List all available workflows including built-in templates and custom saved graphs.

    Returns:
        Dict[str, Any]: List of workflow objects under 'workflows'.
    """
    workflows = load_workflows()
    return {"workflows": workflows}


@app.get("/api/workflows/{workflow_id}")
async def get_workflow_endpoint(workflow_id: str):
    """Retrieve details for a specific workflow.

    Args:
        workflow_id: Unique workflow identifier.

    Returns:
        Dict[str, Any]: Workflow graph definition.
    """
    workflow = get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@app.post("/api/workflows")
async def save_workflow_endpoint(request: SaveWorkflowRequest):
    """Create or update a custom workflow graph.

    Args:
        request: Workflow definition containing nodes and directed edges.

    Returns:
        Dict[str, Any]: Saved workflow object.
    """
    try:
        wf_data = request.model_dump()
        saved = save_workflow(wf_data)
        return saved
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("Failed to save workflow: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/workflows/{workflow_id}")
async def delete_workflow_endpoint(workflow_id: str):
    """Delete a custom workflow. Built-in template workflows are protected from deletion.

    Args:
        workflow_id: Workflow identifier to delete.

    Returns:
        Dict[str, Any]: Success status indicator.
    """
    success = delete_workflow(workflow_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete workflow: it is either a protected template or does not exist.",
        )
    return {"success": True, "message": f"Workflow {workflow_id} deleted."}


@app.post("/api/workflows/run/stream")
async def run_workflow_stream_endpoint(request: RunWorkflowRequest):
    """Execute a custom workflow graph on user input and stream live progress via SSE.

    Args:
        request: Payload with either workflow_id or inline workflow definition, user input,
                 and optional target conversation_id.

    Returns:
        StreamingResponse: Real-time SSE stream with node_start, node_complete,
                           and workflow_complete events.
    """
    workflow = None
    if request.workflow:
        workflow = request.workflow
    elif request.workflow_id:
        workflow = get_workflow(request.workflow_id)

    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    is_valid, error_msg = validate_workflow(workflow)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid workflow graph: {error_msg}")

    conv_id = request.conversation_id
    is_first_message = False
    if conv_id:
        conv = storage.get_conversation(conv_id)
        if conv:
            is_first_message = len(conv.get("messages", [])) == 0
        else:
            conv = storage.create_conversation(conversation_id=conv_id, mode="custom_workflows")
            is_first_message = True
    else:
        conv = storage.create_conversation(mode="custom_workflows")
        conv_id = conv["id"]
        is_first_message = True

    async def event_generator():
        try:
            storage.add_user_message(conv_id, request.input)

            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(request.input, conversation_id=conv_id)
                )

            final_wf_event = None
            async for event_packet in execute_workflow_stream(workflow, request.input):
                evt_type = event_packet["event"]
                evt_data = event_packet["data"]
                if evt_type == "workflow_complete":
                    final_wf_event = evt_data
                yield _sse_event(evt_type, evt_data)

            if title_task:
                try:
                    title = await title_task
                    storage.update_conversation_title(conv_id, title)
                    yield _sse_event("title_complete", {"title": title})
                except Exception as ex:
                    logger.warning("Failed to generate title for workflow run: %s", ex)

            if final_wf_event:
                storage.add_workflow_message(
                    conversation_id=conv_id,
                    user_input=request.input,
                    workflow_id=final_wf_event.get("workflow_id", workflow.get("id", "workflow")),
                    workflow_name=final_wf_event.get("workflow_name", workflow.get("name", "Custom Workflow")),
                    nodes=final_wf_event.get("nodes", []),
                    edges=final_wf_event.get("edges", []),
                    final_output=final_wf_event.get("final_output", ""),
                    status=final_wf_event.get("status", "completed"),
                    token_usage=final_wf_event.get("token_usage"),
                )

            conv_updated = storage.get_conversation(conv_id)
            conv_tokens = conv_updated.get("token_usage") if conv_updated else None

            yield _sse_event(
                "complete",
                {
                    "conversation_id": conv_id,
                    "status": final_wf_event.get("status", "completed") if final_wf_event else "completed",
                    "final_output": final_wf_event.get("final_output", "") if final_wf_event else "",
                },
                token_usage=conv_tokens,
            )

        except Exception as e:
            logger.exception("Error during workflow execution stream: %s", e)
            yield _sse_event("error", message=str(e))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


# Serve built frontend static files if present (e.g. in Docker or production builds)
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
else:
    @app.get("/")
    async def root():
        """Health check endpoint when frontend is served separately in development."""
        return {"status": "ok", "service": "LLM Council API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
