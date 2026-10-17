/**
 * CouncilSensitivityModal Component: Agentic Loop & Council Settings.
 *
 * This modal configures execution loop steps and AI Council guidance
 * for the Council Chairperson Agent during ReAct loop execution:
 * - Granular automated triggers (error auto-trigger, pre-completion review).
 * - Deliberation consultation caps (1, 3, 5, 10, 20, 50, 100, Unlimited).
 * - Maximum execution loop steps (5, 10, 20, 30, 50, 100, Unlimited).
 */

import React, { useState } from "react";
import "./CouncilSensitivityModal.css";

/**
 * Modal wrapper that conditionally renders the settings dialog.
 *
 * @param {Object} props - Component properties.
 * @param {boolean} props.isOpen - Whether the modal dialog is rendered.
 * @param {function(): void} props.onClose - Callback when modal is dismissed.
 * @param {Object} [props.sensitivityConfig] - Current configuration object.
 * @param {function(Object): void} props.onSave - Callback receiving updated configuration.
 * @returns {JSX.Element|null} Rendered dialog or null when closed.
 */
export default function CouncilSensitivityModal({
  isOpen,
  onClose,
  sensitivityConfig,
  onSave,
}) {
  if (!isOpen) return null;

  return (
    <CouncilSensitivityDialog
      onClose={onClose}
      sensitivityConfig={sensitivityConfig}
      onSave={onSave}
    />
  );
}

/**
 * Inner dialog component holding form state for agent loop options.
 *
 * @param {Object} props - Dialog properties.
 * @param {function(): void} props.onClose - Callback to dismiss the dialog.
 * @param {Object} [props.sensitivityConfig] - Initial settings.
 * @param {function(Object): void} props.onSave - Callback when settings are saved.
 * @returns {JSX.Element} Rendered dialog content.
 */
