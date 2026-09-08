import { useState } from "react";
import ReactMarkdown from "react-markdown";
import Stage1 from "./Stage1";
import Stage2 from "./Stage2";
import Stage3 from "./Stage3";
import "./AgentTimeline.css";

export default function AgentTimeline({
  agentData,
  isRunning = false,
  onCancel,
}) {
  const [showInitialCouncil, setShowInitialCouncil] = useState(false);
  const [expandedCouncilConsultations, setExpandedCouncilConsultations] =
    useState({});

  if (!agentData) return null;

  const {
    status = isRunning ? "running" : "completed",
    initial_council = {},
    steps = [],
    artifacts = [],
    summary = "",
    error = null,
  } = agentData;

  const toggleSubCouncil = (stepNum) => {
    setExpandedCouncilConsultations((prev) => ({
      ...prev,
      [stepNum]: !prev[stepNum],
    }));
  };

  const hasInitialCouncil =
    (initial_council.stage1 && initial_council.stage1.length > 0) ||
    initial_council.stage3;

  return (
    <div className="agent-timeline">
      {/* Banner / Status Bar */}
      <div
        className={`agent-banner ${isRunning ? "running" : status || "completed"}`}
      >
        <div className="agent-banner-title">
          {isRunning ? (
            <>
              <span className="agent-pulse-dot" />
              <span>
                Council Chairperson Agent is actively working (Step{" "}
                {steps.length + 1})...
              </span>
            </>
          ) : status === "completed" ? (
            <>
              <span>✅</span>
              <span>
                Task Completed Successfully ({steps.length} steps executed)
              </span>
            </>
          ) : status === "cancelled" ? (
            <>
              <span>⚠️</span>
              <span>Agent Execution Cancelled</span>
            </>
          ) : (
            <>
              <span>❌</span>
              <span>{error || "Agent execution failed"}</span>
            </>
          )}
        </div>

        {isRunning && onCancel && (
          <button
            type="button"
            className="agent-stop-btn"
            onClick={onCancel}
          >
            Stop Agent
          </button>
        )}
      </div>

      {/* Initial Council Deliberation Section */}
      {hasInitialCouncil && (
        <div className="initial-council-section">
          <div
            className="initial-council-header"
            onClick={() => setShowInitialCouncil(!showInitialCouncil)}
          >
            <h4>
              <span>🏛️</span>
              <span>
                Initial Council Deliberation & Cross-Referenced Strategy
              </span>
            </h4>
            <span
              className={`toggle-arrow ${showInitialCouncil ? "open" : ""}`}
            >
              ▼
            </span>
          </div>

          {showInitialCouncil && (
            <div className="initial-council-content">
              {initial_council.stage1 && (
                <Stage1 responses={initial_council.stage1} />
              )}
              {initial_council.stage2 && (
                <Stage2
                  rankings={initial_council.stage2}
                  labelToModel={initial_council.metadata?.label_to_model}
                  aggregateRankings={
                    initial_council.metadata?.aggregate_rankings
                  }
                />
              )}
              {initial_council.stage3 && (
                <Stage3 finalResponse={initial_council.stage3} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Step-by-step Timeline */}
      <div className="agent-steps-container">
        {steps.map((step, idx) => {
          const stepNum = step.step || idx + 1;
          const action = step.action || "unknown";
          const params = step.params || {};
          const obs = step.observation || {};
          const councilConsultation = step.council_consultation;

          return (
            <div key={idx} className="agent-step-card">
              <div className="agent-step-header">
                <span className="step-badge">Step {stepNum}</span>
                <span className={`action-type-badge ${action}`}>
                  {action}
                </span>
                {councilConsultation && action !== "consult_council" && (
                  <span
                    className="action-type-badge consult_council"
                    style={{ marginLeft: "6px" }}
                  >
                    ⚖️ council consulted
                  </span>
                )}
              </div>

              <div className="agent-step-body">
                {/* Thought block */}
                {step.thought && (
                  <div className="agent-thought-block">
                    <div className="agent-thought-label">
                      Chairperson Reasoning
                    </div>
                    <div className="markdown-content">
                      <ReactMarkdown>{step.thought}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Action parameters display */}
                <div className="action-details-block">
                  {action === "write_file" && (
                    <>
                      <div className="action-target-path">
                        📄 Writing file: <code>{params.path}</code>
                      </div>
                      {params.content && (
                        <pre className="code-preview-box">
                          {params.content.length > 1500
                            ? params.content.slice(0, 1500) +
                              "\n... [Truncated preview]"
                            : params.content}
                        </pre>
                      )}
                    </>
                  )}

                  {action === "edit_file" && (
                    <>
                      <div className="action-target-path">
                        ✏️ Editing file: <code>{params.path}</code>
                      </div>
                      <pre className="code-preview-box">
                        Target: {params.target_content}
                        {"\n\n"}Replacement: {params.replacement_content}
                      </pre>
                    </>
                  )}

                  {action === "read_file" && (
                    <div className="action-target-path">
                      📖 Reading file: <code>{params.path}</code>
                      {params.start_line &&
                        ` (lines ${params.start_line}-${params.end_line || "end"})`}
                    </div>
                  )}

                  {action === "execute_command" && (
                    <div className="command-terminal-box">
                      {params.command}
                    </div>
                  )}

                  {(action === "consult_council" || councilConsultation) && (
                    <div className="sub-council-box">
                      <div className="sub-council-title">
                        <span>⚖️</span>
                        <span>
                          {councilConsultation?.question
                            ? `Council Consultation: "${councilConsultation.question}"`
                            : params?.question
                              ? `Council Consultation: "${params.question}"`
                              : "Council Deliberation & Diagnostic"}
                        </span>
                      </div>

                      {councilConsultation?.consensus_recommendation && (
                        <div className="sub-council-recommendation">
                          <strong>Council Consensus:</strong>
                          <div className="markdown-content">
                            <ReactMarkdown>
                              {councilConsultation.consensus_recommendation}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}

                      {councilConsultation && (
                        <div>
                          <button
                            type="button"
                            className="execute-action-btn"
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                            onClick={() => toggleSubCouncil(stepNum)}
                          >
                            {expandedCouncilConsultations[stepNum]
                              ? "Hide Council Evaluations"
                              : "View Full Council Peer Review"}
                          </button>

                          {expandedCouncilConsultations[stepNum] && (
                            <div style={{ marginTop: "10px" }}>
                              {councilConsultation.stage1 && (
                                <Stage1
                                  responses={councilConsultation.stage1}
                                />
                              )}
                              {councilConsultation.stage2 && (
                                <Stage2
                                  rankings={councilConsultation.stage2}
                                  aggregateRankings={
                                    councilConsultation.aggregate_rankings
                                  }
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {action === "list_directory" && (
                    <div className="action-target-path">
                      📁 Listing directory: <code>{params.path || "."}</code>
                    </div>
                  )}
                </div>

                {/* Observation block */}
                {obs && Object.keys(obs).length > 0 && (
                  <div className="agent-observation-block">
                    <div className="observation-header">
                      <span>Observation</span>
                      <span
                        className={`obs-status-tag ${
                          obs.success !== false ? "success" : "failure"
                        }`}
                      >
                        {obs.success !== false ? "SUCCESS" : "ERROR"}
                      </span>
                    </div>

                    {obs.stdout && (
                      <pre className="obs-content-pre">{obs.stdout}</pre>
                    )}
                    {obs.stderr && (
                      <pre className="obs-content-pre" style={{ color: "#ef4444" }}>
                        {obs.stderr}
                      </pre>
                    )}
                    {obs.message && !obs.stdout && (
                      <div style={{ fontSize: "13px", color: "#475569" }}>
                        {obs.message}
                      </div>
                    )}
                    {obs.content && (
                      <pre className="obs-content-pre">{obs.content}</pre>
                    )}
                    {obs.error && (
                      <div
                        style={{
                          fontSize: "13px",
                          color: "#dc2626",
                          fontWeight: 500,
                        }}
                      >
                        {obs.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Deliverables / Final Summary Card */}
      {(artifacts.length > 0 || summary) && (
        <div className="deliverables-card">
          <div className="deliverables-title">
            <span>📦</span>
            <span>Deliverables & Results</span>
          </div>

          {artifacts.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#166534",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                }}
              >
                Files & Documents Created / Modified:
              </div>
              <div className="artifacts-grid">
                {artifacts.map((art, idx) => (
                  <span key={idx} className="artifact-pill">
                    📄 {art}
                  </span>
                ))}
              </div>
            </div>
          )}

          {summary && (
            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#166534",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                }}
              >
                Chairperson Summary:
              </div>
              <div className="deliverables-summary markdown-content">
                <ReactMarkdown>{summary}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
