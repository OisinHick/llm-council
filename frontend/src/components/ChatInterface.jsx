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
 *         * Custom WorkflowTimeline with step-by-step DAG node execution and outputs.
 *         * Granular per-turn token usage badges and model breakdown tags.
 * - Tool Execution Output Renderer:
 *     - Formats structured tool results (stdout, stderr, JSON content, error banners, metadata key-values).
 * - Connected MCP Tools Drawer:
 *     - Displays discovered MCP tools, JSON input schemas, and real-time server connection status.
 *     - Allows enabling/disabling individual MCP servers.
 * - Execution Mode Controls:
 *     - Dropdown: "Informational" (Stages 1-3), "One Shot Execution" (Stage 4), "Agentic" (ReAct loop),
 *       and "Custom Workflows" (visual DAG pipelines).
 * - Prompt Input Box:
 *     - Auto-resizing textarea with Enter to submit and Shift+Enter for newlines.
 *     - Quick launcher for the Agentic Loop & Council Settings modal.
 */

import { useState, useEffect, useRef, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Stage1 from "./Stage1";
import Stage2 from "./Stage2";
import Stage3 from "./Stage3";
import AgentTimeline from "./AgentTimeline";
import WorkflowTimeline from "./WorkflowTimeline";
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
 * Preconfigured templates for popular Model Context Protocol (MCP) servers.
 */
const MCP_SERVER_PRESETS = [
  {
    id: "custom",
    label: "Custom Command (Manual)",
    name: "",
    command: "",
    args: "",
    env: "",
  },
  {
    id: "filesystem",
    label: "Filesystem (Node/npx)",
    name: "filesystem",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem /tmp",
    env: "",
  },
  {
    id: "memory",
    label: "Knowledge Graph Memory (Node/npx)",
    name: "memory",
    command: "npx",
    args: "-y @modelcontextprotocol/server-memory",
    env: "",
  },
  {
    id: "fetch",
    label: "Fetch & Web Scraping (Python/uvx)",
    name: "fetch",
    command: "uvx",
    args: "mcp-server-fetch",
    env: "",
  },
  {
    id: "git",
    label: "Git Repository Tools (Python/uvx)",
    name: "git",
    command: "uvx",
    args: "mcp-server-git --repository .",
    env: "",
  },
  {
    id: "sqlite",
    label: "SQLite Database (Python/uvx)",
    name: "sqlite",
    command: "uvx",
    args: "mcp-server-sqlite --db-path ./data.db",
    env: "",
  },
  {
    id: "brave-search",
    label: "Brave Web Search (Node/npx)",
    name: "brave-search",
    command: "npx",
    args: "-y @modelcontextprotocol/server-brave-search",
    env: "BRAVE_API_KEY=",
  },
  {
    id: "github",
    label: "GitHub Operations (Node/npx)",
    name: "github",
    command: "npx",
    args: "-y @modelcontextprotocol/server-github",
    env: "GITHUB_PERSONAL_ACCESS_TOKEN=",
  },
];

/**
 * Robustly parses a space-delimited string (with quotes) or a JSON array into a list of argument strings.
 *
 * @param {string} str - Raw arguments string.
 * @returns {Array<string>} Parsed array of command argument tokens.
 */
const parseArgsString = (str) => {
  if (!str || !str.trim()) return [];
  const trimmed = str.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      // Fall through to regex tokenization
    }
  }
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const matches = [];
  let match;
  while ((match = regex.exec(trimmed)) !== null) {
    matches.push(
      match[1] !== undefined
        ? match[1]
        : match[2] !== undefined
          ? match[2]
          : match[0]
    );
  }
  return matches;
};

/**
 * Robustly parses environment variables from JSON object or newline-separated KEY=VALUE pairs.
 *
 * @param {string} str - Raw environment variables string.
 * @returns {Object<string, string>|null} Key-value map of environment variables or null.
 */
const parseEnvString = (str) => {
  if (!str || !str.trim()) return null;
  const trimmed = str.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [String(k).trim(), String(v)])
        );
      }
    } catch {
      // Fall through to line-based parsing
    }
  }
  const envObj = {};
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.startsWith("#")) continue;
    const eqIdx = cleanLine.indexOf("=");
    if (eqIdx !== -1) {
      const key = cleanLine.slice(0, eqIdx).trim();
      const val = cleanLine.slice(eqIdx + 1).trim();
      if (key) {
        envObj[key] = val;
      }
    }
  }
  return Object.keys(envObj).length > 0 ? envObj : null;
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
 * Renders non-empty tool parameters as formatted key-value pairs.
 *
 * @param {Object} props - Component properties.
 * @param {Object} [props.params] - Tool parameters dictionary.
 * @returns {JSX.Element|null} Rendered parameters or null if empty.
 */
