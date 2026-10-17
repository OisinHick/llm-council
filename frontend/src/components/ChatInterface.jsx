/**
 * ChatInterface Component: Main Conversation View and Execution Controls.
 *
 * Responsibilities:
 * - Conversation Header: Displays conversation title, mode tag, and interactive token counter badge.
 * - Message History Feed:
 *     - User messages with markdown rendering.
 *     - Assistant messages supporting:
 *         * Multi-stage Council deliberation (Stage 1 individual responses, Stage 2 peer rankings, Stage 3 synthesis).
 *         * "Just show final answer" mode with clean, unencumbered text.
 *         * One-shot Stage 4 Action Plan review and tool execution blocks.
 *         * Autonomous AgentTimeline with iterative ReAct loops and nested sub-council consultations.
 *         * Granular per-turn token usage badges and model breakdown tags.
 * - Tool Execution Output Renderer:
 *     - Formats structured tool results (stdout, stderr, JSON content, error banners, metadata key-values).
 * - Connected MCP Tools Drawer:
 *     - Displays discovered MCP tools, JSON input schemas, and real-time server connection status.
 *     - Allows enabling/disabling individual MCP servers.
 * - Execution Mode Slider:
 *     - Accessible 3-position glider: "Informational" (Stages 1-3), "One Shot" (Stage 4), "Agentic" (ReAct loop).
 * - Prompt Input Box:
 *     - Auto-resizing textarea with Enter to submit and Shift+Enter for newlines.
 *     - Quick launcher for the Council Deliberation Sensitivity configuration modal.
 */

import { useState, useEffect, useRef, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Stage1 from "./Stage1";
import Stage2 from "./Stage2";
import Stage3 from "./Stage3";
import AgentTimeline from "./AgentTimeline";
import CouncilSensitivityModal from "./CouncilSensitivityModal";
import { api } from "../api";
import { formatSpend, formatExactSpend, formatShortNumber } from "../formatters";
import "./ChatInterface.css";

/**
 * Safely parse a JSON string, returning null if invalid or not an object.
 *
 * @param {string} str - String to parse.
 * @returns {Object|null} Parsed object or null.
 */
const tryParseJSON = (str) => {
  if (typeof str !== "string") return null;
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // Not JSON
  }
  return null;
};

/**
 * Standard known output keys in tool observation payloads.
 */
const KNOWN_OUTPUT_KEYS = new Set([
  "stdout",
  "stderr",
  "message",
  "error",
  "content",
  "response",
  "success",
]);

/**
 * Extract recognized tool output fields from a nested payload and assign remaining fields to metadata.
 *
 * @param {Object} source - Raw tool result object.
 * @param {Object} out - Output accumulator object.
 */
const mergeExtractedFields = (source, out) => {
  if (!source || typeof source !== "object") return;
  if (source.stdout) out.stdout = source.stdout;
  if (source.stderr) out.stderr = source.stderr;
  if (source.message) out.message = source.message;
  if (source.error) out.error = source.error;

  Object.entries(source).forEach(([key, val]) => {
    if (!KNOWN_OUTPUT_KEYS.has(key)) {
      out.metadata[key] = val;
    }
  });
};

/**
 * Render structured tool observation results with styled stdout, stderr, JSON, and metadata cards.
 *
 * @param {Object|null} result - Raw tool result object.
 * @returns {JSX.Element|null} Formatted tool result view or null.
 */
