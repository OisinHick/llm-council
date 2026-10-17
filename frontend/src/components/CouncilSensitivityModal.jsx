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

          {/* Granular Triggers & Safeguards */}
          <div className="sensitivity-control-section">
            <span className="section-title">Automated Triggers</span>

            <div className="compact-triggers-card">
              <label className="compact-toggle-row">
                <input
                  type="checkbox"
                  checked={autoTriggerOnError}
                  onChange={(e) => setAutoTriggerOnError(e.target.checked)}
                />
                <div className="toggle-text">
                  <span className="toggle-title">Auto-deliberate on tool failure</span>
                  <span className="toggle-description">
                    Spins up a council diagnostic when a bash command or edit errors
                  </span>
                </div>
              </label>

              <label className="compact-toggle-row">
                <input
                  type="checkbox"
                  checked={reviewBeforeCompletion}
                  onChange={(e) => setReviewBeforeCompletion(e.target.checked)}
                />
                <div className="toggle-text">
                  <span className="toggle-title">Pre-completion Council review</span>
                  <span className="toggle-description">
                    Verifies all deliverables with Council before task completion
                  </span>
                </div>
              </label>

              <div className="inline-limit-row">
                <div className="toggle-text">
                  <span className="toggle-title">Deliberation limit</span>
                  <span className="toggle-description">
                    Cap total council consultations per run
                  </span>
                </div>
                <select
                  value={maxConsultations}
                  onChange={(e) => setMaxConsultations(e.target.value)}
                  className="consultation-select"
                  aria-label="Deliberation limit"
                >
                  <option value="1">1 max</option>
                  <option value="3">3 max</option>
                  <option value="5">5 max (Default)</option>
                  <option value="10">10 max</option>
                  <option value="20">20 max</option>
                  <option value="50">50 max</option>
                  <option value="100">100 max</option>
                  <option value="0">Unlimited</option>
                </select>
              </div>

              <div className="inline-limit-row">
                <div className="toggle-text">
                  <span className="toggle-title">Agentic Loop steps</span>
                  <span className="toggle-description">
                    Cap total tool execution actions before agent stops
                  </span>
                </div>
                <select
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(e.target.value)}
                  className="consultation-select"
                  aria-label="Agentic Loop steps"
                >
                  <option value="5">5 steps</option>
                  <option value="10">10 steps</option>
                  <option value="20">20 steps (Default)</option>
                  <option value="30">30 steps</option>
                  <option value="50">50 steps</option>
                  <option value="100">100 steps</option>
                  <option value="0">Unlimited</option>
                </select>
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
