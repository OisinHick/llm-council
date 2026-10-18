"""LLM Council backend package.

This package contains the core backend services, deliberation engine, autonomous agent,
API server, and external tool integrations for the LLM Council system.

Modules:
    - config: Configuration loading, environment variables, default models, and atomic settings persistence.
    - storage: Atomic JSON-based conversation persistence, message management, and token/cost aggregation.
    - openrouter: Async HTTP client for OpenRouter LLM queries, parallel requests, dynamic pricing, and token usage.
    - compression: Context and token compression layer supporting Headroom AI SDK and heuristic optimizations.
    - mcp_client_manager: Process manager for stdio-based Model Context Protocol (MCP) servers.
    - mcp_tools: Tool execution engine for local commands, file operations, and external MCP tools.
    - agent_tools: Tool executor and sandbox utilities designed specifically for the autonomous Chairperson agent.
    - council: Multi-stage deliberation pipeline (Stage 1 responses, Stage 2 peer review, Stage 3 synthesis, Stage 4 action).
    - agent: Autonomous Chairperson ReAct agent loop with on-demand Council peer consultations.
    - workflows: Custom node-based DAG workflow validation, persistence, and streaming execution.
    - main: FastAPI application defining REST and Server-Sent Event (SSE) endpoints.
"""