const renderFormattedResult = (result) => {
  if (!result) return null;

  const out = {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    content: result.content || "",
    message: result.message || "",
    response: result.response || "",
    error: result.error || "",
    metadata: {},
  };

  // Try parsing content if it's a JSON string
  const parsedContent = tryParseJSON(out.content);
  if (parsedContent) {
    mergeExtractedFields(parsedContent, out);
    out.content = "";
  }

  // Try parsing response if stringified JSON or an object
  const parsedResponse =
    tryParseJSON(out.response) ||
    (typeof out.response === "object" ? out.response : null);
  if (parsedResponse) {
    mergeExtractedFields(parsedResponse, out);
    out.response = "";
  }

  // Top level extra metadata fields
  Object.entries(result).forEach(([key, val]) => {
    if (!KNOWN_OUTPUT_KEYS.has(key)) {
      out.metadata[key] = val;
    }
  });

  const { stdout, stderr, content, message, response, error, metadata } = out;

  return (
    <div className="formatted-result-container">
      {message && (
        <div className="output-section result-message-box">
          <h5>Message</h5>
          <p>{message}</p>
        </div>
      )}

      {error && (
        <div className="output-section result-error-box">
          <h5>Error</h5>
          <p className="execution-failure">{error}</p>
        </div>
      )}

      {stdout && (
        <div className="output-section result-stdout-box">
          <h5>Output (stdout)</h5>
          <pre className="stdout-pre">{stdout}</pre>
        </div>
      )}

      {stderr && (
        <div className="output-section result-stderr-box">
          <h5>Error Output (stderr)</h5>
          <pre className="stderr-pre">{stderr}</pre>
        </div>
      )}

      {content && (
        <div className="output-section result-content-box">
          <h5>Content</h5>
          <pre className="content-pre">
            {typeof content === "object"
              ? JSON.stringify(content, null, 2)
              : String(content)}
          </pre>
        </div>
      )}

      {response && (
        <div className="output-section result-response-box">
          <h5>Response</h5>
          <pre className="response-pre">
            {typeof response === "object"
              ? JSON.stringify(response, null, 2)
              : String(response)}
          </pre>
        </div>
      )}

      {Object.keys(metadata).length > 0 && (
        <div className="output-section result-metadata-box">
          <details className="metadata-details">
            <summary className="metadata-summary">
              <h5>Metadata</h5>
              <span className="expand-icon">▼</span>
            </summary>
            <div className="metadata-grid">
              {Object.entries(metadata).map(([key, val]) => (
                <div key={key} className="metadata-badge">
                  <span className="metadata-key">{key}:</span>{" "}
                  <span className="metadata-value">
                    {typeof val === "object"
                      ? JSON.stringify(val)
                      : String(val)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {!stdout &&
        !stderr &&
        !content &&
        !response &&
        !message &&
        !error &&
        Object.keys(metadata).length === 0 && (
          <div className="output-section">
            <h5>Result</h5>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
    </div>
  );
};

/**
 * Individual MCP tool card with expandable JSON input schema viewer.
 */
const McpToolItem = memo(({ tool }) => {
  const [isOpen, setIsOpen] = useState(false);

  const stringifiedSchema = useMemo(() => {
    if (!tool.input_schema) return "";
    return JSON.stringify(tool.input_schema, null, 2);
  }, [tool.input_schema]);

  return (
    <div className="mcp-tool-item">
      <div className="mcp-tool-meta">
        <span className="mcp-tool-server-badge">{tool.server}</span>
        <strong className="mcp-tool-name">{tool.name}</strong>
      </div>
      <p className="mcp-tool-desc">{tool.description}</p>
      {tool.input_schema && (
        <details
          className="mcp-schema-details"
          open={isOpen}
          onToggle={(e) => setIsOpen(e.target.open)}
        >
          <summary className="mcp-schema-summary">
            <span>Input Schema</span>
            <span className="expand-icon">▼</span>
          </summary>
          {isOpen && <pre className="mcp-tool-schema">{stringifiedSchema}</pre>}
        </details>
      )}
    </div>
  );
});

/**
 * List of active MCP tools rendered in the MCP tools discovery drawer.
 */
const McpToolsList = memo(({ mcpTools }) => {
  if (mcpTools.length === 0) {
    return (
      <p className="no-tools-text">
        No external MCP tools active. Configured tools in mcp_servers.json will
        appear here.
      </p>
    );
  }

  return mcpTools.map((tool, index) => (
    <McpToolItem key={`${tool.server}-${tool.name}-${index}`} tool={tool} />
  ));
});

/**
 * Main chat interface component.
 *
 * @param {Object} props - Component properties.
 * @param {Object|null} props.conversation - Active conversation object.
 * @param {string} [props.mode="informational"] - Active execution mode ("informational" | "one_shot" | "agentic").
 * @param {function(string): void} props.onModeChange - Mode change callback.
 * @param {boolean} [props.showAllDeliberationSteps=true] - Display all steps vs final answer.
 * @param {function(string): void} props.onSendMessage - Send informational message callback.
 * @param {function(string): void} props.onGenerateActionPlan - Generate action plan callback.
 * @param {function(): void} props.onExecuteActionPlan - Execute action plan callback.
 * @param {function(string, Object): void} props.onRunAgent - Run autonomous agent callback.
 * @param {function(): void} props.onCancelAgent - Cancel active agent callback.
 * @param {boolean} [props.agentLoading=false] - Whether an agent run is active.
 * @param {string|null} [props.agentError] - Error from agent run.
 * @param {Object|null} props.actionPlanResult - Generated action plan result.
 * @param {Object|null} props.actionExecutionResult - Executed action plan result.
 * @param {Object} props.actionStageResults - Intermediate stage results in action mode.
 * @param {Object} props.actionStageLoading - Intermediate stage loading flags in action mode.
 * @param {boolean} props.actionLoading - Action mode loading flag.
 * @param {string|null} props.actionError - Action mode error string.
 * @param {string} props.actionPlanRequest - Action mode prompt text.
 * @param {boolean} props.isLoading - Informational mode loading flag.
 * @param {boolean} [props.showTokenCount=true] - Display token counts toggle.
 * @param {boolean} [props.showTokensPerModel=false] - Display tokens per model toggle.
 * @param {boolean} [props.showSpendValue=true] - Display USD spend toggle.
 * @param {boolean} [props.showSavedTokens=true] - Display saved tokens toggle.
 * @returns {JSX.Element} Rendered chat interface.
 */
export default function ChatInterface({
  conversation,
  mode = "informational",
  onModeChange,
  showAllDeliberationSteps = true,
  generateActionPlanToggle,
  onSendMessage,
  onGenerateActionPlan,
  onExecuteActionPlan,
  onToggleGenerateActionPlan,
  onRunAgent,
  onCancelAgent,
  agentToggle,
  onToggleAgent,
  agentLoading = false,
  agentError = null,
  actionPlanResult,
  actionExecutionResult,
  actionStageResults,
  actionStageLoading,
  actionLoading,
  actionError,
  actionPlanRequest,
  isLoading,
  showTokenCount = true,
  showTokensPerModel = false,
  showSpendValue = true,
  showSavedTokens = true,
}) {
  const [input, setInput] = useState("");
  // Derive mode from props (with fallback for legacy toggle props)
  const currentMode =
    mode ||
    (agentToggle
      ? "agentic"
      : generateActionPlanToggle
        ? "one_shot"
        : "informational");
  const isAgentic = currentMode === "agentic" || currentMode === "action_mode";

  const [mcpTools, setMcpTools] = useState([]);
  const [mcpStatuses, setMcpStatuses] = useState({});
  const [showToolsList, setShowToolsList] = useState(false);
  const [selectedServer, setSelectedServer] = useState(null);
  const [showSensitivityModal, setShowSensitivityModal] = useState(false);
  const [sensitivityConfig, setSensitivityConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(
        "llm_council_deliberation_sensitivity"
      );
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.max_steps === undefined) {
          parsed.max_steps = 20;
        }
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse saved sensitivity config:", e);
    }
    return {
      level: "medium",
      auto_trigger_on_error: false,
      review_before_completion: false,
      max_consultations: 5,
      max_steps: 20,
    };
  });

  // Hydrate sensitivity config from backend settings on mount
  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        if (settings?.sensitivity_config) {
          setSensitivityConfig(settings.sensitivity_config);
          try {
            localStorage.setItem(
              "llm_council_deliberation_sensitivity",
              JSON.stringify(settings.sensitivity_config)
            );
          } catch (e) {
            console.warn("Failed to sync sensitivity config to localStorage:", e);
          }
        }
      })
      .catch(() => {});
  }, []);

  /**
   * Persist updated council deliberation sensitivity preferences to state, localStorage, and backend.
   *
   * @param {Object} newConfig - New sensitivity config object.
   */
  const handleSaveSensitivity = (newConfig) => {
    setSensitivityConfig(newConfig);
    try {
      localStorage.setItem(
        "llm_council_deliberation_sensitivity",
        JSON.stringify(newConfig)
      );
    } catch (e) {
      console.warn("Failed to persist sensitivity config to localStorage:", e);
    }
    api
      .updateSettings({ sensitivity_config: newConfig })
      .catch((err) => {
        console.warn("Failed to persist sensitivity config to backend:", err);
      });
  };

  const [mcpServers, setMcpServers] = useState([]);
  const [togglingServer, setTogglingServer] = useState(null);
  const messagesEndRef = useRef(null);

  // Extract unique server names from mcpServers, mcpTools, and mcpStatuses
  const servers = useMemo(() => {
    if (mcpServers.length > 0) {
      return mcpServers.map((s) => s.name);
    }
    const serverSet = new Set([
      ...mcpTools.map((t) => t.server),
      ...Object.keys(mcpStatuses),
    ]);
    return Array.from(serverSet);
  }, [mcpServers, mcpTools, mcpStatuses]);

  const activeServer =
    selectedServer && servers.includes(selectedServer)
      ? selectedServer
      : servers[0] || null;

  const activeServerObj = useMemo(() => {
    return mcpServers.find((s) => s.name === activeServer);
  }, [mcpServers, activeServer]);

  const isActiveServerEnabled = useMemo(() => {
    if (activeServerObj) return activeServerObj.enabled;
    return mcpStatuses[activeServer] !== "disabled";
  }, [activeServerObj, mcpStatuses, activeServer]);

  const unavailableServersCount = useMemo(() => {
    return Object.values(mcpStatuses).filter(
      (status) => status !== "connected" && status !== "disabled"
    ).length;
  }, [mcpStatuses]);

  const disabledServersCount = useMemo(() => {
    return Object.values(mcpStatuses).filter((status) => status === "disabled")
      .length;
  }, [mcpStatuses]);

  /**
   * Toggle an MCP server's enabled/disabled state via backend API.
   *
   * @param {string} serverName - Identifier name of the MCP server.
   * @param {React.MouseEvent} [e] - Click event to stop propagation.
   */
  const handleToggleServer = async (serverName, e) => {
    if (e) e.stopPropagation();
    setTogglingServer(serverName);
    try {
      const serverObj = mcpServers.find((s) => s.name === serverName);
      const currentEnabled = serverObj
        ? serverObj.enabled
        : mcpStatuses[serverName] !== "disabled";
      const res = await api.toggleMcpServer(serverName, !currentEnabled);
      if (res.success) {
        if (res.servers) setMcpServers(res.servers);
        if (res.tools) setMcpTools(res.tools);
        if (res.status) {
          setMcpStatuses((prev) => ({ ...prev, [serverName]: res.status }));
        }
      }
    } catch (err) {
      console.error("Failed to toggle MCP server:", err);
    } finally {
      setTogglingServer(null);
    }
  };

  // Poll MCP tools and server statuses every 5 seconds
  useEffect(() => {
    const fetchTools = async () => {
      try {
        const res = await api.getMcpTools();
        if (res.success) {
          setMcpTools(res.tools || []);
          setMcpStatuses(res.statuses || {});
          if (res.servers) {
            setMcpServers(res.servers);
          }
        }
      } catch (err) {
        console.error("Error loading MCP tools:", err);
      }
    };
    fetchTools();
    const interval = setInterval(fetchTools, 5000);
    return () => clearInterval(interval);
  }, [actionLoading, isLoading, agentLoading]);

  /**
   * Scroll the message feed container smoothly to the bottom.
   */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  /**
   * Switch the execution mode across Informational, One Shot, and Agentic.
   *
   * @param {string} newMode - "informational" | "one_shot" | "agentic".
   */
  const handleSelectMode = (newMode) => {
    if (isLoading || actionLoading || agentLoading) return;
    if (onModeChange) {
      onModeChange(newMode);
    }
    if (onToggleAgent)
      onToggleAgent(newMode === "agentic" || newMode === "action_mode");
    if (onToggleGenerateActionPlan)
      onToggleGenerateActionPlan(newMode === "one_shot");
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  /**
   * Form submission handler: dispatches to onRunAgent, onGenerateActionPlan, or onSendMessage.
   *
   * @param {React.FormEvent} e - Form submission event.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || actionLoading || agentLoading) return;

    if (isAgentic) {
      if (onRunAgent) {
        onRunAgent(input, sensitivityConfig);
      }
    } else if (currentMode === "one_shot") {
      onGenerateActionPlan(input);
    } else {
      onSendMessage(input);
    }

    setInput("");
  };

  /**
   * Keydown handler: triggers form submission on Enter (without Shift), allowing Shift+Enter for newlines.
   *
   * @param {React.KeyboardEvent} e - Keyboard event.
   */
  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const hasConversation = Boolean(conversation);
  const messages = conversation?.messages || [];
  const hasActionMessage = messages.some(
    (msg) =>
      msg.role === "assistant" &&
      (msg.action_request || msg.stage4 || msg.execution),
  );
  const actionPanelActive =
    actionLoading ||
    actionError ||
    actionPlanResult ||
    actionExecutionResult ||
    Object.values(actionStageLoading).some(Boolean);
  const showActionPanel = actionPanelActive && !hasActionMessage;

  const conversationTokens = conversation?.token_usage || {
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    by_model: {},
  };
  const hasModelBreakdown =
    conversationTokens.by_model &&
    Object.keys(conversationTokens.by_model).length > 0;

  return (
    <div className="chat-interface">
      {/* Top Header Bar for Conversation & Token Tracker */}
      <div className="chat-header">
        <div className="chat-header-info">
          <h2 className="chat-header-title">
            {conversation?.title || "New Conversation"}
          </h2>
          <span className={`conv-mode-tag mode-${currentMode}`}>
            {currentMode === "agentic"
              ? "🤖 Agentic"
              : currentMode === "one_shot"
                ? "⚡ One Shot"
                : "💬 Informational"}
          </span>
        </div>

        {showTokenCount && (
          <div className="chat-header-tokens">
            <div
              className="token-counter-widget"
              title={`Total tokens spent: ${conversationTokens.total_tokens.toLocaleString()} (Input: ${conversationTokens.prompt_tokens.toLocaleString()}, Output: ${conversationTokens.completion_tokens.toLocaleString()})${
                conversationTokens.total_cost !== undefined ? ` · Est. Spend: ${formatExactSpend(conversationTokens.total_cost)}` : ""
              }${
                showSavedTokens && conversationTokens.tokens_saved ? ` · Saved: ${conversationTokens.tokens_saved.toLocaleString()} tokens` : ""
              }${
                showSavedTokens && conversationTokens.total_cost_saved ? ` (${formatExactSpend(conversationTokens.total_cost_saved)})` : ""
              }`}
            >
              <div className="token-badge-main">
                <span className="token-icon">🪙</span>
                <span className="token-label">Tokens:</span>
                <span className="token-value">
                  {conversationTokens.total_tokens.toLocaleString()}
                </span>
                {showSpendValue && conversationTokens.total_cost !== undefined && (
                  <span
                    className="token-spend-pill"
                    title={`Est. Spend: ${formatExactSpend(conversationTokens.total_cost)}`}
                  >
                    💵 {formatSpend(conversationTokens.total_cost)}
                  </span>
                )}
                {showSavedTokens && conversationTokens.tokens_saved > 0 && (
                  <span
                    className="token-saved-pill"
                    title={`Tokens saved by compression: ${conversationTokens.tokens_saved.toLocaleString()}${
                      conversationTokens.total_cost_saved ? ` · Est. Saved: ${formatExactSpend(conversationTokens.total_cost_saved)}` : ""
                    }`}
                  >
                    🌱 Saved: {formatShortNumber(conversationTokens.tokens_saved)}
                    {showSpendValue && conversationTokens.total_cost_saved > 0 && (
                      <span className="token-saved-spend"> ({formatSpend(conversationTokens.total_cost_saved)})</span>
                    )}
                  </span>
                )}
              </div>

              {showTokensPerModel && hasModelBreakdown && (
                <div className="token-models-breakdown">
                  {Object.entries(conversationTokens.by_model).map(
                    ([modelName, mData]) => {
                      const shortModel =
                        modelName.split("/")[1] || modelName;
                      const mTotal = mData.total_tokens || 0;
                      const mPrompt = mData.prompt_tokens || 0;
                      const mComp = mData.completion_tokens || 0;
                      const mCost = mData.cost;
                      return (
                        <span
                          key={modelName}
                          className="token-model-chip"
                          title={`${modelName}: ${mTotal.toLocaleString()} tokens (Input: ${mPrompt.toLocaleString()} | Output: ${mComp.toLocaleString()})${
                            mCost !== undefined ? ` · Est. Spend: ${formatExactSpend(mCost)}` : ""
                          }`}
                        >
                          <span className="model-chip-name">{shortModel}</span>
                          <span className="model-chip-count">
                            {mTotal.toLocaleString()}
                            {showSpendValue && mCost !== undefined && (
                              <span className="model-chip-spend"> ({formatSpend(mCost)})</span>
                            )}
                          </span>
                        </span>
                      );
                    }
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="messages-container">
        {!hasConversation ? (
          <div className="empty-state">
            <h2>Welcome to LLM Council</h2>
            <p>
              Choose Informational, One Shot, or Agentic using the slider below
              to begin.
            </p>
          </div>
        ) : messages.length === 0 && !actionPanelActive ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>
              Choose Informational, One Shot, or Agentic using the slider below
              to begin.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const actionRequestText =
              msg.action_request ||
              (msg.stage4 && messages[index - 1]?.role === "user"
                ? messages[index - 1].content
                : null);

            return (
              <div key={index} className="message-group">
                {msg.role === "user" ? (
                  <div className="user-message">
                    <div className="message-content">
                      <div className="message-label">You</div>
                      <div className="markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="assistant-message">
                    <div className="message-label">
                      <span>
                        {msg.type === "agent" ? "Council Chairperson Agent" : "LLM Council"}
                      </span>
                      {showTokenCount && msg.token_usage && msg.token_usage.total_tokens > 0 && (
                        <span
                          className="msg-token-badge"
                          title={`Turn Tokens: ${msg.token_usage.total_tokens.toLocaleString()} (Input: ${(msg.token_usage.prompt_tokens || 0).toLocaleString()} | Output: ${(msg.token_usage.completion_tokens || 0).toLocaleString()})${
                            msg.token_usage?.total_cost !== undefined ? ` · Est. Spend: ${formatExactSpend(msg.token_usage.total_cost)}` : ""
                          }${
                            showSavedTokens && msg.token_usage?.tokens_saved ? ` · Saved: ${msg.token_usage.tokens_saved.toLocaleString()} tokens` : ""
                          }${
                            showSavedTokens && msg.token_usage?.total_cost_saved ? ` (${formatExactSpend(msg.token_usage.total_cost_saved)})` : ""
                          }`}
                        >
                          🪙 {msg.token_usage.total_tokens.toLocaleString()} tokens
                          {showSpendValue && msg.token_usage?.total_cost > 0 && (
                            <span className="msg-token-spend"> · {formatSpend(msg.token_usage.total_cost)}</span>
                          )}
                          {showSavedTokens && msg.token_usage?.tokens_saved > 0 && (
                            <span className="msg-token-saved">
                              {" "}· 🌱 Saved {formatShortNumber(msg.token_usage.tokens_saved)}
                              {showSpendValue && msg.token_usage?.total_cost_saved > 0 && (
                                <> ({formatSpend(msg.token_usage.total_cost_saved)})</>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {showTokensPerModel &&
                      msg.token_usage?.by_model &&
                      Object.keys(msg.token_usage.by_model).length > 0 && (
                        <div className="msg-model-tokens-breakdown">
                          {Object.entries(msg.token_usage.by_model).map(
                            ([modelName, mData]) => {
                              const shortM = modelName.split("/")[1] || modelName;
                              const mTotal = mData.total_tokens || 0;
                              const mCost = mData.cost;
                              return (
                                <span
                                  key={modelName}
                                  className="msg-model-token-tag"
                                  title={`${modelName}: ${mTotal.toLocaleString()} tokens (Input: ${(mData.prompt_tokens || 0).toLocaleString()} | Output: ${(mData.completion_tokens || 0).toLocaleString()})${
                                    mCost !== undefined ? ` · Est. Spend: ${formatExactSpend(mCost)}` : ""
                                  }`}
                                >
                                  {shortM}: {mTotal.toLocaleString()}
                                  {showSpendValue && mCost !== undefined && (
                                    <span className="msg-model-spend"> ({formatSpend(mCost)})</span>
                                  )}
                                </span>
                              );
                            }
                          )}
                        </div>
                      )}

                    {msg.type === "agent" || msg.steps ? (
                      <AgentTimeline
                        agentData={msg}
                        isRunning={msg.isRunning || (msg.status === "running")}
                        onCancel={onCancelAgent}
                      />
                    ) : (
                      <>
                        {showAllDeliberationSteps ? (
                          <>
                            {/* Stage 1 */}
                            {msg.loading?.stage1 && (
                              <div className="stage-loading">
                                <div className="spinner"></div>
                                <span>
                                  Running Stage 1: Collecting individual responses...
                                </span>
                              </div>
                            )}
                            {msg.stage1 && <Stage1 responses={msg.stage1} />}

                            {/* Stage 2 */}
                            {msg.loading?.stage2 && (
                              <div className="stage-loading">
                                <div className="spinner"></div>
                                <span>Running Stage 2: Peer rankings...</span>
                              </div>
                            )}
                            {msg.stage2 && (
                              <Stage2
                                rankings={msg.stage2}
                                labelToModel={msg.metadata?.label_to_model}
                                aggregateRankings={msg.metadata?.aggregate_rankings}
                              />
                            )}

                            {/* Stage 3 */}
                            {msg.loading?.stage3 && (
                              <div className="stage-loading">
                                <div className="spinner"></div>
                                <span>Running Stage 3: Final synthesis...</span>
                              </div>
                            )}
                            {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                          </>
                        ) : (
                          <>
                            {/* Just show final answer: clean chat response with no intermediate stages, sub-divs, headings or dropdown */}
                            {(msg.loading?.stage1 ||
                              msg.loading?.stage2 ||
                              msg.loading?.stage3) &&
                              !msg.stage3 && (
                                <div className="stage-loading">
                                  <div className="spinner"></div>
                                  <span>Council is deliberating...</span>
                                </div>
                              )}
                            {msg.stage3?.response && (
                              <div className="markdown-content">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {msg.stage3.response}
                                </ReactMarkdown>
                              </div>
                            )}
                          </>
                        )}

                    {/* Action Request */}
                    {actionRequestText && (
                      <div className="action-request-block">
                        <h4>Action Request</h4>
                        <div className="markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {actionRequestText}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {/* Action Plan */}
                    {msg.loading?.stage4 && (
                      <div className="stage-loading">
                        <div className="spinner"></div>
                        <span>Generating action plan...</span>
                      </div>
                    )}

                    {msg.stage4 && (
                      <div className="action-plan-block">
                        <h4>Action Plan</h4>
                        {msg.stage4.success || msg.stage4.action_plan ? (
                          <>
                            <div className="plan-summary">
                              <p>{msg.stage4.action_plan?.description}</p>
                              <p>{msg.stage4.action_plan?.reasoning}</p>
                            </div>
                          <div className="tool-calls">
                            {msg.stage4.action_plan?.tool_calls?.map(
                              (call, idx) => (
                                <div key={idx} className="tool-call">
                                  <div className="tool-call-header">
                                    <strong>
                                      {call.tool}{" "}
                                      {call.server &&
                                        call.server !== "local" && (
                                          <span className="server-tag">
                                            ({call.server})
                                          </span>
                                        )}
                                    </strong>
                                    <span>{call.description}</span>
                                  </div>
                                  {call.params &&
                                    Object.values(call.params).some(
                                      (val) =>
                                        val !== null &&
                                        val !== undefined &&
                                        val !== "",
                                    ) && (
                                      <div className="formatted-params">
                                        {Object.entries(call.params)
                                          .filter(
                                            (entry) =>
                                              entry[1] !== null &&
                                              entry[1] !== undefined &&
                                              entry[1] !== "",
                                          )
                                          .map(([key, value]) => (
                                            <div
                                              key={key}
                                              className="param-row"
                                            >
                                              <span className="param-key">
                                                {key}
                                              </span>
                                              <span className="param-value">
                                                {typeof value === "object"
                                                  ? JSON.stringify(
                                                      value,
                                                      null,
                                                      2,
                                                    )
                                                  : String(value)}
                                              </span>
                                            </div>
                                          ))}
                                      </div>
                                    )}
                                </div>
                              ),
                            )}
                          </div>

                          {!msg.execution && msg.stage4.action_plan && (
                            <div className="action-buttons">
                              <button
                                type="button"
                                className="execute-action-btn"
                                onClick={onExecuteActionPlan}
                                disabled={
                                  actionLoading || msg.loading?.execution
                                }
                              >
                                Execute Action Plan
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="action-error">
                          <strong>Action plan failed:</strong>{" "}
                          {msg.stage4.error}
                        </div>
                      )}
                    </div>
                  )}

                  {msg.loading?.execution && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Executing action plan...</span>
                    </div>
                  )}

                  {msg.execution && (
                    <div className="execution-block">
                      <h4 className="execution-heading">
                        <span>Execution Results</span>
                        <span
                          className={`execution-status-badge ${
                            msg.execution.success ? "success" : "failure"
                          }`}
                        >
                          {msg.execution.success ? "✅ Success" : "⚠️ Failed"}
                        </span>
                      </h4>
                      {msg.execution.execution_results?.results?.map(
                        (toolResult, idx) => (
                          <div key={idx} className="tool-result">
                            <div className="result-header">
                              <strong>
                                {toolResult.tool}
                                {toolResult.server &&
                                  toolResult.server !== "local" && (
                                    <span className="server-tag">
                                      ({toolResult.server})
                                    </span>
                                  )}
                              </strong>
                            </div>

                            {toolResult.params &&
                              Object.keys(toolResult.params).filter(
                                (key) =>
                                  toolResult.params[key] !== null &&
                                  toolResult.params[key] !== undefined &&
                                  toolResult.params[key] !== "",
                              ).length > 0 && (
                                <div className="output-section">
                                  <h5>Parameters</h5>
                                  <div className="formatted-params">
                                    {Object.entries(toolResult.params)
                                      .filter(
                                        (entry) =>
                                          entry[1] !== null &&
                                          entry[1] !== undefined &&
                                          entry[1] !== "",
                                      )
                                      .map(([key, value]) => (
                                        <div key={key} className="param-row">
                                          <span className="param-key">
                                            {key}
                                          </span>
                                          <span className="param-value">
                                            {typeof value === "object"
                                              ? JSON.stringify(value, null, 2)
                                              : String(value)}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}

                            <div className="result-output">
                              {renderFormattedResult(toolResult.result)}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

        {(isLoading || actionLoading) && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        {showActionPanel && (
          <div className="action-panel">
            {actionLoading && (
              <div className="action-loading">
                <div className="spinner"></div>
                <span>Generating or executing action plan...</span>
              </div>
            )}

            {actionError && (
              <div className="action-error">
                <strong>Error:</strong> {actionError}
              </div>
            )}

            {agentError && (
              <div
                className="action-error"
                style={{
                  borderColor: "#fca5a5",
                  background: "#fef2f2",
                  color: "#991b1b",
                }}
              >
                <strong>Agent Error:</strong> {agentError}
              </div>
            )}

            {showAllDeliberationSteps ? (
              <>
                {actionStageLoading.stage1 && (
                  <div className="stage-loading">
                    <div className="spinner"></div>
                    <span>Running Stage 1: Collecting individual responses...</span>
                  </div>
                )}

                {actionStageResults.stage1 && (
                  <div className="action-stages">
                    <div className="stage-block">
                      <h4>Stage 1: Individual Responses</h4>
                      <Stage1 responses={actionStageResults.stage1} />
                    </div>
                  </div>
                )}

                {actionStageLoading.stage2 && (
                  <div className="stage-loading">
                    <div className="spinner"></div>
                    <span>Running Stage 2: Peer rankings...</span>
                  </div>
                )}

                {actionStageResults.stage2 && (
                  <div className="action-stages">
                    <div className="stage-block">
                      <h4>Stage 2: Peer Rankings</h4>
                      <Stage2
                        rankings={actionStageResults.stage2}
                        labelToModel={actionStageResults.metadata?.label_to_model}
                        aggregateRankings={
                          actionStageResults.metadata?.aggregate_rankings
                        }
                      />
                    </div>
                  </div>
                )}

                {actionStageLoading.stage3 && (
                  <div className="stage-loading">
                    <div className="spinner"></div>
                    <span>Running Stage 3: Final synthesis...</span>
                  </div>
                )}

                {actionStageResults.stage3 && (
                  <div className="action-stages">
                    <div className="stage-block">
                      <h4>Stage 3: Final Synthesis</h4>
                      <Stage3 finalResponse={actionStageResults.stage3} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {(actionStageLoading.stage1 ||
                  actionStageLoading.stage2 ||
                  actionStageLoading.stage3) &&
                  !actionStageResults.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Council is deliberating...</span>
                    </div>
                  )}
                {actionStageResults.stage3?.response && (
                  <div className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {actionStageResults.stage3.response}
                    </ReactMarkdown>
                  </div>
                )}
              </>
            )}

            {/* Action Request */}
            {actionPlanRequest && (
              <div className="action-request-block">
                <h4>Action Request</h4>
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {actionPlanRequest}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Action Plan */}
            {actionStageLoading.stage4 && (
              <div className="stage-loading">
                <div className="spinner"></div>
                <span>Generating action plan...</span>
              </div>
            )}

            {actionPlanResult?.stage4_action_plan ? (
              <div className="action-plan-block plan-details">
                <h4>Action Plan</h4>
                {actionPlanResult.stage4_action_plan.success ||
                actionPlanResult.stage4_action_plan.action_plan ? (
                  <>
                    <div className="plan-summary">
                      <p>
                        {
                          actionPlanResult.stage4_action_plan.action_plan
                            ?.description
                        }
                      </p>
                      <p>
                        {
                          actionPlanResult.stage4_action_plan.action_plan
                            ?.reasoning
                        }
                      </p>
                    </div>

                    <div className="tool-calls">
                      <h5>Tool Calls</h5>
                      {actionPlanResult.stage4_action_plan.action_plan?.tool_calls?.map(
                        (call, idx) => (
                          <div key={idx} className="tool-call">
                            <div className="tool-call-header">
                              <strong>
                                {call.tool}{" "}
                                {call.server && call.server !== "local" && (
                                  <span className="server-tag">
                                    ({call.server})
                                  </span>
                                )}
                              </strong>
                              <span>{call.description}</span>
                            </div>
                            {call.params &&
                              Object.values(call.params).some(
                                (val) =>
                                  val !== null &&
                                  val !== undefined &&
                                  val !== "",
                              ) && (
                                <div className="formatted-params">
                                  {Object.entries(call.params)
                                    .filter(
                                      (entry) =>
                                        entry[1] !== null &&
                                        entry[1] !== undefined &&
                                        entry[1] !== "",
                                    )
                                    .map(([key, value]) => (
                                      <div key={key} className="param-row">
                                        <span className="param-key">{key}</span>
                                        <span className="param-value">
                                          {typeof value === "object"
                                            ? JSON.stringify(value, null, 2)
                                            : String(value)}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              )}
                          </div>
                        ),
                      )}
                    </div>

                    <div className="action-buttons">
                      <button
                        type="button"
                        className="execute-action-btn"
                        onClick={onExecuteActionPlan}
                        disabled={actionLoading}
                      >
                        Execute Action Plan
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="action-error">
                    <strong>Action plan failed:</strong>{" "}
                    {actionPlanResult.stage4_action_plan.error}
                  </div>
                )}
              </div>
            ) : actionPlanResult ? (
              <div className="plan-details">
                <h4>Action Plan Result</h4>
                <pre>{JSON.stringify(actionPlanResult, null, 2)}</pre>
              </div>
            ) : null}

            {actionExecutionResult && (
              <div className="execution-block execution-details">
                <h4 className="execution-heading">
                  <span>Execution Results</span>
                  <span
                    className={`execution-status-badge ${
                      actionExecutionResult.success ? "success" : "failure"
                    }`}
                  >
                    {actionExecutionResult.success ? "✅ Success" : "⚠️ Failed"}
                  </span>
                </h4>
                {actionExecutionResult.action_plan && (
                  <div className="plan-summary">
                    <h5>Executed Plan</h5>
                    <p>{actionExecutionResult.action_plan.description}</p>
                    <p>{actionExecutionResult.action_plan.reasoning}</p>
                  </div>
                )}
                {actionExecutionResult.execution_results?.results?.map(
                  (toolResult, idx) => (
                    <div key={idx} className="tool-result">
                      <div className="result-header">
                        <strong>
                          {toolResult.tool}
                          {toolResult.server &&
                            toolResult.server !== "local" && (
                              <span className="server-tag">
                                ({toolResult.server})
                              </span>
                            )}
                        </strong>
                      </div>

                      {toolResult.params &&
                        Object.entries(toolResult.params).filter(
                          (entry) =>
                            entry[1] !== null &&
                            entry[1] !== undefined &&
                            entry[1] !== "",
                        ).length > 0 && (
                          <div className="output-section">
                            <h5>Parameters</h5>
                            <div className="formatted-params">
                              {Object.entries(toolResult.params)
                                .filter(
                                  (entry) =>
                                    entry[1] !== null &&
                                    entry[1] !== undefined &&
                                    entry[1] !== "",
                                )
                                .map(([key, value]) => (
                                  <div key={key} className="param-row">
                                    <span className="param-key">{key}</span>
                                    <span className="param-value">
                                      {typeof value === "object"
                                        ? JSON.stringify(value, null, 2)
                                        : String(value)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                      <div className="result-output">
                        {renderFormattedResult(toolResult.result)}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showToolsList && (
        <div
          className="mcp-tools-modal-backdrop"
          onClick={() => setShowToolsList(false)}
        >
          <div
            className="mcp-tools-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mcp-tools-header">
              <h4>
                <span className="mcp-modal-title">Active MCP Tools</span>
                <span className="mcp-modal-count">{mcpTools.length}</span>
                {unavailableServersCount > 0 && (
                  <span className="header-warning-text">
                    {unavailableServersCount} offline
                  </span>
                )}
              </h4>
              <button
                type="button"
                onClick={() => setShowToolsList(false)}
                className="close-overlay-btn"
              >
                ×
              </button>
            </div>
            <div className="mcp-modal-layout">
              <div className="mcp-modal-sidebar">
                <h5>Servers</h5>
                <div className="mcp-sidebar-list">
                  {servers.map((server) => {
                    const count = mcpTools.filter(
                      (t) => t.server === server,
                    ).length;
                    const status = mcpStatuses[server];
                    const serverObj = mcpServers.find((s) => s.name === server);
                    const isEnabled = serverObj
                      ? serverObj.enabled
                      : status !== "disabled";
                    const isOffline =
                      status && status !== "connected" && status !== "disabled";
                    const isDisabled = status === "disabled" || !isEnabled;

                    return (
                      <div
                        key={server}
                        className={`mcp-sidebar-item ${activeServer === server ? "active" : ""} ${isOffline ? "offline" : ""} ${isDisabled ? "disabled" : ""}`}
                        onClick={() => setSelectedServer(server)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="mcp-sidebar-item-info">
                          <span className="mcp-server-name">{server}</span>
                          {isOffline && (
                            <span
                              className="mcp-server-status-tag error"
                              title={status}
                            >
                              {status}
                            </span>
                          )}
                          {isDisabled && (
                            <span className="mcp-server-status-tag disabled">
                              Disabled
                            </span>
                          )}
                          {!isOffline && !isDisabled && (
                            <span className="mcp-server-status-tag connected">
                              Connected
                            </span>
                          )}
                        </div>
                        <div className="mcp-sidebar-item-right">
                          <span className="mcp-server-count">{count}</span>
                          <button
                            type="button"
                            className={`mcp-mini-toggle ${isEnabled ? "active" : ""}`}
                            title={isEnabled ? `Disable ${server}` : `Enable ${server}`}
                            onClick={(e) => handleToggleServer(server, e)}
                            disabled={togglingServer === server}
                          >
                            <span className="mcp-mini-toggle-thumb" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mcp-modal-panel">
                {activeServer ? (
                  <>
                    <div className="mcp-panel-header">
                      <div className="mcp-panel-header-info">
                        <h5 className="mcp-panel-title">
                          Server: <span>{activeServer}</span>
                        </h5>
                        {activeServerObj?.command && (
                          <code className="mcp-panel-cmd">
                            {activeServerObj.command} {activeServerObj.args?.join(" ")}
                          </code>
                        )}
                      </div>
                      <div className="mcp-panel-toggle-wrapper">
                        <span
                          className={`mcp-toggle-status-text ${isActiveServerEnabled ? "enabled" : "disabled"}`}
                        >
                          {isActiveServerEnabled ? "Enabled" : "Disabled"}
                        </span>
                        <button
                          type="button"
                          className={`mcp-toggle-switch ${isActiveServerEnabled ? "active" : ""}`}
                          onClick={(e) => handleToggleServer(activeServer, e)}
                          disabled={togglingServer === activeServer}
                          title={
                            isActiveServerEnabled
                              ? "Click to disable server"
                              : "Click to enable server"
                          }
                        >
                          <span className="mcp-toggle-slider" />
                        </button>
                      </div>
                    </div>

                    {!isActiveServerEnabled ? (
                      <div className="mcp-server-disabled-container">
                        <div className="mcp-disabled-icon">🔒</div>
                        <div className="mcp-disabled-text-group">
                          <p className="mcp-server-disabled-title">
                            Server is Disabled
                          </p>
                          <p className="mcp-server-disabled-detail">
                            Tools from <strong>{activeServer}</strong> are
                            currently disabled and will not be provided to
                            Council deliberations or Agentic workflows.
                          </p>
                          <button
                            type="button"
                            className="mcp-enable-btn"
                            onClick={() => handleToggleServer(activeServer)}
                            disabled={togglingServer === activeServer}
                          >
                            {togglingServer === activeServer
                              ? "Enabling..."
                              : "Enable Server"}
                          </button>
                        </div>
                      </div>
                    ) : mcpStatuses[activeServer] &&
                      mcpStatuses[activeServer] !== "connected" ? (
                      <div className="mcp-server-error-container">
                        <p className="mcp-server-error-title">
                          ⚠️ Connection Failed
                        </p>
                        <p className="mcp-server-error-detail">
                          The MCP server <strong>{activeServer}</strong> is
                          currently unavailable (Status:{" "}
                          {mcpStatuses[activeServer]}).
                        </p>
                        <p className="mcp-server-error-hint">
                          Please check the server logs or verify that the server
                          is running correctly.
                        </p>
                      </div>
                    ) : (
                      <div className="mcp-tools-list">
                        <McpToolsList
                          mcpTools={mcpTools.filter(
                            (t) => t.server === activeServer,
                          )}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="no-tools-text">
                    No external MCP tools active. Configured tools in
                    mcp_servers.json will appear here.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="mode-slider-container">
          <div className="mode-slider-header">
            <span className="mode-slider-label">Execution Mode</span>
            <span className="mode-slider-hint">
              {currentMode === "informational" &&
                "Standard council deliberation & synthesis (Stage 1-3)"}
              {currentMode === "one_shot" &&
                "Generate & execute MCP tool action plan in one shot (Stage 1-4)"}
              {isAgentic &&
                "Autonomous Chairperson ReAct loop with multi-step tool execution"}
            </span>
          </div>

          <div
            className="mode-slider-track"
            role="radiogroup"
            aria-label="Execution mode selection"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                if (currentMode === "informational") handleSelectMode("one_shot");
                else if (currentMode === "one_shot") handleSelectMode("agentic");
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                if (isAgentic) handleSelectMode("one_shot");
                else if (currentMode === "one_shot") handleSelectMode("informational");
              }
            }}
          >
            <div
              className={`mode-slider-glider pos-${
                currentMode === "one_shot"
                  ? "1"
                  : isAgentic
                    ? "2"
                    : "0"
              }`}
            />
            <button
              type="button"
              className={`mode-slider-btn ${
                currentMode === "informational" ? "active" : ""
              }`}
              onClick={() => handleSelectMode("informational")}
              disabled={isLoading || actionLoading || agentLoading}
              title="Informational: Standard council deliberation (Stages 1-3)"
              role="radio"
              aria-checked={currentMode === "informational"}
            >
              <span className="mode-slider-icon">💬</span>
              <span className="mode-slider-text">Informational</span>
            </button>
            <button
              type="button"
              className={`mode-slider-btn ${
                currentMode === "one_shot" ? "active" : ""
              }`}
              onClick={() => handleSelectMode("one_shot")}
              disabled={isLoading || actionLoading || agentLoading}
              title="One Shot: Generate and execute action plan once (Stage 4)"
              role="radio"
              aria-checked={currentMode === "one_shot"}
            >
              <span className="mode-slider-icon">⚡</span>
              <span className="mode-slider-text">One Shot</span>
            </button>
            <button
              type="button"
              className={`mode-slider-btn ${
                isAgentic ? "active" : ""
              }`}
              onClick={() => handleSelectMode("agentic")}
              disabled={isLoading || actionLoading || agentLoading}
              title="Agentic: Autonomous multi-step ReAct agent loop"
              role="radio"
              aria-checked={isAgentic}
            >
              <span className="mode-slider-icon">🤖</span>
              <span className="mode-slider-text">Agentic</span>
            </button>
          </div>
        </div>

        <div className="input-row">
          <textarea
            className="message-input"
            placeholder={
              isAgentic
                ? "Describe the goal for the Council Chairperson Agent (e.g. write code, generate documentation, run tests)..."
                : currentMode === "one_shot"
                  ? "Describe a task to plan and execute with MCP tools (Shift+Enter for new line, Enter to send)..."
                  : "Ask your question... (Shift+Enter for new line, Enter to send)"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || actionLoading || agentLoading}
            rows={3}
          />

          <div className="input-actions">
            <div
              className="mcp-status"
              onClick={() => setShowToolsList(!showToolsList)}
              title={
                unavailableServersCount > 0
                  ? `Click to view all MCP tools (${unavailableServersCount} server(s) offline)`
                  : disabledServersCount > 0
                    ? `Click to view all MCP tools (${disabledServersCount} server(s) disabled)`
                    : "Click to view all active MCP tools"
              }
            >
              <span
                className={`status-dot ${
                  unavailableServersCount > 0
                    ? "warning"
                    : mcpTools.length > 0
                      ? "connected"
                      : ""
                }`}
              ></span>
              <span>
                {mcpTools.length} Active MCP{" "}
                {mcpTools.length === 1 ? "Tool" : "Tools"}
                {unavailableServersCount > 0 &&
                  ` (${unavailableServersCount} offline)`}
                {unavailableServersCount === 0 &&
                  disabledServersCount > 0 &&
                  ` (${disabledServersCount} off)`}
              </span>
            </div>

            {agentLoading && onCancelAgent ? (
              <button
                type="button"
                className="send-button"
                style={{ background: "#dc2626" }}
                onClick={onCancelAgent}
              >
                Stop Agent
              </button>
            ) : (
              <div className="action-buttons-group">
                {isAgentic && (
                  <button
                    type="button"
                    className={`agent-sensitivity-btn level-${sensitivityConfig?.level || "medium"}`}
                    onClick={() => setShowSensitivityModal(true)}
                    title={`Council Deliberation Sensitivity: ${(sensitivityConfig?.level || "medium").toUpperCase()}`}
                    aria-label="Open Council Deliberation Sensitivity settings"
                  >
                    <span className="sensitivity-icon">🧠</span>
                  </button>
                )}
                <button
                  type="submit"
                  className="send-button"
                  disabled={
                    !input.trim() || isLoading || actionLoading || agentLoading
                  }
                >
                  {isAgentic
                    ? "Run Agent"
                    : currentMode === "one_shot"
                      ? "Generate Plan"
                      : "Send"}
                </button>
              </div>
            )}
          </div>
        </div>
      </form>

      <CouncilSensitivityModal
        isOpen={showSensitivityModal}
        onClose={() => setShowSensitivityModal(false)}
        sensitivityConfig={sensitivityConfig}
        onSave={handleSaveSensitivity}
      />
    </div>
  );
}
