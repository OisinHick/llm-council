import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import Stage1 from "./Stage1";
import Stage2 from "./Stage2";
import Stage3 from "./Stage3";
import "./ActionMode.css";

function ActionMode() {
  const [request, setRequest] = useState("");
  const [execute, setExecute] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [stages, setStages] = useState({
    stage1: null,
    stage2: null,
    stage3: null,
    stage4: null,
    execution: null,
  });
  const [loadingStages, setLoadingStages] = useState({
    stage1: false,
    stage2: false,
    stage3: false,
    stage4: false,
    execution: false,
  });
  const [activeTab, setActiveTab] = useState("plan");

  const handleExecuteAction = async (e) => {
    e.preventDefault();
    if (!request.trim()) return;

    setIsLoading(true);
    setResult(null);
    setStages({
      stage1: null,
      stage2: null,
      stage3: null,
      stage4: null,
      execution: null,
    });

    try {
      await api.executeActionStream(request, execute, (eventType, event) => {
        switch (eventType) {
          case "stage1_start":
            setLoadingStages((prev) => ({ ...prev, stage1: true }));
            break;
          case "stage1_complete":
            setStages((prev) => ({ ...prev, stage1: event.data }));
            setLoadingStages((prev) => ({ ...prev, stage1: false }));
            break;

          case "stage2_start":
            setLoadingStages((prev) => ({ ...prev, stage2: true }));
            break;
          case "stage2_complete":
            setStages((prev) => ({
              ...prev,
              stage2: event.data,
              metadata: event.metadata,
            }));
            setLoadingStages((prev) => ({ ...prev, stage2: false }));
            break;

          case "stage3_start":
            setLoadingStages((prev) => ({ ...prev, stage3: true }));
            break;
          case "stage3_complete":
            setStages((prev) => ({ ...prev, stage3: event.data }));
            setLoadingStages((prev) => ({ ...prev, stage3: false }));
            break;

          case "stage4_action_plan":
            setStages((prev) => ({ ...prev, stage4: event.data }));
            setLoadingStages((prev) => ({ ...prev, stage4: false }));
            setActiveTab("plan");
            break;

          case "execution_start":
            setLoadingStages((prev) => ({ ...prev, execution: true }));
            break;
          case "execution_complete":
            setStages((prev) => ({ ...prev, execution: event.data }));
            setLoadingStages((prev) => ({ ...prev, execution: false }));
            setActiveTab("execution");
            break;

          case "complete":
            setIsLoading(false);
            setResult({
              ...stages,
              stage4: stages.stage4,
              execution: stages.execution,
            });
            break;

          case "error":
            setIsLoading(false);
            setResult({ error: event.message });
            break;
        }
      });
    } catch (error) {
      console.error("Action execution failed:", error);
      setResult({ error: error.message });
      setIsLoading(false);
    }
  };

  return (
    <div className="action-mode">
      <div className="action-form">
        <form onSubmit={handleExecuteAction}>
          <div className="form-group">
            <label htmlFor="request">Action Request</label>
            <textarea
              id="request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="e.g., Scan the network for open ports and save results to a file..."
              rows="3"
              disabled={isLoading}
            />
          </div>

          <div className="form-options">
            <div className="checkbox-label">
              <button
                className={`circular-toggle ${execute ? "active" : ""}`}
                onClick={() => setExecute(!execute)}
                disabled={isLoading}
                title={execute ? "Disable execution" : "Enable execution"}
              />
              Execute Action Plan
              <span className="checkbox-hint">
                {execute ? "✓ Will execute" : "ℹ Plan only"}
              </span>
            </div>

            <button
              type="submit"
              disabled={isLoading || !request.trim()}
              className="submit-btn"
            >
              {isLoading ? "⏳ Processing..." : "🚀 Execute Council"}
            </button>
          </div>
        </form>
      </div>

      {/* Progress Indicators */}
      {(isLoading || stages.stage1) && (
        <div className="progress-indicators">
          <div
            className={`indicator ${loadingStages.stage1 ? "active" : "done"}`}
          >
            {loadingStages.stage1 ? "⏳" : "✓"} Stage 1: Council Approaches
          </div>
          {stages.stage1 && (
            <div
              className={`indicator ${loadingStages.stage2 ? "active" : "done"}`}
            >
              {loadingStages.stage2 ? "⏳" : stages.stage2 ? "✓" : "⏸"} Stage 2:
              Voting
            </div>
          )}
          {stages.stage2 && (
            <div
              className={`indicator ${loadingStages.stage3 ? "active" : "done"}`}
            >
              {loadingStages.stage3 ? "⏳" : stages.stage3 ? "✓" : "⏸"} Stage 3:
              Synthesis
            </div>
          )}
          {stages.stage3 && (
            <div
              className={`indicator ${loadingStages.stage4 ? "active" : "done"}`}
            >
              {loadingStages.stage4 ? "⏳" : stages.stage4 ? "✓" : "⏸"} Stage 4:
              Action Plan
            </div>
          )}
          {stages.stage4 && execute && (
            <div
              className={`indicator ${loadingStages.execution ? "active" : "done"}`}
            >
              {loadingStages.execution ? "⏳" : stages.execution ? "✓" : "⏸"}{" "}
              Execution
            </div>
          )}
        </div>
      )}

      {/* Results Tabs */}
      {stages.stage1 && (
        <div className="results-container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === "stage1" ? "active" : ""}`}
              onClick={() => setActiveTab("stage1")}
            >
              Stage 1: Approaches ({stages.stage1?.length || 0})
            </button>
            {stages.stage2 && (
              <button
                className={`tab ${activeTab === "stage2" ? "active" : ""}`}
                onClick={() => setActiveTab("stage2")}
              >
                Stage 2: Voting
              </button>
            )}
            {stages.stage3 && (
              <button
                className={`tab ${activeTab === "stage3" ? "active" : ""}`}
                onClick={() => setActiveTab("stage3")}
              >
                Stage 3: Synthesis
              </button>
            )}
            {stages.stage4 && (
              <button
                className={`tab ${activeTab === "plan" ? "active" : ""}`}
                onClick={() => setActiveTab("plan")}
              >
                Stage 4: Action Plan
              </button>
            )}
            {stages.execution && (
              <button
                className={`tab ${activeTab === "execution" ? "active" : ""}`}
                onClick={() => setActiveTab("execution")}
              >
                Execution Results
              </button>
            )}
          </div>

          <div className="tab-content">
            {activeTab === "stage1" && stages.stage1 && (
              <Stage1 results={stages.stage1} />
            )}
            {activeTab === "stage2" && stages.stage2 && (
              <Stage2 results={stages.stage2} metadata={stages.metadata} />
            )}
            {activeTab === "stage3" && stages.stage3 && (
              <Stage3 result={stages.stage3} />
            )}
            {activeTab === "plan" && stages.stage4 && (
              <ActionPlanDisplay plan={stages.stage4} />
            )}
            {activeTab === "execution" && stages.execution && (
              <ExecutionResultsDisplay result={stages.execution} />
            )}
          </div>
        </div>
      )}

      {result?.error && (
        <div className="error-message">
          <h3>Error</h3>
          <p>{result.error}</p>
        </div>
      )}
    </div>
  );
}

