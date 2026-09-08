import { useState, useEffect } from "react";
import { api } from "../api";
import "./SettingsModal.css";

export default function SettingsModal({
  isOpen,
  onClose,
  assistantColor,
  setAssistantColor,
  userColor,
  setUserColor,
  onResetColors,
  showAllDeliberationSteps = true,
  setShowAllDeliberationSteps,
}) {
  const [activeTab, setActiveTab] = useState("models");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState("");
  const [availableModels, setAvailableModels] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadInitialData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function loadInitialData() {
    setLoading(true);
    setStatusMessage(null);
    try {
      const settings = await api.getSettings();
      setApiKey(settings.openrouter_api_key || "");
      setCouncilModels(settings.council_models || []);
      setChairmanModel(settings.chairman_model || "");

      // Fetch available models using active key
      await fetchModels(settings.openrouter_api_key);
    } catch (err) {
      console.error("Error loading settings:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to load settings from server.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function fetchModels(keyToUse) {
    setLoadingModels(true);
    try {
      const res = await api.getModels(keyToUse || apiKey);
      if (res.success && res.models) {
        setAvailableModels(res.models);
      }
    } catch (err) {
      console.error("Error fetching models:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to fetch OpenRouter models. Check your API key.",
      });
    } finally {
      setLoadingModels(false);
    }
  }

  const handleToggleCouncilModel = (modelId) => {
    setCouncilModels((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((id) => id !== modelId);
      } else {
        return [...prev, modelId];
      }
    });
  };

  const handleRemoveCouncilModel = (modelId) => {
    setCouncilModels((prev) => prev.filter((id) => id !== modelId));
  };

  const handleSaveSettings = async () => {
    if (councilModels.length === 0) {
      setStatusMessage({
        type: "error",
        text: "Please select at least one Council Model.",
      });
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      await api.updateSettings({
        openrouter_api_key: apiKey,
        council_models: councilModels,
        chairman_model: chairmanModel || councilModels[0],
      });
      setStatusMessage({
        type: "success",
        text: "Settings saved successfully!",
      });
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to save settings.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const filteredModels = availableModels.filter(
    (m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal-content large"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3>Settings</h3>
          <button
            type="button"
            onClick={onClose}
            className="close-settings-btn"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="settings-tab-nav">
          <button
            type="button"
            className={`tab-btn ${activeTab === "models" ? "active" : ""}`}
            onClick={() => setActiveTab("models")}
          >
            🤖 OpenRouter Models
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
          >
            🎨 Display & Appearance
          </button>
        </div>

        {statusMessage && (
          <div className={`status-banner ${statusMessage.type}`}>
            {statusMessage.text}
          </div>
        )}

        {loading ? (
          <div className="modal-loading-spinner">Loading settings...</div>
        ) : (
          <div className="settings-modal-body">
            {activeTab === "models" && (
              <>
                {/* API Key Section */}
                <div className="settings-section">
                  <label className="section-title">OpenRouter API Key</label>
                  <div className="api-key-input-group">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="text-input"
                    />
                    <button
                      type="button"
                      className="toggle-key-btn"
                      onClick={() => setShowApiKey(!showApiKey)}
                      title={showApiKey ? "Hide Key" : "Show Key"}
                    >
                      {showApiKey ? "🙈" : "👁️"}
                    </button>
                    <button
                      type="button"
                      className="refresh-models-btn"
                      onClick={() => fetchModels(apiKey)}
                      disabled={loadingModels}
                    >
                      {loadingModels ? "Fetching..." : "Fetch Models"}
                    </button>
                  </div>
                </div>

                {/* Chairman Model Selection */}
                <div className="settings-section">
                  <label className="section-title">Chairman Model</label>
                  <p className="section-desc">
                    Synthesizes final council responses and generates action plans.
                  </p>
                  <select
                    value={chairmanModel}
                    onChange={(e) => setChairmanModel(e.target.value)}
                    className="select-input"
                  >
                    {availableModels.length > 0 ? (
                      availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.id})
                        </option>
                      ))
                    ) : (
                      <option value={chairmanModel}>{chairmanModel}</option>
                    )}
                  </select>
                </div>

                {/* Selected Council Models Badges */}
                <div className="settings-section">
                  <div className="section-header-row">
                    <label className="section-title">
                      Council Members ({councilModels.length} selected)
                    </label>
                  </div>
                  <p className="section-desc">
                    These models evaluate prompts independently in Stage 1 and review each other in Stage 2.
                  </p>

                  <div className="selected-tags-container">
                    {councilModels.length === 0 ? (
                      <span className="no-tags">No models selected</span>
                    ) : (
                      councilModels.map((modelId) => {
                        const matched = availableModels.find((m) => m.id === modelId);
                        const label = matched ? matched.name : modelId;
                        return (
                          <div key={modelId} className="model-tag">
                            <span>{label}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCouncilModel(modelId)}
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* OpenRouter Model Catalog Picker */}
                <div className="settings-section flex-grow">
                  <div className="catalog-search-row">
                    <label className="section-title">Available OpenRouter Models</label>
                    <input
                      type="text"
                      placeholder="Search models by name or vendor (e.g. gpt, gemini, claude)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="search-input"
                    />
                  </div>

                  <div className="models-catalog-list">
                    {loadingModels ? (
                      <div className="catalog-loading">Fetching OpenRouter models catalog...</div>
                    ) : filteredModels.length === 0 ? (
                      <div className="catalog-empty">No matching models found.</div>
                    ) : (
                      filteredModels.map((model) => {
                        const isSelected = councilModels.includes(model.id);
                        return (
                          <div
                            key={model.id}
                            className={`catalog-item ${isSelected ? "selected" : ""}`}
                            onClick={() => handleToggleCouncilModel(model.id)}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}} // Handled by div click
                            />
                            <div className="model-info">
                              <span className="model-name">{model.name}</span>
                              <span className="model-id">{model.id}</span>
                            </div>
                            {model.context_length && (
                              <span className="context-length">
                                {(model.context_length / 1024).toFixed(0)}k ctx
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === "appearance" && (
              <div className="appearance-section">
                {/* Deliberation Steps Display Setting */}
                <div className="settings-section">
                  <label className="section-title">Deliberation Steps Display</label>
                  <p className="section-desc">
                    Choose whether council deliberations show all model evaluations or display only the final synthesized answer.
                  </p>

                  <div className="deliberation-display-cards">
                    <div
                      className={`deliberation-display-card ${showAllDeliberationSteps ? "selected" : ""}`}
                      onClick={() => setShowAllDeliberationSteps && setShowAllDeliberationSteps(true)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="display-card-header">
                        <input
                          type="radio"
                          name="deliberationStepsDisplay"
                          checked={showAllDeliberationSteps}
                          onChange={() => setShowAllDeliberationSteps && setShowAllDeliberationSteps(true)}
                        />
                        <span className="display-card-title">Show all deliberation steps</span>
                      </div>
                      <p className="display-card-desc">
                        Full view showing Stage 1 (individual responses), Stage 2 (peer rankings), and Stage 3 (final synthesis).
                      </p>
                    </div>

                    <div
                      className={`deliberation-display-card ${!showAllDeliberationSteps ? "selected" : ""}`}
                      onClick={() => setShowAllDeliberationSteps && setShowAllDeliberationSteps(false)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="display-card-header">
                        <input
                          type="radio"
                          name="deliberationStepsDisplay"
                          checked={!showAllDeliberationSteps}
                          onChange={() => setShowAllDeliberationSteps && setShowAllDeliberationSteps(false)}
                        />
                        <span className="display-card-title">Just show final answer</span>
                      </div>
                      <p className="display-card-desc">
                        Directly display the Chairman's final synthesized answer with an on-demand expander for earlier steps.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="appearance-divider" />

                <div className="settings-section">
                  <label className="section-title">Message Styling</label>
                  <div className="settings-field">
                    <label>LLM Council Response Background</label>
                    <input
                      type="color"
                      value={assistantColor}
                      onChange={(e) => setAssistantColor(e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label>User Message Background</label>
                    <input
                      type="color"
                      value={userColor}
                      onChange={(e) => setUserColor(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="reset-colors-btn"
                    onClick={onResetColors}
                  >
                    Reset Color Defaults
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="settings-modal-footer">
          <button type="button" className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="save-btn"
            onClick={handleSaveSettings}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
