"""FastAPI backend for LLM Council."""

import asyncio
import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from contextlib import asynccontextmanager

from . import storage
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
from .mcp_client_manager import mcp_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start all configured MCP servers on startup
    await mcp_manager.start_all_servers()
    yield
    # Stop all active MCP servers on shutdown
    await mcp_manager.stop_all_servers()


app = FastAPI(title="LLM Council API", lifespan=lifespan)


# Basic logging configuration
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("llm_council.backend")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""

    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""

    content: str


class ActionRequest(BaseModel):
    """Request to perform an action with council voting."""

    request: str
    execute: bool = True  # Whether to actually execute the action
    conversation_id: Optional[str] = None


class ExecuteStoredActionRequest(BaseModel):
    """Request to execute an existing action plan stored in a conversation."""

    conversation_id: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""

    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""

    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/mcp/tools")
async def get_mcp_tools():
    """Get all available tools from connected MCP servers."""
    try:
        tools = await mcp_manager.get_available_tools()
        return {"success": True, "tools": tools}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
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
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id, stage1_results, stage2_results, stage3_result
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata,
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(request.content)
                )

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.content, stage1_results
            )
            aggregate_rankings = calculate_aggregate_rankings(
                stage2_results, label_to_model
            )
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(
                request.content, stage1_results, stage2_results
            )
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id, stage1_results, stage2_results, stage3_result
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

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
    """
    Run the full 4-stage council with action execution.
    Stage 1: Collect approaches from all models
    Stage 2: Models vote on best approach
    Stage 3: Chairman synthesizes
    Stage 4: Generate and execute MCP tool calls

    Returns the complete result with execution details.
    """
    if request.conversation_id is not None:
        conversation = storage.get_conversation(request.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

        is_first_message = len(conversation["messages"]) == 0
        storage.add_user_message(request.conversation_id, request.request)
        if is_first_message:
            title = await generate_conversation_title(request.request)
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

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Action failed: {str(e)}")


@app.post("/api/action/stream")
async def perform_action_stream(request: ActionRequest):
    """
    Run the full 4-stage council with streaming updates.
    """
    conversation = None
    is_first_message = False
    if request.conversation_id is not None:
        conversation = storage.get_conversation(request.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            if request.conversation_id is not None:
                storage.add_user_message(request.conversation_id, request.request)
                if is_first_message:
                    title_task = asyncio.create_task(
                        generate_conversation_title(request.request)
                    )
                else:
                    title_task = None
            else:
                title_task = None

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.request)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            if not stage1_results:
                yield f"data: {json.dumps({'type': 'error', 'message': 'All models failed to respond'})}\n\n"
                return

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.request, stage1_results
            )
            aggregate_rankings = calculate_aggregate_rankings(
                stage2_results, label_to_model
            )
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(
                request.request, stage1_results, stage2_results
            )
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Stage 4: Generate action plan
            yield f"data: {json.dumps({'type': 'stage4_start'})}\n\n"
            action_plan_result = await stage4_generate_action_plan(
                request.request, stage1_results, aggregate_rankings
            )
            yield f"data: {json.dumps({'type': 'stage4_action_plan', 'data': action_plan_result})}\n\n"

            execution_result = None
            # Execute if requested
            if request.execute and action_plan_result.get("success"):
                yield f"data: {json.dumps({'type': 'execution_start'})}\n\n"
                execution_result = await execute_action_plan(action_plan_result)
                yield f"data: {json.dumps({'type': 'execution_complete', 'data': execution_result})}\n\n"

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
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

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
    """
    Execute a previously generated action plan stored in the conversation.
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
        try:
            yield f"data: {json.dumps({'type': 'execution_start'})}\n\n"
            execution_result = await execute_action_plan(action_message["stage4"])
            storage.update_last_assistant_message(
                request.conversation_id,
                lambda msg: {**msg, "execution": execution_result},
            )
            yield f"data: {json.dumps({'type': 'execution_complete', 'data': execution_result})}\n\n"
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
