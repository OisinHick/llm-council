/**
 * API client for the LLM Council backend.
 */

const API_BASE =
  import.meta.env.VITE_API_BASE !== undefined
    ? import.meta.env.VITE_API_BASE
    : typeof window !== "undefined" && window.location.port === "5173"
      ? "http://localhost:8001"
      : "";

/**
 * Helper to perform fetch and safely parse JSON responses, extracting API error details.
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
 * Helper to read SSE streams and call onEvent for parsed events.
 * Uses line-buffering to ensure chunks split across network packets are reconstructed.
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

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    return requestJson("/api/conversations", {}, "Failed to list conversations");
  },

  /**
   * Create a new conversation.
   * @param {string} mode - Conversation mode ('informational', 'one_shot', 'agentic')
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
   * Update the mode of an existing conversation.
   * @param {string} conversationId
   * @param {string} mode
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
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    return requestJson(
      `/api/conversations/${conversationId}`,
      {},
      "Failed to get conversation",
    );
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
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
   * Execute a stored action plan for a conversation with streaming updates.
   * @param {string} conversationId - The conversation ID containing the saved action plan
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
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
   * Execute an action with streaming updates.
   * @param {string} request - The action request
   * @param {boolean} execute - Whether to execute the action plan
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {string} [conversationId] - Optional conversation ID
   * @returns {Promise<void>}
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
   * @param {string} request - The task request
   * @param {string} [conversationId] - Optional conversation ID
   * @param {function} onEvent - Callback for SSE events: (eventType, data) => void
   * @param {number} [maxSteps=20] - Maximum agent loop steps
   * @param {Object} [sensitivityConfig] - Deliberation sensitivity configuration
   * @returns {Promise<void>}
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
   * Cancel an active agent run for a conversation.
   * @param {string} conversationId - The conversation ID
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
   * Get all active tools from connected MCP servers.
   */
  async getMcpTools() {
    return requestJson("/api/mcp/tools", {}, "Failed to get MCP tools");
  },

  /**
   * Get all configured MCP servers and their statuses.
   */
  async getMcpServers() {
    return requestJson("/api/mcp/servers", {}, "Failed to get MCP servers");
  },

  /**
   * Toggle an MCP server's enabled status.
   * @param {string} serverName
   * @param {boolean} [enabled]
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
   * Fetch available models from OpenRouter.
   * @param {string} [apiKey] - Optional OpenRouter API key override
   */
  async getModels(apiKey = undefined) {
    const path = apiKey
      ? `/api/models?api_key=${encodeURIComponent(apiKey)}`
      : "/api/models";
    return requestJson(path, {}, "Failed to fetch OpenRouter models");
  },

  /**
   * Get current configuration settings.
   */
  async getSettings() {
    return requestJson("/api/settings", {}, "Failed to load settings");
  },

  /**
   * Update configuration settings.
   * @param {Object} settings
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
   * Get dynamic model pricing rates fetched from OpenRouter.
   */
  async getPricing() {
    return requestJson("/api/pricing", {}, "Failed to fetch model pricing");
  },

  /**
   * Force refresh dynamic model pricing rates from OpenRouter.
   */
  async refreshPricing() {
    return requestJson(
      "/api/pricing/refresh",
      { method: "POST" },
      "Failed to refresh model pricing",
    );
  },

  /**
   * Get cumulative token compression statistics.
   */
  async getCompressionStats() {
    return requestJson(
      "/api/compression/stats",
      {},
      "Failed to fetch compression stats",
    );
  },

  /**
   * Reset cumulative token compression statistics.
   */
  async resetCompressionStats() {
    return requestJson(
      "/api/compression/reset-stats",
      { method: "POST" },
      "Failed to reset compression stats",
    );
  },
};
