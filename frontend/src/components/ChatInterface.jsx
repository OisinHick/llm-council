import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import Stage1 from "./Stage1";
import Stage2 from "./Stage2";
import Stage3 from "./Stage3";
import { api } from "../api";
import "./ChatInterface.css";

const tryParseJSON = (str) => {
  if (typeof str !== "string") return null;
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (e) {
    // Not JSON
  }
  return null;
};

const renderFormattedResult = (result) => {
  if (!result) return null;

  let stdout = result.stdout || "";
  let stderr = result.stderr || "";
  let content = result.content || "";
  let message = result.message || "";
  let response = result.response || "";
  let error = result.error || "";
  let metadata = {};

  // Try parsing content
  const parsedContent = tryParseJSON(content);
  if (parsedContent) {
    if (parsedContent.stdout) stdout = parsedContent.stdout;
    if (parsedContent.stderr) stderr = parsedContent.stderr;
    if (parsedContent.message) message = parsedContent.message;
    if (parsedContent.error) error = parsedContent.error;
    
    Object.keys(parsedContent).forEach((key) => {
      if (!["stdout", "stderr", "message", "error", "content"].includes(key)) {
        metadata[key] = parsedContent[key];
      }
    });
    content = "";
  }

  // Try parsing response
  const parsedResponse = tryParseJSON(response);
  if (parsedResponse) {
    if (parsedResponse.stdout) stdout = parsedResponse.stdout;
    if (parsedResponse.stderr) stderr = parsedResponse.stderr;
    if (parsedResponse.message) message = parsedResponse.message;
    if (parsedResponse.error) error = parsedResponse.error;
    
    Object.keys(parsedResponse).forEach((key) => {
      if (!["stdout", "stderr", "message", "error", "response"].includes(key)) {
        metadata[key] = parsedResponse[key];
      }
    });
    response = "";
  } else if (response && typeof response === "object") {
    if (response.stdout) stdout = response.stdout;
    if (response.stderr) stderr = response.stderr;
    if (response.message) message = response.message;
    if (response.error) error = response.error;
    
    Object.keys(response).forEach((key) => {
      if (!["stdout", "stderr", "message", "error"].includes(key)) {
        metadata[key] = response[key];
      }
    });
    response = "";
  }

  // Top level fields
  Object.keys(result).forEach((key) => {
    if (!["stdout", "stderr", "message", "error", "content", "response", "success"].includes(key)) {
      metadata[key] = result[key];
    }
  });

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
            {typeof content === "object" ? JSON.stringify(content, null, 2) : String(content)}
          </pre>
        </div>
      )}

      {response && (
        <div className="output-section result-response-box">
          <h5>Response</h5>
          <pre className="response-pre">
            {typeof response === "object" ? JSON.stringify(response, null, 2) : String(response)}
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
                    {typeof val === "object" ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      
      {!stdout && !stderr && !content && !response && !message && !error && Object.keys(metadata).length === 0 && (
        <div className="output-section">
          <h5>Result</h5>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default function ChatInterface({
  conversation,
  generateActionPlanToggle,
  onSendMessage,
  onGenerateActionPlan,
  onExecuteActionPlan,
  onToggleGenerateActionPlan,
  actionPlanResult,
  actionExecutionResult,
  actionStageResults,
  actionStageLoading,
  actionLoading,
  actionError,
  actionPlanRequest,
  isLoading,
}) {
  const [input, setInput] = useState("");
  const [generateActionPlan, setGenerateActionPlan] = useState(false);
  const [mcpTools, setMcpTools] = useState([]);
  const [showToolsList, setShowToolsList] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const fetchTools = async () => {
      try {
        const res = await api.getMcpTools();
        if (res.success) {
          setMcpTools(res.tools || []);
        }
      } catch (err) {
        console.error("Error loading MCP tools:", err);
      }
    };
    fetchTools();
  }, [actionLoading, isLoading]);


  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Sync toggle state with prop
  useEffect(() => {
    setGenerateActionPlan(generateActionPlanToggle);
  }, [generateActionPlanToggle]);

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || actionLoading) return;

    if (generateActionPlan) {
      onGenerateActionPlan(input);
    } else {
      onSendMessage(input);
    }

    setInput("");
  };

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

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {!hasConversation ? (
          <div className="empty-state">
            <h2>Welcome to LLM Council</h2>
            <p>Create a new conversation to get started</p>
          </div>
        ) : messages.length === 0 && !actionPanelActive ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === "user" ? (
                <div className="user-message">
                  <div className="message-label">You</div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM Council</div>

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

                  {msg.action_request && (
                    <div className="action-request-block">
                      <h4>Action Request</h4>
                      <div className="markdown-content">
                        <ReactMarkdown>{msg.action_request}</ReactMarkdown>
                      </div>
                    </div>
                  )}

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
                            <h4>Action Plan Summary</h4>
                            <p>{msg.stage4.action_plan?.description}</p>
                            <p>{msg.stage4.action_plan?.reasoning}</p>
                          </div>
                          <div className="tool-calls">
                            {msg.stage4.action_plan?.tool_calls?.map(
                              (call, idx) => (
                                <div key={idx} className="tool-call">
                                  <div className="tool-call-header">
                                    <strong>{call.tool} {call.server && call.server !== 'local' && <span className="server-tag">({call.server})</span>}</strong>
                                    <span>{call.description}</span>
                                  </div>
                                  {call.params && Object.values(call.params).some(val => val !== null && val !== undefined && val !== "") && (
                                    <div className="formatted-params">
                                      {Object.entries(call.params)
                                        .filter(([_, value]) => value !== null && value !== undefined && value !== "")
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
                      <h4>Execution Results</h4>
                      {msg.execution.success ? (
                        <p className="execution-success">
                          ✅ Execution succeeded
                        </p>
                      ) : (
                        <p className="execution-failure">⚠️ Execution failed</p>
                      )}
                      {msg.execution.execution_results?.results?.map(
                        (toolResult, idx) => (
                          <div key={idx} className="tool-result">
                            <div className="result-header">
                              <strong>
                                {toolResult.tool}
                                {toolResult.server && toolResult.server !== "local" && (
                                  <span className="server-tag">({toolResult.server})</span>
                                )}
                              </strong>
                              <span className={toolResult.result.success ? "execution-success" : "execution-failure"}>
                                {toolResult.result.success ? "✓ Success" : "✗ Failure"}
                              </span>
                            </div>

                            {toolResult.params && Object.keys(toolResult.params).filter(key => toolResult.params[key] !== null && toolResult.params[key] !== undefined && toolResult.params[key] !== "").length > 0 && (
                              <div className="output-section">
                                <h5>Parameters</h5>
                                <div className="formatted-params">
                                  {Object.entries(toolResult.params)
                                    .filter(([_, value]) => value !== null && value !== undefined && value !== "")
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
            </div>
          ))
        )}

        {(isLoading || actionLoading) && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        {showActionPanel && (
          <div className="action-panel">
            <div className="action-panel-header">
              <h3>Action Plan</h3>
              {actionPlanRequest && (
                <p className="action-request">Request: {actionPlanRequest}</p>
              )}
            </div>

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

            {actionStageLoading.stage4 && (
              <div className="stage-loading">
                <div className="spinner"></div>
                <span>Generating action plan...</span>
              </div>
            )}

            {actionPlanResult?.stage4_action_plan ? (
              <div className="plan-details">
                {actionPlanResult.stage4_action_plan.success ||
                actionPlanResult.stage4_action_plan.action_plan ? (
                  <>
                    <div className="plan-summary">
                      <h4>Action Plan Summary</h4>
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
                              <strong>{call.tool} {call.server && call.server !== 'local' && <span className="server-tag">({call.server})</span>}</strong>
                              <span>{call.description}</span>
                            </div>
                            {call.params && Object.values(call.params).some(val => val !== null && val !== undefined && val !== "") && (
                              <div className="formatted-params">
                                {Object.entries(call.params)
                                  .filter(([_, value]) => value !== null && value !== undefined && value !== "")
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
              <div className="execution-details">
                <h4>Execution Results</h4>
                <p
                  className={
                    actionExecutionResult.success
                      ? "execution-success"
                      : "execution-failure"
                  }
                >
                  {actionExecutionResult.success
                    ? "✅ Execution succeeded"
                    : "⚠️ Execution failed"}
                </p>
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
                          {toolResult.server && toolResult.server !== "local" && (
                            <span className="server-tag">({toolResult.server})</span>
                          )}
                        </strong>
                        <span className={toolResult.result.success ? "execution-success" : "execution-failure"}>
                          {toolResult.result.success ? "✓ Success" : "✗ Failure"}
                        </span>
                      </div>

                      {toolResult.params && Object.keys(toolResult.params).filter(key => toolResult.params[key] !== null && toolResult.params[key] !== undefined && toolResult.params[key] !== "").length > 0 && (
                        <div className="output-section">
                          <h5>Parameters</h5>
                          <div className="formatted-params">
                            {Object.entries(toolResult.params)
                              .filter(([_, value]) => value !== null && value !== undefined && value !== "")
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
        <div className="mcp-tools-modal-backdrop" onClick={() => setShowToolsList(false)}>
          <div className="mcp-tools-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="mcp-tools-header">
              <h4>Active MCP Tools ({mcpTools.length})</h4>
              <button
                type="button"
                onClick={() => setShowToolsList(false)}
                className="close-overlay-btn"
              >
                ×
              </button>
            </div>
            <div className="mcp-tools-list">
              {mcpTools.length === 0 ? (
                <p className="no-tools-text">
                  No external MCP tools active. Configured tools in mcp_servers.json will appear here.
                </p>
              ) : (
                mcpTools.map((tool, index) => (
                  <div key={index} className="mcp-tool-item">
                    <div className="mcp-tool-meta">
                      <span className="mcp-tool-server-badge">{tool.server}</span>
                      <strong className="mcp-tool-name">{tool.name}</strong>
                    </div>
                    <p className="mcp-tool-desc">{tool.description}</p>
                    {tool.input_schema && (
                      <details className="mcp-schema-details">
                        <summary className="mcp-schema-summary">
                          <span>Input Schema</span>
                          <span className="expand-icon">▼</span>
                        </summary>
                        <pre className="mcp-tool-schema">
                          {JSON.stringify(tool.input_schema, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="input-row">
          <textarea
            className="message-input"
            placeholder="Ask your question... (Shift+Enter for new line, Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || actionLoading}
            rows={3}
          />

          <div className="input-actions">
            <div
              className="mcp-status"
              onClick={() => setShowToolsList(!showToolsList)}
              title="Click to view all active MCP tools"
            >
              <span
                className={`status-dot ${mcpTools.length > 0 ? "connected" : ""}`}
              ></span>
              <span>
                {mcpTools.length} Active MCP{" "}
                {mcpTools.length === 1 ? "Tool" : "Tools"}
              </span>
            </div>

            <div className="generate-toggle">
              <button
                type="button"
                className={`circular-toggle ${generateActionPlan ? "active" : ""}`}
                onClick={() => {
                  const newState = !generateActionPlan;
                  setGenerateActionPlan(newState);
                  if (onToggleGenerateActionPlan) {
                    onToggleGenerateActionPlan(newState);
                  }
                }}
                disabled={isLoading || actionLoading}
                title={
                  generateActionPlan
                    ? "Disable action plan generation"
                    : "Enable action plan generation"
                }
              />
              Generate Action Plan
            </div>

            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || isLoading || actionLoading}
            >
              {generateActionPlan ? "Generate Plan" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