function CouncilSensitivityDialog({ onClose, sensitivityConfig, onSave }) {
  const [autoTriggerOnError, setAutoTriggerOnError] = useState(
    () => sensitivityConfig?.auto_trigger_on_error ?? false
  );
  const [reviewBeforeCompletion, setReviewBeforeCompletion] = useState(
    () => sensitivityConfig?.review_before_completion ?? false
  );
  const [maxConsultations, setMaxConsultations] = useState(
    () => sensitivityConfig?.max_consultations ?? 5
  );
  const [maxSteps, setMaxSteps] = useState(
    () => sensitivityConfig?.max_steps ?? 20
  );
  const [saveFeedback, setSaveFeedback] = useState(false);

  /**
   * Reset all settings to default values.
   */
  const handleResetDefaults = () => {
    setAutoTriggerOnError(false);
    setReviewBeforeCompletion(false);
    setMaxConsultations(5);
    setMaxSteps(20);
  };

  /**
   * Compile and validate configuration and invoke the onSave callback.
   */
  const handleSave = () => {
    const newConfig = {
      ...(sensitivityConfig || {}),
      auto_trigger_on_error: autoTriggerOnError,
      review_before_completion: reviewBeforeCompletion,
      max_consultations: parseInt(maxConsultations, 10),
      max_steps: parseInt(maxSteps, 10),
    };
    onSave(newConfig);
    setSaveFeedback(true);
    setTimeout(() => {
      setSaveFeedback(false);
      onClose();
    }, 400);
  };

  return (
    <div className="sensitivity-modal-backdrop" onClick={onClose}>
      <div
        className="sensitivity-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sensitivity-modal-header">
          <div className="sensitivity-header-title">
            <span className="sensitivity-header-icon">🧠</span>
            <div>
              <h3>Agentic Loop & Council Settings</h3>
              <p className="sensitivity-header-subtitle">
                Configure execution loop steps and AI Council guidance during agent runs
              </p>
            </div>
          </div>
          <button
            type="button"
            className="close-sensitivity-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <div className="sensitivity-modal-body">
          <div className="sensitivity-grid-layout">
            {/* Left Card: Automated Triggers & Safeguards */}
            <div className="sensitivity-card">
              <div className="sensitivity-card-header">
                <span className="card-badge-icon">⚡</span>
                <div>
                  <h4 className="card-title">Automated Deliberation Triggers</h4>
                  <p className="card-subtitle">
                    Control when the Chairperson invokes the AI Council during execution
                  </p>
                </div>
              </div>

              <div className="triggers-group">
                <label className="sensitivity-toggle-card">
                  <input
                    type="checkbox"
                    checked={autoTriggerOnError}
                    onChange={(e) => setAutoTriggerOnError(e.target.checked)}
                  />
                  <div className="toggle-card-content">
                    <div className="toggle-card-header">
                      <span className="toggle-title">Auto-deliberate on tool failure</span>
                      <span className={`toggle-status-badge ${autoTriggerOnError ? "active" : ""}`}>
                        {autoTriggerOnError ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <span className="toggle-description">
                      Spins up a multi-model council diagnostic session when a tool call, bash command, or file edit encounters an error.
                    </span>
                  </div>
                </label>

                <label className="sensitivity-toggle-card">
                  <input
                    type="checkbox"
                    checked={reviewBeforeCompletion}
                    onChange={(e) => setReviewBeforeCompletion(e.target.checked)}
                  />
                  <div className="toggle-card-content">
                    <div className="toggle-card-header">
                      <span className="toggle-title">Pre-completion Council review</span>
                      <span className={`toggle-status-badge ${reviewBeforeCompletion ? "active" : ""}`}>
                        {reviewBeforeCompletion ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <span className="toggle-description">
                      Requires the Chairperson to submit the final output to the AI Council for thorough multi-perspective review and consensus before completing the goal.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Right Card: Resource Budgets & Limits */}
            <div className="sensitivity-card">
              <div className="sensitivity-card-header">
                <span className="card-badge-icon">🛡️</span>
                <div>
                  <h4 className="card-title">Loop Limits & Resource Budgets</h4>
                  <p className="card-subtitle">
                    Set safety boundaries for autonomous execution steps and council calls
                  </p>
                </div>
              </div>

              <div className="limits-group">
                <div className="limit-setting-row">
                  <div className="limit-info">
                    <span className="limit-title">Deliberation Limit</span>
                    <span className="limit-description">
                      Maximum number of full multi-model Council consultations permitted in a single agent run.
                    </span>
                  </div>
                  <select
                    value={maxConsultations}
                    onChange={(e) => setMaxConsultations(e.target.value)}
                    className="consultation-select large"
                    aria-label="Deliberation limit"
                  >
                    <option value="1">1 consultation max</option>
                    <option value="3">3 consultations max</option>
                    <option value="5">5 consultations max (Default)</option>
                    <option value="10">10 consultations max</option>
                    <option value="20">20 consultations max</option>
                    <option value="50">50 consultations max</option>
                    <option value="100">100 consultations max</option>
                    <option value="0">Unlimited consultations</option>
                  </select>
                </div>

                <div className="limit-setting-row">
                  <div className="limit-info">
                    <span className="limit-title">Agentic Loop Step Cap</span>
                    <span className="limit-description">
                      Maximum number of tool action cycles (Thought → Action → Observation) before execution terminates.
                    </span>
                  </div>
                  <select
                    value={maxSteps}
                    onChange={(e) => setMaxSteps(e.target.value)}
                    className="consultation-select large"
                    aria-label="Agentic Loop steps"
                  >
                    <option value="5">5 steps</option>
                    <option value="10">10 steps</option>
                    <option value="20">20 steps (Default)</option>
                    <option value="30">30 steps</option>
                    <option value="50">50 steps</option>
                    <option value="100">100 steps</option>
                    <option value="0">Unlimited steps</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Full Width Architecture Guide */}
          <div className="agentic-guide-card">
            <h4 className="guide-title">
              <span>💡</span> Understanding the Autonomous Agentic Architecture
            </h4>
            <div className="guide-steps-grid">
              <div className="guide-step">
                <div className="guide-step-number">1</div>
                <div className="guide-step-content">
                  <h5>Chairperson Planning</h5>
                  <p>The Chairperson agent breaks down your goal into actionable tasks using structured ReAct reasoning.</p>
                </div>
              </div>
              <div className="guide-step">
                <div className="guide-step-number">2</div>
                <div className="guide-step-content">
                  <h5>Tool Execution</h5>
                  <p>Executes workspace actions: runs shell commands, edits files, and invokes active MCP servers.</p>
                </div>
              </div>
              <div className="guide-step">
                <div className="guide-step-number">3</div>
                <div className="guide-step-content">
                  <h5>Council Deliberation</h5>
                  <p>When triggers fire or critical decisions arise, the full multi-LLM council convenes to guide next steps.</p>
                </div>
              </div>
              <div className="guide-step">
                <div className="guide-step-number">4</div>
                <div className="guide-step-content">
                  <h5>Synthesis & Delivery</h5>
                  <p>Consolidates peer findings into the final result with full audit logs and artifact generation.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="sensitivity-modal-footer">
          <button
            type="button"
            className="btn-link-secondary"
            onClick={handleResetDefaults}
          >
            Reset to Defaults
          </button>
          <div className="footer-right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSave}
            >
              {saveFeedback ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