function ActionPlanDisplay({ plan }) {
  if (!plan.success) {
    return (
      <div className="error-container">
        <h3>Failed to Generate Action Plan</h3>
        <p>{plan.error}</p>
      </div>
    );
  }

  const actionPlan = plan.action_plan;

  return (
    <div className="action-plan-display">
      <div className="plan-header">
        <h3>Action Plan</h3>
        <p className="plan-model">
          Based on: <strong>{plan.best_response_model}</strong>
        </p>
      </div>

      <div className="plan-section">
        <h4>Description</h4>
        <p>{actionPlan.description}</p>
      </div>

      <div className="plan-section">
        <h4>Reasoning</h4>
        <p>{actionPlan.reasoning}</p>
      </div>

      <div className="plan-section">
        <h4>Tool Calls ({actionPlan.tool_calls?.length || 0})</h4>
        <div className="tool-calls">
          {actionPlan.tool_calls?.map((call, idx) => (
            <div key={idx} className="tool-call">
              <div className="tool-header">
                <span className="tool-name">{call.tool}</span>
                <span className="tool-desc">{call.description}</span>
              </div>
              <div className="tool-params formatted-params">
                {Object.entries(call.params || {}).map(([key, value]) => (
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
          ))}
        </div>
      </div>
    </div>
  );
}

function ExecutionResultsDisplay({ result }) {
  if (!result.success) {
    return (
      <div className="error-container">
        <h3>Execution Failed</h3>
        <p>{result.error}</p>
      </div>
    );
  }

  const execResults = result.execution_results;

  return (
    <div className="execution-results-display">
      <div className="results-header">
        <h3>Execution Results</h3>
        <p className="results-summary">
          {execResults.all_successful ? (
            <span className="success">✅ All actions succeeded!</span>
          ) : (
            <span className="warning">
              ⚠️ {execResults.executed_tools} actions executed
            </span>
          )}
        </p>
      </div>

      <div className="tool-results">
        {execResults.results?.map((toolResult, idx) => (
          <div key={idx} className="tool-result">
            <div className="result-header">
              <span className="result-tool">{toolResult.tool}</span>
              <span
                className={`result-status ${
                  toolResult.result.success ? "success" : "failure"
                }`}
              >
                {toolResult.result.success ? "✓" : "✗"}
              </span>
            </div>

            {toolResult.result.success ? (
              <div className="result-output">
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
                    <pre>
                      {JSON.stringify(toolResult.result.response, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="error-output">
                <p>{toolResult.result.error}</p>
                {toolResult.result.stderr && (
                  <pre>{toolResult.result.stderr}</pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActionMode;
