/**
 * API client for the LLM Council backend.
 *
 * This module provides a type-annotated HTTP and Server-Sent Events (SSE) client
 * for communicating with the FastAPI backend service:
 * - Dynamic base URL resolution supporting Vite proxying and custom VITE_API_BASE.
 * - JSON request helper with HTTP error unwrapping and detail extraction.
 * - Robust SSE stream consumer with newline line-buffering that cleanly handles
 *   arbitrary network chunk splits.
 * - CRUD operations for conversations, modes, settings, and models.
 * - Real-time streaming endpoints for informational multi-model deliberation,
 *   one-shot action plan synthesis/execution, and autonomous Chairperson agent runs.
 */

/**
 * Base URL for backend API requests.
 * Uses `VITE_API_BASE` if defined; falls back to `http://localhost:8001` when running
 * in standard Vite dev server mode (port 5173); otherwise defaults to relative path ("").
 */
const API_BASE =
  import.meta.env.VITE_API_BASE !== undefined
    ? import.meta.env.VITE_API_BASE
    : typeof window !== "undefined" && window.location.port === "5173"
      ? "http://localhost:8001"
      : "";

/**
 * Perform a fetch request and parse JSON response, automatically unwrapping API error details.
 *
 * @param {string} path - API endpoint path relative to `API_BASE` (e.g. "/api/conversations").
 * @param {RequestInit} [options={}] - Standard fetch RequestInit options (headers, method, body).
 * @param {string} [defaultError="Request failed"] - Fallback error message if backend response lacks detail.
 * @returns {Promise<any>} Parsed JSON payload returned by backend.
 * @throws {Error} Error containing backend detail message or defaultError fallback.
 */
async function requestJson(path, options = {}, defaultError = "Request failed") {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || defaultError);
  }
  return response.json();
}

/**
 * Consume an HTTP Server-Sent Events (SSE) stream and invoke a callback for each parsed event.
 *
 * SSE chunks arrive in arbitrary byte segments over TCP. This function maintains an internal
 * line buffer so that JSON payloads split across packet boundaries are reconstructed safely.
 *
 * @param {Response} response - Fetch API Response object containing a readable body stream.
 * @param {function(string, Object): void} onEvent - Callback invoked on each event with `(eventType, eventData)`.
 * @returns {Promise<void>} Resolves when the stream reaches completion (`done: true`).
 */
async function consumeSSEStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Preserve the last potentially incomplete line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        try {
          const event = JSON.parse(data);
          onEvent(event.type, event);
        } catch (e) {
          console.error("Failed to parse SSE event:", e, "Raw data:", data);
        }
      }
    }
  }

  // Flush remaining buffer if complete
  const finalTrimmed = buffer.trim();
  if (finalTrimmed.startsWith("data: ")) {
    try {
      const event = JSON.parse(finalTrimmed.slice(6));
      onEvent(event.type, event);
    } catch (e) {
      console.error("Failed to parse remaining SSE event:", e);
    }
  }
}

/**
 * Centralized API client object providing methods for all backend endpoints.
 */
