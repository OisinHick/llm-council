import React, { useState } from "react";
import "./CouncilSensitivityModal.css";

const SENSITIVITY_PRESETS = [
  {
    id: "low",
    value: 1,
    title: "Low (Minimal)",
    badgeColor: "#16a34a",
    badgeBg: "#dcfce7",
    summary: "High autonomy. Only consults the Council on unrecoverable blockers.",
    description:
      "The Chairperson operates independently, exhausting local tools and self-debugging before consulting the AI council.",
    defaults: {
      auto_trigger_on_error: false,
      review_before_completion: false,
    },
  },
  {
    id: "medium",
    value: 2,
    title: "Medium (Balanced)",
    badgeColor: "#2563eb",
    badgeBg: "#dbeafe",
    summary: "Standard collaboration on design forks, complex bugs, and dilemmas.",
    description:
      "Default balanced mode. The Chairperson seeks multi-model consensus on key architectural forks and difficult bugs.",
    defaults: {
      auto_trigger_on_error: false,
      review_before_completion: false,
    },
  },
  {
    id: "high",
    value: 3,
    title: "High (Proactive)",
    badgeColor: "#d97706",
    badgeBg: "#fef3c7",
    summary: "Frequent guidance. Consults council on errors, test failures, and design.",
    description:
      "The Chairperson proactively requests peer consensus when commands fail or when evaluating alternative implementations.",
    defaults: {
      auto_trigger_on_error: true,
      review_before_completion: false,
    },
  },
  {
    id: "extreme",
    value: 4,
    title: "Extreme (Continuous)",
    badgeColor: "#dc2626",
    badgeBg: "#fee2e2",
    summary: "Continuous oversight with automated diagnostics and pre-completion review.",
    description:
      "Every tool error triggers an automated sub-council diagnostic, and deliverables must receive Council sign-off before completion.",
    defaults: {
      auto_trigger_on_error: true,
      review_before_completion: true,
    },
  },
];

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

function CouncilSensitivityDialog({ onClose, sensitivityConfig, onSave }) {
  const initialLevel = sensitivityConfig?.level || "medium";
  const [level, setLevel] = useState(initialLevel);
  const [autoTriggerOnError, setAutoTriggerOnError] = useState(
    () =>
      sensitivityConfig?.auto_trigger_on_error ??
      (initialLevel === "high" || initialLevel === "extreme")
  );
  const [reviewBeforeCompletion, setReviewBeforeCompletion] = useState(
    () =>
      sensitivityConfig?.review_before_completion ??
      (initialLevel === "extreme")
  );
  const [maxConsultations, setMaxConsultations] = useState(
    () => sensitivityConfig?.max_consultations ?? 5
  );
  const [maxSteps, setMaxSteps] = useState(
    () => sensitivityConfig?.max_steps ?? 20
  );
  const [saveFeedback, setSaveFeedback] = useState(false);

  const currentPreset =
    SENSITIVITY_PRESETS.find((p) => p.id === level) || SENSITIVITY_PRESETS[1];

  const handleSelectLevel = (newLevel) => {
    setLevel(newLevel);
    const preset = SENSITIVITY_PRESETS.find((p) => p.id === newLevel);
    if (preset) {
      setAutoTriggerOnError(preset.defaults.auto_trigger_on_error);
      setReviewBeforeCompletion(preset.defaults.review_before_completion);
    }
  };

  const handleResetDefaults = () => {
    handleSelectLevel("medium");
    setMaxConsultations(5);
    setMaxSteps(20);
  };

  const handleSave = () => {
    const newConfig = {
      level,
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
          {/* Preset Segmented Selector */}
          <div className="sensitivity-control-section">
            <div className="section-label-row">
              <span className="section-title">Deliberation Sensitivity</span>
              <span
                className="sensitivity-badge"
                style={{
                  color: currentPreset.badgeColor,
                  backgroundColor: currentPreset.badgeBg,
                }}
              >
                {currentPreset.title}
              </span>
            </div>

            <div
              className="sensitivity-segmented-bar"
              role="tablist"
              aria-label="Deliberation sensitivity"
            >
              {SENSITIVITY_PRESETS.map((p) => {
                const isSelected = level === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`segmented-btn ${isSelected ? "active" : ""}`}
                    onClick={() => handleSelectLevel(p.id)}
                    style={
                      isSelected
                        ? {
                            borderColor: p.badgeColor,
                            color: p.badgeColor,
                          }
                        : {}
                    }
                  >
                    <span
                      className="segmented-dot"
                      style={{
                        backgroundColor: isSelected ? p.badgeColor : "#cbd5e1",
                      }}
                    />
                    {p.id.charAt(0).toUpperCase() + p.id.slice(1)}
                  </button>
                );
              })}
            </div>

            <div className="policy-hint">
              <span className="policy-hint-icon">💡</span>
              <span className="policy-hint-text">{currentPreset.description}</span>
            </div>
          </div>

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