function FormattedParams({ params }) {
  if (!params || typeof params !== "object") return null;
  const nonEmptyEntries = Object.entries(params).filter(
    ([, val]) => val !== null && val !== undefined && val !== "",
  );
  if (nonEmptyEntries.length === 0) return null;

  return (
    <div className="formatted-params">
      {nonEmptyEntries.map(([key, value]) => (
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
  );
}

/**
 * Renders a Stage 4 Action Plan card with tool calls and an optional Execute button.
 *
 * @param {Object} props - Component properties.
 * @param {Object} props.stage4Data - Stage 4 plan result (`{ success, action_plan, error }`).
 * @param {boolean} [props.showExecuteButton=false] - Whether to render the Execute Action Plan button.
 * @param {function(): void} [props.onExecuteActionPlan] - Callback to trigger plan execution.
 * @param {boolean} [props.disabled=false] - Whether the execute button is disabled.
 * @param {string} [props.className=""] - Optional extra CSS class on the outer block.
 * @param {boolean} [props.showToolCallsHeading=false] - Whether to show an h5 "Tool Calls" heading.
 * @returns {JSX.Element|null} Rendered action plan block.
 */
function ActionPlanBlock({
  stage4Data,
  showExecuteButton = false,
  onExecuteActionPlan,
  disabled = false,
  className = "",
  showToolCallsHeading = false,
}) {
  if (!stage4Data) return null;

  return (
    <div className={`action-plan-block ${className}`.trim()}>
      <h4>Action Plan</h4>
      {stage4Data.success || stage4Data.action_plan ? (
        <>
          <div className="plan-summary">
            <p>{stage4Data.action_plan?.description}</p>
            <p>{stage4Data.action_plan?.reasoning}</p>
          </div>
          <div className="tool-calls">
            {showToolCallsHeading && <h5>Tool Calls</h5>}
            {stage4Data.action_plan?.tool_calls?.map((call, idx) => (
              <div key={idx} className="tool-call">
                <div className="tool-call-header">
                  <strong>
                    {call.tool}{" "}
                    {call.server && call.server !== "local" && (
                      <span className="server-tag">({call.server})</span>
                    )}
                  </strong>
                  <span>{call.description}</span>
                </div>
                <FormattedParams params={call.params} />
              </div>
            ))}
          </div>

          {showExecuteButton && stage4Data.action_plan && (
            <div className="action-buttons">
              <button
                type="button"
                className="execute-action-btn"
                onClick={onExecuteActionPlan}
                disabled={disabled}
              >
                Execute Action Plan
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="action-error">
          <strong>Action plan failed:</strong> {stage4Data.error}
        </div>
      )}
    </div>
  );
}

/**
 * Renders tool execution results with status badge, parameters, and formatted output.
 *
 * @param {Object} props - Component properties.
 * @param {Object} props.execution - Execution result object (`{ success, action_plan, execution_results }`).
 * @param {string} [props.className=""] - Optional extra CSS class on the outer block.
 * @param {boolean} [props.showPlanSummary=false] - Whether to show the executed plan summary.
 * @returns {JSX.Element|null} Rendered execution results block.
 */
function ExecutionResultsBlock({
  execution,
  className = "",
  showPlanSummary = false,
}) {
  if (!execution) return null;

  return (
    <div className={`execution-block ${className}`.trim()}>
      <h4 className="execution-heading">
        <span>Execution Results</span>
        <span
          className={`execution-status-badge ${
            execution.success ? "success" : "failure"
          }`}
        >
          {execution.success ? "✅ Success" : "⚠️ Failed"}
        </span>
      </h4>
      {showPlanSummary && execution.action_plan && (
        <div className="plan-summary">
          <h5>Executed Plan</h5>
          <p>{execution.action_plan.description}</p>
          <p>{execution.action_plan.reasoning}</p>
        </div>
      )}
      {execution.execution_results?.results?.map((toolResult, idx) => {
        const hasNonEmptyParams =
          toolResult.params &&
          Object.values(toolResult.params).some(
            (val) => val !== null && val !== undefined && val !== "",
          );

        return (
          <div key={idx} className="tool-result">
            <div className="result-header">
              <strong>
                {toolResult.tool}
                {toolResult.server && toolResult.server !== "local" && (
                  <span className="server-tag">({toolResult.server})</span>
                )}
              </strong>
            </div>

            {hasNonEmptyParams && (
              <div className="output-section">
                <h5>Parameters</h5>
                <FormattedParams params={toolResult.params} />
              </div>
            )}

            <div className="result-output">
              {renderFormattedResult(toolResult.result)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Memoized individual message item (User or Assistant turn) in the chat feed.
 */
const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  actionRequestText,
  showAllDeliberationSteps,
  showTokenCount,
  showSpendValue,
  showTokensPerModel,
  showSavedTokens,
  onCancelAgent,
  onExecuteActionPlan,
  actionLoading,
}) {
  return (
    <div className="message-group">
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
                  showSavedTokens ? ` · Saved: ${(msg.token_usage?.tokens_saved || 0).toLocaleString()} tokens` : ""
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

          {msg.type === "workflow" ? (
            <WorkflowTimeline
              workflowName={msg.workflow_name}
              status={msg.status}
              nodes={msg.nodes}
              finalOutput={msg.final_output}
              tokenUsage={msg.token_usage}
              showTokenCount={showTokenCount}
              showSpendValue={showSpendValue}
            />
          ) : msg.type === "agent" || msg.steps ? (
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
                <ActionPlanBlock
                  stage4Data={msg.stage4}
                  showExecuteButton={!msg.execution}
                  onExecuteActionPlan={onExecuteActionPlan}
                  disabled={actionLoading || msg.loading?.execution}
                />
              )}

              {msg.loading?.execution && (
                <div className="stage-loading">
                  <div className="spinner"></div>
                  <span>Executing action plan...</span>
                </div>
              )}

              {msg.execution && (
                <ExecutionResultsBlock execution={msg.execution} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Main chat interface component.
 *
 * @param {Object} props - Component properties.
 * @param {Object|null} props.conversation - Active conversation object.
 * @param {string} [props.mode="informational"] - Active execution mode ("informational" | "one_shot" | "agentic" | "custom_workflows").
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
 * @param {boolean} [props.enableTokenCompression=false] - Whether prompt compression is enabled.
 * @param {Object|null} [props.activeWorkflow=null] - Currently selected custom workflow definition.
 * @param {function(): void} [props.onOpenWorkflowSelector=null] - Callback to open the Workflows Library modal.
 * @param {function(string): void} [props.onRunWorkflow=null] - Callback to execute the active custom workflow.
 * @param {boolean} [props.workflowLoading=false] - Whether a custom workflow is currently running.
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
  enableTokenCompression = false,
  activeWorkflow = null,
  onOpenWorkflowSelector = null,
  onRunWorkflow = null,
  workflowLoading = false,
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
  const [showTokenDetailsModal, setShowTokenDetailsModal] = useState(false);
  const [compressionStats, setCompressionStats] = useState(null);
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

  // Fetch cumulative compression statistics when token details modal is opened
  useEffect(() => {
    if (showTokenDetailsModal) {
      api
        .getCompressionStats()
        .then((res) => {
          if (res?.stats) setCompressionStats(res.stats);
        })
        .catch((err) => {
          console.warn("Failed to load compression stats:", err);
        });
    }
  }, [showTokenDetailsModal]);

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

  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [addServerPreset, setAddServerPreset] = useState("custom");
  const [addServerName, setAddServerName] = useState("");
  const [addServerCommand, setAddServerCommand] = useState("");
  const [addServerArgs, setAddServerArgs] = useState("");
  const [addServerEnv, setAddServerEnv] = useState("");
  const [addServerEnabled, setAddServerEnabled] = useState(true);
  const [addServerError, setAddServerError] = useState("");
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [serverToDelete, setServerToDelete] = useState(null);
  const [isDeletingServer, setIsDeletingServer] = useState(false);

  const handleSelectPreset = (presetId) => {
    setAddServerPreset(presetId);
    const preset = MCP_SERVER_PRESETS.find((p) => p.id === presetId);
    if (preset && preset.id !== "custom") {
      setAddServerName(preset.name);
      setAddServerCommand(preset.command);
      setAddServerArgs(preset.args);
      setAddServerEnv(preset.env);
    }
  };

  const handleResetAddServerForm = () => {
    setAddServerPreset("custom");
    setAddServerName("");
    setAddServerCommand("");
    setAddServerArgs("");
    setAddServerEnv("");
    setAddServerEnabled(true);
    setAddServerError("");
    setIsAddingServer(false);
  };

  const handleAddServerSubmit = async (e) => {
    if (e) e.preventDefault();
    setAddServerError("");

    const name = addServerName.trim();
    const command = addServerCommand.trim();

    if (!name) {
      setAddServerError("Server name is required.");
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      setAddServerError(
        "Server name can only contain letters, numbers, underscores, hyphens, and dots."
      );
      return;
    }
    if (!command) {
      setAddServerError("Executable command is required.");
      return;
    }

    let parsedArgs = [];
    try {
      parsedArgs = parseArgsString(addServerArgs);
    } catch (err) {
      setAddServerError("Failed to parse arguments: " + err.message);
      return;
    }

    let parsedEnv = null;
    try {
      parsedEnv = parseEnvString(addServerEnv);
    } catch (err) {
      setAddServerError("Failed to parse environment variables: " + err.message);
      return;
    }

    setIsAddingServer(true);
    try {
      const payload = {
        name,
        command,
        args: parsedArgs,
        env: parsedEnv,
        enabled: addServerEnabled,
      };
      const res = await api.addMcpServer(payload);
      if (res.success) {
        if (res.servers) setMcpServers(res.servers);
        if (res.tools) setMcpTools(res.tools);
        if (res.status) {
          setMcpStatuses((prev) => ({ ...prev, [name]: res.status }));
        }
        setSelectedServer(name);
        handleResetAddServerForm();
        setShowAddServerModal(false);
      }
    } catch (err) {
      console.error("Failed to add MCP server:", err);
      setAddServerError(err.message || "Failed to add MCP server");
    } finally {
      setIsAddingServer(false);
    }
  };

  const handleDeleteServerConfirm = async () => {
    if (!serverToDelete) return;
    setIsDeletingServer(true);
    try {
      const res = await api.deleteMcpServer(serverToDelete);
      if (res.success) {
        if (res.servers) setMcpServers(res.servers);
        if (res.tools) setMcpTools(res.tools);
        setMcpStatuses((prev) => {
          const next = { ...prev };
          delete next[serverToDelete];
          return next;
        });
        if (selectedServer === serverToDelete) {
          const remaining = (res.servers || []).filter(
            (s) => s.name !== serverToDelete
          );
          setSelectedServer(remaining.length > 0 ? remaining[0].name : null);
        }
        setServerToDelete(null);
      }
    } catch (err) {
      console.error("Failed to delete MCP server:", err);
      alert("Failed to delete MCP server: " + (err.message || String(err)));
    } finally {
      setIsDeletingServer(false);
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
  }, []);

  const messagesContainerRef = useRef(null);
  const isNearBottomRef = useRef(true);

  const handleMessagesScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
  };

  /**
   * Scroll the message feed container to the bottom.
   */
  const scrollToBottom = (behavior = "auto") => {
    if (messagesContainerRef.current) {
      if (behavior === "smooth") {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      } else {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
  };

  /**
   * Switch the execution mode across Informational, One Shot Execution, Agentic, and Custom Workflows.
   *
   * @param {string} newMode - "informational" | "one_shot" | "agentic" | "custom_workflows".
   */
  const handleSelectMode = (newMode) => {
    if (isLoading || actionLoading || agentLoading || workflowLoading) return;
    if (newMode === "informational") {
      setShowToolsList(false);
    }
    if (onModeChange) {
      onModeChange(newMode);
    }
    if (onToggleAgent)
      onToggleAgent(newMode === "agentic" || newMode === "action_mode");
    if (onToggleGenerateActionPlan)
      onToggleGenerateActionPlan(newMode === "one_shot");
  };

  useEffect(() => {
    if (currentMode === "informational") {
      setShowToolsList(false);
    }
  }, [currentMode]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom("auto");
    }
  }, [conversation]);

  /**
   * Form submission handler: dispatches to onRunWorkflow, onRunAgent, onGenerateActionPlan, or onSendMessage.
   *
   * @param {React.FormEvent} e - Form submission event.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || actionLoading || agentLoading || workflowLoading) return;

    if (currentMode === "custom_workflows") {
      if (onRunWorkflow) {
        onRunWorkflow(input);
      }
    } else if (isAgentic) {
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
                ? "⚡ One Shot Execution"
                : currentMode === "custom_workflows"
                  ? "🔀 Custom Workflows"
                  : "💬 Informational"}
          </span>
        </div>

        {showTokenCount && (
          <div className="chat-header-tokens">
            <div
              className="token-counter-widget"
              onClick={() => setShowTokenDetailsModal(true)}
              role="button"
              tabIndex={0}
              title={`Click to view full token metrics and compression savings\nTotal tokens: ${conversationTokens.total_tokens.toLocaleString()} (Input: ${conversationTokens.prompt_tokens.toLocaleString()}, Output: ${conversationTokens.completion_tokens.toLocaleString()})${
                conversationTokens.total_cost !== undefined ? ` · Est. Spend: ${formatExactSpend(conversationTokens.total_cost)}` : ""
              }${
                showSavedTokens ? ` · Saved: ${(conversationTokens.tokens_saved || 0).toLocaleString()} tokens` : ""
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
                {showSavedTokens && (
                  <span
                    className={`token-saved-pill ${(conversationTokens.tokens_saved || 0) === 0 ? "zero" : ""}`}
                    title={
                      (conversationTokens.tokens_saved || 0) > 0
                        ? `Tokens saved by compression: ${conversationTokens.tokens_saved.toLocaleString()}${
                            conversationTokens.total_cost_saved ? ` · Est. Saved: ${formatExactSpend(conversationTokens.total_cost_saved)}` : ""
                          }`
                        : enableTokenCompression
                          ? "Tokens saved: 0 (Headroom compression is active; prompt savings will appear here after model requests)"
                          : "Tokens saved: 0 (Token compression is disabled; enable it in Settings to compress prompts and save tokens)"
                    }
                  >
                    🌱 Saved: {formatShortNumber(conversationTokens.tokens_saved || 0)}
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
                      const mSaved = mData.tokens_saved || 0;
                      return (
                        <span
                          key={modelName}
                          className="token-model-chip"
                          title={`${modelName}: ${mTotal.toLocaleString()} tokens (Input: ${mPrompt.toLocaleString()} | Output: ${mComp.toLocaleString()})${
                            mCost !== undefined ? ` · Est. Spend: ${formatExactSpend(mCost)}` : ""
                          }${
                            showSavedTokens && mSaved > 0
                              ? ` · Saved: ${mSaved.toLocaleString()} tokens`
                              : ""
                          }`}
                        >
                          <span className="model-chip-name">{shortModel}</span>
                          <span className="model-chip-count">
                            {mTotal.toLocaleString()}
                            {showSpendValue && mCost !== undefined && (
                              <span className="model-chip-spend"> ({formatSpend(mCost)})</span>
                            )}
                            {showSavedTokens && mSaved > 0 && (
                              <span className="model-chip-saved">
                                {" "}· 🌱 {formatShortNumber(mSaved)}
                              </span>
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

      <div
        className="messages-container"
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
      >
        {!hasConversation ? (
          <div className="empty-state">
            <h2>Welcome to LLM Council</h2>
            <p>
              Choose Informational, One Shot Execution, Agentic, or Custom Workflows using the mode controls below
              to begin.
            </p>
          </div>
        ) : messages.length === 0 && !actionPanelActive ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>
              Choose Informational, One Shot Execution, Agentic, or Custom Workflows using the mode controls below
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
              <ChatMessageItem
                key={msg.id || `${msg.role}-${index}`}
                msg={msg}
                actionRequestText={actionRequestText}
                showAllDeliberationSteps={showAllDeliberationSteps}
                showTokenCount={showTokenCount}
                showSpendValue={showSpendValue}
                showTokensPerModel={showTokensPerModel}
                showSavedTokens={showSavedTokens}
                onCancelAgent={onCancelAgent}
                onExecuteActionPlan={onExecuteActionPlan}
                actionLoading={actionLoading}
              />
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
              <ActionPlanBlock
                stage4Data={actionPlanResult.stage4_action_plan}
                showExecuteButton={true}
                onExecuteActionPlan={onExecuteActionPlan}
                disabled={actionLoading}
                className="plan-details"
                showToolCallsHeading={true}
              />
            ) : actionPlanResult ? (
              <div className="plan-details">
                <h4>Action Plan Result</h4>
                <pre>{JSON.stringify(actionPlanResult, null, 2)}</pre>
              </div>
            ) : null}

            {actionExecutionResult && (
              <ExecutionResultsBlock
                execution={actionExecutionResult}
                className="execution-details"
                showPlanSummary={true}
              />
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
              <div className="mcp-tools-header-actions">
                <button
                  type="button"
                  className="mcp-header-add-btn"
                  onClick={() => {
                    handleResetAddServerForm();
                    setShowAddServerModal(true);
                  }}
                  title="Add new MCP Server"
                >
                  + Add Server
                </button>
                <button
                  type="button"
                  onClick={() => setShowToolsList(false)}
                  className="close-overlay-btn"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="mcp-modal-layout">
              <div className="mcp-modal-sidebar">
                <div className="mcp-sidebar-header-row">
                  <h5>Servers</h5>
                  <button
                    type="button"
                    className="mcp-sidebar-add-btn"
                    onClick={() => {
                      handleResetAddServerForm();
                      setShowAddServerModal(true);
                    }}
                    title="Add new MCP Server"
                  >
                    + Add
                  </button>
                </div>
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
                        <div className="mcp-panel-title-row">
                          <h5 className="mcp-panel-title">
                            Server: <span>{activeServer}</span>
                          </h5>
                          <button
                            type="button"
                            className="mcp-remove-server-btn"
                            title={`Remove server '${activeServer}'`}
                            onClick={() => setServerToDelete(activeServer)}
                          >
                            🗑️ Remove
                          </button>
                        </div>
                        {activeServerObj?.command && (
                          <code className="mcp-panel-cmd">
                            {activeServerObj.command} {activeServerObj.args?.join(" ")}
                          </code>
                        )}
                        {activeServerObj?.env && Object.keys(activeServerObj.env).length > 0 && (
                          <div className="mcp-panel-env-row">
                            <span className="mcp-panel-env-label">Env:</span>
                            <span className="mcp-panel-env-keys">
                              {Object.keys(activeServerObj.env).join(", ")}
                            </span>
                          </div>
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

            {/* Add MCP Server Modal Dialog */}
            {showAddServerModal && (
              <div
                className="mcp-add-modal-backdrop"
                onClick={() => !isAddingServer && setShowAddServerModal(false)}
              >
                <div
                  className="mcp-add-modal-dialog"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mcp-add-modal-header">
                    <h4>Add MCP Server</h4>
                    <button
                      type="button"
                      className="close-overlay-btn"
                      onClick={() => !isAddingServer && setShowAddServerModal(false)}
                      disabled={isAddingServer}
                    >
                      ×
                    </button>
                  </div>

                  <form onSubmit={handleAddServerSubmit} className="mcp-add-form">
                    {addServerError && (
                      <div className="mcp-add-error-banner">
                        <span className="error-icon">⚠️</span>
                        <span>{addServerError}</span>
                      </div>
                    )}

                    <div className="mcp-form-group">
                      <label htmlFor="mcp-preset-select">Preset Template</label>
                      <select
                        id="mcp-preset-select"
                        className="mcp-input"
                        value={addServerPreset}
                        onChange={(e) => handleSelectPreset(e.target.value)}
                        disabled={isAddingServer}
                      >
                        {MCP_SERVER_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <span className="mcp-field-hint">
                        Select a preconfigured server or customize below.
                      </span>
                    </div>

                    <div className="mcp-form-group">
                      <label htmlFor="mcp-server-name">
                        Server Name <span className="required-star">*</span>
                      </label>
                      <input
                        id="mcp-server-name"
                        type="text"
                        className="mcp-input"
                        placeholder="e.g. filesystem, memory, sqlite"
                        value={addServerName}
                        onChange={(e) => setAddServerName(e.target.value)}
                        disabled={isAddingServer}
                        required
                      />
                      <span className="mcp-field-hint">
                        Unique identifier (letters, numbers, hyphens, underscores, dots).
                      </span>
                    </div>

                    <div className="mcp-form-group">
                      <label htmlFor="mcp-server-command">
                        Executable Command <span className="required-star">*</span>
                      </label>
                      <input
                        id="mcp-server-command"
                        type="text"
                        className="mcp-input"
                        placeholder="e.g. npx, uvx, python, node, /path/to/binary"
                        value={addServerCommand}
                        onChange={(e) => setAddServerCommand(e.target.value)}
                        disabled={isAddingServer}
                        required
                      />
                      <span className="mcp-field-hint">
                        Executable name on system PATH or runner command.
                      </span>
                    </div>

                    <div className="mcp-form-group">
                      <label htmlFor="mcp-server-args">Command Arguments</label>
                      <input
                        id="mcp-server-args"
                        type="text"
                        className="mcp-input"
                        placeholder='e.g. -y @modelcontextprotocol/server-memory or ["arg1", "arg2"]'
                        value={addServerArgs}
                        onChange={(e) => setAddServerArgs(e.target.value)}
                        disabled={isAddingServer}
                      />
                      <span className="mcp-field-hint">
                        Arguments separated by spaces (quotes supported) or JSON array.
                      </span>
                    </div>

                    <div className="mcp-form-group">
                      <label htmlFor="mcp-server-env">Environment Variables (Optional)</label>
                      <textarea
                        id="mcp-server-env"
                        className="mcp-textarea"
                        rows={2}
                        placeholder={"KEY=VALUE\nANOTHER_KEY=VALUE\nor {\"KEY\": \"VALUE\"}"}
                        value={addServerEnv}
                        onChange={(e) => setAddServerEnv(e.target.value)}
                        disabled={isAddingServer}
                      />
                      <span className="mcp-field-hint">
                        One KEY=VALUE per line or JSON key-value map.
                      </span>
                    </div>

                    <div className="mcp-form-checkbox-group">
                      <label className="mcp-checkbox-label">
                        <input
                          type="checkbox"
                          checked={addServerEnabled}
                          onChange={(e) => setAddServerEnabled(e.target.checked)}
                          disabled={isAddingServer}
                        />
                        <span>Start and connect server immediately</span>
                      </label>
                    </div>

                    <div className="mcp-add-modal-footer">
                      <button
                        type="button"
                        className="mcp-cancel-btn"
                        onClick={() => setShowAddServerModal(false)}
                        disabled={isAddingServer}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="mcp-submit-btn"
                        disabled={isAddingServer}
                      >
                        {isAddingServer ? "Connecting..." : "Add Server"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Delete MCP Server Confirmation Modal */}
            {serverToDelete && (
              <div
                className="mcp-confirm-modal-backdrop"
                onClick={() => !isDeletingServer && setServerToDelete(null)}
              >
                <div
                  className="mcp-confirm-modal-dialog"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mcp-confirm-modal-header">
                    <h4>Remove MCP Server</h4>
                    <button
                      type="button"
                      className="close-overlay-btn"
                      onClick={() => !isDeletingServer && setServerToDelete(null)}
                      disabled={isDeletingServer}
                    >
                      ×
                    </button>
                  </div>
                  <div className="mcp-confirm-modal-body">
                    <p>
                      Are you sure you want to remove MCP server <strong>{serverToDelete}</strong>?
                    </p>
                    <p className="mcp-confirm-modal-subtext">
                      This will terminate its running process and delete it from <code>mcp_servers.json</code>.
                    </p>
                  </div>
                  <div className="mcp-confirm-modal-footer">
                    <button
                      type="button"
                      className="mcp-cancel-btn"
                      onClick={() => setServerToDelete(null)}
                      disabled={isDeletingServer}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mcp-delete-confirm-btn"
                      onClick={handleDeleteServerConfirm}
                      disabled={isDeletingServer}
                    >
                      {isDeletingServer ? "Removing..." : "Remove Server"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="mode-controls-container">
          <div className="mode-controls-bar">
            <div className="mode-dropdown-group">
              <label htmlFor="execution-mode-select" className="mode-dropdown-label">
                Execution Mode
              </label>
              <div className="mode-select-wrapper">
                <select
                  id="execution-mode-select"
                  className="mode-dropdown-select"
                  value={
                    currentMode === "custom_workflows"
                      ? "custom_workflows"
                      : isAgentic
                        ? "agentic"
                        : currentMode === "one_shot"
                          ? "one_shot"
                          : "informational"
                  }
                  onChange={(e) => {
                    const selected = e.target.value;
                    if (selected) {
                      handleSelectMode(selected);
                    }
                  }}
                  disabled={isLoading || actionLoading || agentLoading || workflowLoading}
                  aria-label="Execution Mode Selection"
                >
                  <option value="informational">💬 Informational</option>
                  <option value="one_shot">⚡ One Shot Execution</option>
                  <option value="agentic">🤖 Agentic</option>
                  <option value="custom_workflows">🔀 Custom Workflows</option>
                </select>
                <span className="mode-select-chevron" aria-hidden="true">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>
            </div>

            {currentMode === "custom_workflows" && (
              <div className="mode-workflows-library-group">
                <button
                  type="button"
                  className="workflows-library-btn"
                  onClick={onOpenWorkflowSelector}
                  disabled={isLoading || actionLoading || agentLoading || workflowLoading}
                  title="Browse and select workflows from the library"
                >
                  <span className="workflows-library-btn-icon">📚</span>
                  <span className="workflows-library-btn-text">Workflows Library</span>
                </button>
              </div>
            )}

            {isAgentic && (
              <div className="mode-agent-settings-group">
                <button
                  type="button"
                  className="agent-settings-btn"
                  onClick={() => setShowSensitivityModal(true)}
                  disabled={isLoading || actionLoading || agentLoading || workflowLoading}
                  title="Agentic Loop & Council Settings"
                  aria-label="Open Agentic Loop & Council Settings"
                >
                  <span className="agent-settings-btn-icon">🧠</span>
                  <span className="agent-settings-btn-text">Agentic Settings</span>
                </button>
              </div>
            )}
          </div>

          <div className="mode-controls-hint">
            {currentMode === "informational" &&
              "Standard council deliberation & synthesis (Stage 1-3)"}
            {currentMode === "one_shot" &&
              "Generate & execute action plan with one shot execution, compatible with MCP (Stage 1-4)"}
            {isAgentic &&
              "Autonomous Chairperson ReAct loop with multi-step tool execution"}
            {currentMode === "custom_workflows" &&
              `Active graph pipeline: ${activeWorkflow?.name || "Sequential Chain Refinement"}`}
          </div>
        </div>


        <div className="input-row">
          <textarea
            className="message-input"
            placeholder={
              currentMode === "custom_workflows"
                ? `Enter input for "${activeWorkflow?.name || "Custom Workflow"}" pipeline... (Shift+Enter for new line, Enter to send)`
                : isAgentic
                  ? "Describe the goal for the Council Chairperson Agent (e.g. write code, generate documentation, run tests)..."
                  : currentMode === "one_shot"
                    ? "Describe a task to plan and execute with MCP tools (Shift+Enter for new line, Enter to send)..."
                    : "Ask your question... (Shift+Enter for new line, Enter to send)"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || actionLoading || agentLoading || workflowLoading}
            rows={3}
          />

          <div
            className={`input-actions ${currentMode === "informational" ? "mode-informational" : ""}`}
          >
            {currentMode !== "informational" && (
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
            )}

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
                <button
                  type="submit"
                  className="send-button"
                  disabled={
                    !input.trim() || isLoading || actionLoading || agentLoading || workflowLoading
                  }
                >
                  {currentMode === "custom_workflows"
                    ? workflowLoading
                      ? "Running..."
                      : "Run Workflow"
                    : isAgentic
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

      {/* Token Details & Compression Savings Modal */}
      {showTokenDetailsModal && (
        <div
          className="token-details-modal-backdrop"
          onClick={() => setShowTokenDetailsModal(false)}
        >
          <div
            className="token-details-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="token-details-header">
              <h4>
                <span>🪙 Token Usage & Savings</span>
                <span className="token-details-conv-title">
                  {conversation?.title || "Conversation"}
                </span>
              </h4>
              <button
                type="button"
                className="close-overlay-btn"
                onClick={() => setShowTokenDetailsModal(false)}
              >
                ×
              </button>
            </div>

            <div className="token-details-body">
              {/* Stat Cards Grid */}
              <div className="token-details-cards-grid">
                <div className="token-metric-card">
                  <span className="metric-card-label">Total Tokens Spent</span>
                  <span className="metric-card-value">
                    {conversationTokens.total_tokens.toLocaleString()}
                  </span>
                  <span className="metric-card-subtext">
                    Input: {(conversationTokens.prompt_tokens || 0).toLocaleString()} · Output: {(conversationTokens.completion_tokens || 0).toLocaleString()}
                  </span>
                </div>

                <div className="token-metric-card">
                  <span className="metric-card-label">Estimated Spend</span>
                  <span className="metric-card-value cost">
                    {formatSpend(conversationTokens.total_cost || 0)}
                  </span>
                  <span className="metric-card-subtext">
                    {formatExactSpend(conversationTokens.total_cost || 0)} USD
                  </span>
                </div>

                <div className="token-metric-card highlight-saved">
                  <span className="metric-card-label">Tokens Saved (This Conv)</span>
                  <span className="metric-card-value saved">
                    🌱 {(conversationTokens.tokens_saved || 0).toLocaleString()}
                  </span>
                  <span className="metric-card-subtext">
                    {conversationTokens.total_cost_saved > 0
                      ? `Est. Saved: ${formatExactSpend(conversationTokens.total_cost_saved)} USD`
                      : enableTokenCompression
                        ? "Headroom compression active"
                        : "Compression is disabled in Settings"}
                  </span>
                </div>

                <div className="token-metric-card">
                  <span className="metric-card-label">Compression Engine</span>
                  <span className="metric-card-value status">
                    {enableTokenCompression ? "Active ⚡" : "Disabled 🔒"}
                  </span>
                  <span className="metric-card-subtext">
                    {enableTokenCompression
                      ? "Optimizing prompts via Headroom Labs"
                      : "Enable in Settings > Display & Appearance"}
                  </span>
                </div>
              </div>

              {/* Model Breakdown Section */}
              {hasModelBreakdown && (
                <div className="token-details-section">
                  <h5>Tokens by Model (Deliberation Breakdown)</h5>
                  <div className="token-details-table-wrapper">
                    <table className="token-details-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Prompt</th>
                          <th>Completion</th>
                          <th>Total</th>
                          {showSavedTokens && <th>Tokens Saved</th>}
                          {showSpendValue && <th>Cost</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(conversationTokens.by_model).map(([modelId, mData]) => (
                          <tr key={modelId}>
                            <td className="model-id-cell">{modelId}</td>
                            <td>{(mData.prompt_tokens || 0).toLocaleString()}</td>
                            <td>{(mData.completion_tokens || 0).toLocaleString()}</td>
                            <td className="total-cell">{(mData.total_tokens || 0).toLocaleString()}</td>
                            {showSavedTokens && (
                              <td className="saved-cell">
                                {(mData.tokens_saved || 0) > 0 ? (
                                  <span className="saved-green">
                                    🌱 {(mData.tokens_saved || 0).toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="saved-zero">0</span>
                                )}
                              </td>
                            )}
                            {showSpendValue && (
                              <td className="cost-cell">
                                {formatSpend(mData.cost || 0)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Global Session Compression Analytics */}
              <div className="token-details-section">
                <div className="section-title-with-badge">
                  <h5>Global Headroom Analytics (All Conversations)</h5>
                  {compressionStats?.headroom_available ? (
                    <span className="analytics-badge headroom">Headroom AI Active</span>
                  ) : (
                    <span className="analytics-badge fallback">Fallback Heuristics</span>
                  )}
                </div>
                <div className="global-stats-row">
                  <div className="global-stat-box">
                    <span className="global-stat-number">
                      {(compressionStats?.tokens_saved || 0).toLocaleString()}
                    </span>
                    <span className="global-stat-title">Total Tokens Saved</span>
                  </div>
                  <div className="global-stat-box">
                    <span className="global-stat-number green">
                      {formatSpend(compressionStats?.estimated_dollars_saved || 0)}
                    </span>
                    <span className="global-stat-title">Total Dollars Saved</span>
                  </div>
                  <div className="global-stat-box">
                    <span className="global-stat-number">
                      {((compressionStats?.compression_ratio || 0) * 100).toFixed(1)}%
                    </span>
                    <span className="global-stat-title">Average Reduction</span>
                  </div>
                  <div className="global-stat-box">
                    <span className="global-stat-number">
                      {compressionStats?.total_queries || 0}
                    </span>
                    <span className="global-stat-title">Queries Processed</span>
                  </div>
                </div>
              </div>

              {/* Where do tokens saved stats show up Guide */}
              <div className="token-guide-box">
                <div className="token-guide-header">
                  <span className="guide-icon">💡</span>
                  <strong>Where do tokens saved stats show up?</strong>
                </div>
                <ul className="token-guide-list">
                  <li>
                    <strong>Chat Header (Top-Right):</strong> The green <code>🌱 Saved: X</code> badge displays conversation-level prompt tokens avoided and dollars saved.
                  </li>
                  <li>
                    <strong>Assistant Messages:</strong> Each council or agent turn displays a <code>🌱 Saved X</code> pill beside the turn token count.
                  </li>
                  <li>
                    <strong>Conversation Sidebar:</strong> Conversation history items display a <code>🌱 X</code> count next to the message count.
                  </li>
                  <li>
                    <strong>Settings Modal:</strong> In <em>Display & Appearance</em> under <em>Conversation Token Counter</em> and the <em>Global Session Compression Savings</em> card.
                  </li>
                </ul>
              </div>
            </div>

            <div className="token-details-footer">
              <button
                type="button"
                className="close-details-btn"
                onClick={() => setShowTokenDetailsModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
