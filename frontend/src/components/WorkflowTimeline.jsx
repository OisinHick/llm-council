/**
 * WorkflowTimeline Component.
 *
 * Renders the live and historical execution of a Custom Workflow DAG:
 * - Workflow title, execution status badge, and token usage summary.
 * - Mini visual flow diagram indicating node execution states (Pending, Running, Completed, Failed).
 * - Step accordion cards showing each model queried, prompt template evaluated, and generated output.
 * - Final output box formatted in markdown.
 */

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatSpend, formatShortNumber } from "../formatters";
import "./WorkflowTimeline.css";

/**
 * Workflow Timeline component.
 *
 * @param {Object} props - Component properties.
 * @param {string} props.workflowName - Display name of the workflow.
 * @param {string} props.status - "running" | "completed" | "failed".
 * @param {Array<Object>} props.nodes - Executed node records.
 * @param {string} props.finalOutput - Consolidated final response text.
 * @param {Object} [props.tokenUsage] - Token accounting metrics.
 * @param {boolean} [props.showTokenCount=true] - Display token counts toggle.
 * @param {boolean} [props.showSpendValue=true] - Display USD spend toggle.
 * @returns {JSX.Element} Rendered timeline.
 */
function WorkflowTimeline({
  workflowName,
  status = "completed",
  nodes = [],
  finalOutput = "",
  tokenUsage = null,
  showTokenCount = true,
  showSpendValue = true,
}) {
  const [expandedNodes, setExpandedNodes] = useState({});

  const toggleNodeExpanded = (nodeId) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  const isRunning = status === "running";

  return (
    <div className="workflow-timeline">
      {/* Header */}
      <div className="workflow-timeline-header">
        <div className="workflow-timeline-title">
          <h4>🔀 Workflow: {workflowName || "Custom Pipeline"}</h4>
          <span className={`wf-status-badge wf-status-${status}`}>
            {isRunning ? "🔄 Running" : status === "completed" ? "✓ Completed" : "⚠️ Error"}
          </span>
        </div>

        {tokenUsage && showTokenCount && tokenUsage.total_tokens > 0 && (
          <div className="workflow-timeline-meta">
            <span>
              🪙 {formatShortNumber(tokenUsage.total_tokens)} tokens
              {showSpendValue && tokenUsage.total_cost > 0 && (
                <span> · {formatSpend(tokenUsage.total_cost)}</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Mini Flowchart Nodes View */}
      {nodes.length > 0 && (
        <div className="workflow-mini-flowchart">
          {nodes.map((node, i) => {
            const nodeStatus = node.status || (isRunning ? "running" : "completed");
            return (
              <span key={node.id} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <span className={`mini-flow-node status-${nodeStatus}`}>
                  <span>
                    {node.type === "input"
                      ? "📥"
                      : node.type === "output"
                        ? "📤"
                        : node.type === "synthesis"
                          ? "🧬"
                          : "🤖"}
                  </span>
                  <span>{node.label || node.id}</span>
                </span>
                {i < nodes.length - 1 && <span className="mini-flow-arrow">➔</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* Node Steps Accordion */}
      {nodes.length > 0 && (
        <div className="workflow-steps-accordion">
          {nodes
            .filter((n) => n.type !== "input" && n.type !== "output")
            .map((node) => {
              const isExpanded = !!expandedNodes[node.id];
              const shortModel = node.model ? node.model.split("/")[1] || node.model : "";

              return (
                <div key={node.id} className="workflow-step-card">
                  <div
                    className="workflow-step-header"
                    onClick={() => toggleNodeExpanded(node.id)}
                  >
                    <div className="workflow-step-header-left">
                      <span className="workflow-step-label">
                        {node.type === "synthesis" ? "🧬" : "🤖"} {node.label || node.id}
                      </span>
                      {shortModel && (
                        <span className="workflow-step-model-tag">{shortModel}</span>
                      )}
                    </div>

                    <div className="workflow-step-header-right">
                      {node.token_usage?.total_tokens > 0 && showTokenCount && (
                        <span>
                          {formatShortNumber(node.token_usage.total_tokens)} tok
                          {showSpendValue && node.token_usage.cost > 0 && (
                            <span> ({formatSpend(node.token_usage.cost)})</span>
                          )}
                        </span>
                      )}
                      <span className="workflow-step-toggle-icon">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="workflow-step-body">
                      {node.evaluated_prompt && (
                        <div className="workflow-sub-section">
                          <h5>Evaluated Prompt</h5>
                          <div className="workflow-prompt-preview">
                            {node.evaluated_prompt}
                          </div>
                        </div>
                      )}

                      <div className="workflow-sub-section">
                        <h5>Model Output</h5>
                        <div className="workflow-output-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {node.output || "(Empty output)"}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Final Output Deliverable */}
      {finalOutput && (
        <div className="workflow-final-output-card">
          <div className="workflow-final-header">
            <h4>
              <span>📋</span>
              <span>Final Workflow Output</span>
            </h4>
            <button
              type="button"
              className="btn-icon-action"
              onClick={() => {
                navigator.clipboard.writeText(finalOutput);
                alert("Final workflow output copied to clipboard!");
              }}
              title="Copy output to clipboard"
            >
              📋 Copy
            </button>
          </div>
          <div className="workflow-final-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {finalOutput}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(WorkflowTimeline);