export const api = {
  /**
   * List all conversations with summary metadata (ID, title, timestamps, mode, message count, token usage).
   *
   * @returns {Promise<Array<Object>>} List of conversation metadata objects sorted newest-first.
   */
  async listConversations() {
    return requestJson("/api/conversations", {}, "Failed to list conversations");
  },

  /**
   * Create a new conversation session on the backend.
   *
   * @param {string} [mode="informational"] - Initial conversation mode:
   *   - "informational": Standard multi-model council deliberation (Stages 1-3).
   *   - "one_shot": Single-turn action plan generation and execution (Stage 4).
   *   - "agentic": Multi-step autonomous ReAct agent with tool execution.
   * @returns {Promise<{id: string, created_at: string, title: string, mode: string, messages: Array}>}
   *   Newly initialized conversation record.
   */
  async createConversation(mode = "informational") {
    return requestJson(
      "/api/conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      },
      "Failed to create conversation",
    );
  },

  /**
   * Update the execution mode of an existing conversation.
   *
   * @param {string} conversationId - Target conversation identifier.
   * @param {string} mode - New mode ("informational" | "one_shot" | "agentic").
   * @returns {Promise<{id: string, mode: string, updated_at: string}>} Updated conversation record.
   */
  async updateConversationMode(conversationId, mode) {
    return requestJson(
      `/api/conversations/${conversationId}/mode`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      },
      "Failed to update conversation mode",
    );
  },

  /**
   * Retrieve full conversation details including entire message history and token usage.
   *
   * @param {string} conversationId - Unique conversation identifier.
   * @returns {Promise<{
   *   id: string,
   *   title: string,
   *   created_at: string,
   *   mode: string,
   *   messages: Array<Object>,
   *   token_usage?: Object
   * }>} Detailed conversation object.
   */
  async getConversation(conversationId) {
    return requestJson(
      `/api/conversations/${conversationId}`,
      {},
      "Failed to get conversation",
    );
  },

  /**
   * Send a user query to an informational conversation and consume streaming deliberation events.
   *
   * Events emitted:
   * - `stage1_start` / `stage1_complete`: Individual model answers.
   * - `stage2_start` / `stage2_complete`: Blind peer rankings & aggregate scores.
   * - `stage3_start` / `stage3_complete`: Chairman synthesis response.
   * - `title_complete`: Auto-generated conversation title.
   * - `complete`: Deliberation finished, contains final token usage breakdown.
   * - `error`: Fatal stream or model execution failure.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {string} content - The user prompt or question text.
   * @param {function(string, Object): void} onEvent - Callback for SSE events: `(eventType, eventData) => void`.
   * @returns {Promise<void>} Resolves when the SSE stream closes.
   */
  async sendMessageStream(conversationId, content, onEvent) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to send message");
    }

    await consumeSSEStream(response, onEvent);
  },

  /**
   * Execute an already generated and saved Stage 4 action plan for a conversation.
   *
   * Events emitted:
   * - `execution_start`: Tool execution begins.
   * - `execution_complete`: All tool calls completed with output/status.
   * - `complete`: Execution finished with updated cumulative token usage.
   * - `error`: Execution failure.
   *
   * @param {string} conversationId - The conversation ID containing the saved action plan.
   * @param {function(string, Object): void} onEvent - Callback for SSE events: `(eventType, eventData) => void`.
   * @returns {Promise<void>} Resolves when the stream closes.
   */
  async executeStoredActionPlanStream(conversationId, onEvent) {
    const response = await fetch(`${API_BASE}/api/action/execute/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to execute stored action plan");
    }

    await consumeSSEStream(response, onEvent);
  },

  /**
   * Execute one-shot action workflow: deliberation (Stages 1-3), action plan synthesis (Stage 4),
   * and optional immediate tool execution.
   *
   * Events emitted:
   * - `stage1_*`, `stage2_*`, `stage3_*`: Council deliberation stages.
   * - `stage4_start` / `stage4_action_plan`: Structured tool call plan generated.
   * - `execution_start` / `execution_complete`: Present if `execute=true`.
   * - `complete`: Process finished with token accounting.
   * - `error`: Stream failure.
   *
   * @param {string} request - The action request / user instruction.
   * @param {boolean} [execute=true] - If true, executes tools immediately; if false, only plans.
   * @param {function(string, Object): void} onEvent - Callback for SSE events: `(eventType, data) => void`.
   * @param {string} [conversationId] - Optional conversation ID to bind request to.
   * @returns {Promise<void>} Resolves when the stream closes.
   */
  async executeActionStream(
    request,
    execute = true,
    onEvent,
    conversationId = undefined,
  ) {
    const payload = { request, execute };
    if (conversationId) {
      payload.conversation_id = conversationId;
    }

    const response = await fetch(`${API_BASE}/api/action/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to execute action");
    }

    await consumeSSEStream(response, onEvent);
  },

  /**
   * Run the Council Autonomous Agent with streaming updates.
   *
   * Executes the full autonomous ReAct loop:
   * - Optional initial Council strategy deliberation.
   * - Iterative step execution: Thought -> Action -> Observation.
   * - On-demand sub-council consultation and error auto-diagnostics.
   * - Pre-completion Council quality sign-off.
   *
   * Events emitted:
   * - `stage1_*`, `stage2_*`, `stage3_*`: Initial council deliberation.
   * - `agent_thought`: ReAct reasoning and planned tool action.
   * - `agent_tool_result`: Observation returned from executed tool.
   * - `consult_council_complete`: Sub-council recommendation and peer reviews.
   * - `agent_complete`: Task accomplished with deliverables summary.
   * - `agent_cancelled`: Agent halted by user request.
   * - `agent_error`: Unrecoverable execution exception.
   * - `complete`: Stream complete with final token usage and spend stats.
   *
   * @param {string} request - High-level task description.
   * @param {string} [conversationId] - Optional conversation ID for persistence.
   * @param {function(string, Object): void} onEvent - Callback for SSE events.
   * @param {number} [maxSteps=20] - Maximum execution loop iterations before stopping.
   * @param {Object} [sensitivityConfig] - Deliberation sensitivity options:
   *   - `level`: "low" | "medium" | "high" | "extreme"
   *   - `auto_trigger_on_error`: boolean
   *   - `review_before_completion`: boolean
   *   - `max_consultations`: number
   *   - `max_steps`: number
   * @returns {Promise<void>} Resolves when the stream closes.
   */
  async runAgentStream(
    request,
    conversationId = undefined,
    onEvent,
    maxSteps = 20,
    sensitivityConfig = undefined,
  ) {
    const effectiveMaxSteps =
      sensitivityConfig?.max_steps !== undefined
        ? sensitivityConfig.max_steps
        : maxSteps;

    const payload = {
      request,
      conversation_id: conversationId,
      max_steps: effectiveMaxSteps,
      deliberation_sensitivity: sensitivityConfig?.level || "medium",
      sensitivity_config: sensitivityConfig || undefined,
    };

    const response = await fetch(`${API_BASE}/api/agent/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to start agent stream");
    }

    await consumeSSEStream(response, onEvent);
  },

  /**
   * Cancel an active autonomous agent run for a conversation.
   *
   * @param {string} conversationId - The conversation ID whose active agent should be aborted.
   * @returns {Promise<{success: boolean, message: string}>} Cancellation acknowledgement.
   */
  async cancelAgent(conversationId) {
    return requestJson(
      "/api/agent/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      },
      "Failed to cancel agent run",
    );
  },

  /**
   * Retrieve all currently active tool definitions across connected MCP servers and local executors.
   *
   * @returns {Promise<{
   *   success: boolean,
   *   tools: Array<{name: string, server: string, description: string, input_schema: Object}>,
   *   statuses: Object<string, string>,
   *   servers: Array<Object>
   * }>} Active tools catalog with server health statuses.
   */
  async getMcpTools() {
    return requestJson("/api/mcp/tools", {}, "Failed to get MCP tools");
  },

  /**
   * Retrieve all configured MCP server configurations and live connection statuses.
   *
   * @returns {Promise<{
   *   servers: Array<{name: string, command: string, args: Array<string>, enabled: boolean, status: string}>
   * }>} List of configured MCP servers.
   */
  async getMcpServers() {
    return requestJson("/api/mcp/servers", {}, "Failed to get MCP servers");
  },

  /**
   * Toggle an MCP server's enabled/disabled status.
   *
   * @param {string} serverName - Identifier name of the MCP server.
   * @param {boolean} [enabled] - Desired state (if omitted, server toggles to opposite of current state).
   * @returns {Promise<{
   *   success: boolean,
   *   server: string,
   *   enabled: boolean,
   *   status: string,
   *   tools: Array<Object>,
   *   servers: Array<Object>
   * }>} Updated status and refreshed tool list.
   */
  async toggleMcpServer(serverName, enabled = undefined) {
    const payload = enabled !== undefined ? { enabled } : {};
    return requestJson(
      `/api/mcp/servers/${encodeURIComponent(serverName)}/toggle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Failed to toggle MCP server",
    );
  },

  /**
   * Fetch available models catalog from OpenRouter.
   *
   * @param {string} [apiKey] - Optional OpenRouter API key override. If omitted, uses server-stored key.
   * @returns {Promise<{
   *   success: boolean,
   *   models: Array<{id: string, name: string, context_length: number, pricing: Object}>
   * }>} OpenRouter models list.
   */
  async getModels(apiKey = undefined) {
    const path = apiKey
      ? `/api/models?api_key=${encodeURIComponent(apiKey)}`
      : "/api/models";
    return requestJson(path, {}, "Failed to fetch OpenRouter models");
  },

  /**
   * Load active application configuration settings from backend.
   *
   * @returns {Promise<{
   *   openrouter_api_key: string,
   *   council_models: Array<string>,
   *   chairman_model: string,
   *   show_token_count: boolean,
   *   show_tokens_per_model: boolean,
   *   show_spend_value: boolean,
   *   show_saved_tokens: boolean,
   *   enable_token_compression: boolean,
   *   compression_algorithm: string,
   *   show_all_deliberation_steps: boolean,
   *   assistant_color: string,
   *   user_color: string,
   *   sensitivity_config: Object,
   *   default_mode: string
   * }>} Application configuration dictionary.
   */
  async getSettings() {
    return requestJson("/api/settings", {}, "Failed to load settings");
  },

  /**
   * Update and persist configuration settings to storage.
   *
   * @param {Object} settings - Partial or complete settings dictionary to save.
   * @returns {Promise<{success: boolean, message: string}>} Persistence acknowledgement.
   */
  async updateSettings(settings) {
    return requestJson(
      "/api/settings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      },
      "Failed to save settings",
    );
  },

  /**
   * Fetch dynamic model pricing rates and cache status from OpenRouter.
   *
   * @returns {Promise<{
   *   success: boolean,
   *   rates: Object<string, {prompt: number, completion: number}>,
   *   count: number,
   *   updated_at: string,
   *   cached: boolean
   * }>} Live dynamic pricing metadata.
   */
  async getPricing() {
    return requestJson("/api/pricing", {}, "Failed to fetch model pricing");
  },

  /**
   * Force refresh dynamic model pricing rates from OpenRouter, bypassing cache.
   *
   * @returns {Promise<{
   *   success: boolean,
   *   rates: Object<string, {prompt: number, completion: number}>,
   *   count: number,
   *   updated_at: string
   * }>} Freshly fetched pricing rates.
   */
  async refreshPricing() {
    return requestJson(
      "/api/pricing/refresh",
      { method: "POST" },
      "Failed to refresh model pricing",
    );
  },

  /**
   * Retrieve cumulative token compression savings statistics.
   *
   * @returns {Promise<{
   *   success: boolean,
   *   stats: {
   *     tokens_saved: number,
   *     total_prompt_tokens_original: number,
   *     total_prompt_tokens_compressed: number,
   *     compression_ratio: number,
   *     estimated_dollars_saved: number,
   *     total_queries: number,
   *     headroom_available: boolean
   *   }
   * }>} Compression metrics object.
   */
  async getCompressionStats() {
    return requestJson(
      "/api/compression/stats",
      {},
      "Failed to fetch compression stats",
    );
  },

  /**
   * Reset cumulative token compression statistics counters back to zero.
   *
   * @returns {Promise<{success: boolean, stats: Object}>} Reset confirmation and cleared stats.
   */
  async resetCompressionStats() {
    return requestJson(
      "/api/compression/reset-stats",
      { method: "POST" },
      "Failed to reset compression stats",
    );
  },
};
