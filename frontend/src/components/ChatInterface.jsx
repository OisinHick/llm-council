import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import './ChatInterface.css';

export default function ChatInterface({
  conversation,
  onSendMessage,
  onGenerateActionPlan,
  onExecuteActionPlan,
  actionPlanResult,
  actionExecutionResult,
  actionStageResults,
  actionStageLoading,
  actionLoading,
  actionError,
  actionPlanRequest,
  isLoading,
}) {
  const [input, setInput] = useState('');
  const [generateActionPlan, setGenerateActionPlan] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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

    setInput('');
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const hasConversation = Boolean(conversation);
  const messages = conversation?.messages || [];
  const hasActionMessage = messages.some(
    (msg) => msg.role === 'assistant' && (msg.action_request || msg.stage4 || msg.execution)
  );
  const actionPanelActive = actionLoading || actionError || actionPlanResult || actionExecutionResult || Object.values(actionStageLoading).some(Boolean);
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
              {msg.role === 'user' ? (
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
                      <span>Running Stage 1: Collecting individual responses...</span>
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
                      {(msg.stage4.success || msg.stage4.action_plan) ? (
                        <>
                          <div className="plan-summary">
                            <h4>Action Plan Summary</h4>
                            <p>{msg.stage4.action_plan?.description}</p>
                            <p>{msg.stage4.action_plan?.reasoning}</p>
                          </div>
                          <div className="tool-calls">
                            {msg.stage4.action_plan?.tool_calls?.map((call, idx) => (
                              <div key={idx} className="tool-call">
                                <div className="tool-call-header">
                                  <strong>{call.tool}</strong>
                                  <span>{call.description}</span>
                                </div>
                                <pre>{JSON.stringify(call.params, null, 2)}</pre>
                              </div>
                            ))}
                          </div>

                          {!msg.execution && msg.stage4.action_plan && (
                            <div className="action-buttons">
                              <button
                                type="button"
                                className="execute-action-btn"
                                onClick={onExecuteActionPlan}
                                disabled={actionLoading || msg.loading?.execution}
                              >
                                Execute Action Plan
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="action-error">
                          <strong>Action plan failed:</strong> {msg.stage4.error}
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
                        <p className="execution-success">✅ Execution succeeded</p>
                      ) : (
                        <p className="execution-failure">⚠️ Execution failed</p>
                      )}
                      {msg.execution.execution_results?.results?.map((toolResult, idx) => (
                        <div key={idx} className="tool-result">
                          <div className="result-header">
                            <strong>{toolResult.tool}</strong>
                            <span>{toolResult.result.success ? 'Success' : 'Failure'}</span>
                          </div>
                          <div className="result-output">
                            {toolResult.result.success ? (
                              <>
                                {toolResult.result.stdout && (
                                  <div className="output-section">
                                    <h5>Output</h5>
                                    <pre>{toolResult.result.stdout}</pre>
                                  </div>
                                )}
                                {toolResult.result.message && (
                                  <div className="output-section">
                                    <p>{toolResult.result.message}</p>
                                  </div>
                                )}
                                {toolResult.result.response && (
                                  <div className="output-section">
                                    <h5>Response</h5>
                                    <pre>{JSON.stringify(toolResult.result.response, null, 2)}</pre>
                                  </div>
                                )}
                                {!toolResult.result.stdout && !toolResult.result.message && !toolResult.result.response && (
                                  <pre>{JSON.stringify(toolResult.result, null, 2)}</pre>
                                )}
                              </>
                            ) : (
                              <div className="error-output">
                                {toolResult.result.error && <p>{toolResult.result.error}</p>}
                                {toolResult.result.stderr ? (
                                  <pre>{toolResult.result.stderr}</pre>
                                ) : (
                                  <pre>{JSON.stringify(toolResult.result, null, 2)}</pre>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        {showActionPanel && (
          <div className="action-panel">
            <div className="action-panel-header">
              <h3>Action Plan</h3>
              {actionPlanRequest && <p className="action-request">Request: {actionPlanRequest}</p>}
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
                    aggregateRankings={actionStageResults.metadata?.aggregate_rankings}
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
                {(actionPlanResult.stage4_action_plan.success || actionPlanResult.stage4_action_plan.action_plan) ? (
                  <>
                    <div className="plan-summary">
                      <h4>Action Plan Summary</h4>
                      <p>{actionPlanResult.stage4_action_plan.action_plan?.description}</p>
                      <p>{actionPlanResult.stage4_action_plan.action_plan?.reasoning}</p>
                    </div>

                    <div className="tool-calls">
                      <h5>Tool Calls</h5>
                      {actionPlanResult.stage4_action_plan.action_plan?.tool_calls?.map((call, idx) => (
                        <div key={idx} className="tool-call">
                          <div className="tool-call-header">
                            <strong>{call.tool}</strong>
                            <span>{call.description}</span>
                          </div>
                          <pre>{JSON.stringify(call.params, null, 2)}</pre>
                        </div>
                      ))}
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
                    <strong>Action plan failed:</strong> {actionPlanResult.stage4_action_plan.error}
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
                <p className={actionExecutionResult.success ? 'execution-success' : 'execution-failure'}>
                  {actionExecutionResult.success ? '✅ Execution succeeded' : '⚠️ Execution failed'}
                </p>
                {actionExecutionResult.action_plan && (
                  <div className="plan-summary">
                    <h5>Executed Plan</h5>
                    <p>{actionExecutionResult.action_plan.description}</p>
                    <p>{actionExecutionResult.action_plan.reasoning}</p>
                  </div>
                )}
                {actionExecutionResult.execution_results?.results?.map((toolResult, idx) => (
                  <div key={idx} className="tool-result">
                    <div className="result-header">
                      <strong>{toolResult.tool}</strong>
                      <span>{toolResult.result.success ? 'Success' : 'Failure'}</span>
                    </div>
                    <div className="result-output">
                      {toolResult.result.success ? (
                        <>
                          {toolResult.result.stdout && (
                            <div className="output-section">
                              <h5>Output</h5>
                              <pre>{toolResult.result.stdout}</pre>
                            </div>
                          )}
                          {toolResult.result.message && (
                            <div className="output-section">
                              <p>{toolResult.result.message}</p>
                            </div>
                          )}
                          {toolResult.result.response && (
                            <div className="output-section">
                              <h5>Response</h5>
                              <pre>{JSON.stringify(toolResult.result.response, null, 2)}</pre>
                            </div>
                          )}
                          {!toolResult.result.stdout && !toolResult.result.message && !toolResult.result.response && (
                            <pre>{JSON.stringify(toolResult.result, null, 2)}</pre>
                          )}
                        </>
                      ) : (
                        <div className="error-output">
                          {toolResult.result.error && <p>{toolResult.result.error}</p>}
                          {toolResult.result.stderr ? (
                            <pre>{toolResult.result.stderr}</pre>
                          ) : (
                            <pre>{JSON.stringify(toolResult.result, null, 2)}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

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
            <label className="generate-toggle">
              <input
                type="checkbox"
                checked={generateActionPlan}
                onChange={(e) => setGenerateActionPlan(e.target.checked)}
                disabled={isLoading || actionLoading}
              />
              Generate Action Plan
            </label>

            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || isLoading || actionLoading}
            >
              {generateActionPlan ? 'Generate Plan' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
