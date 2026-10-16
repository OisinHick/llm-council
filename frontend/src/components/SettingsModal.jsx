import { useState, useEffect } from "react";
import { api } from "../api";
import { formatSpend } from "../formatters";
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
  showTokenCount = true,
  setShowTokenCount,
  showTokensPerModel = false,
  setShowTokensPerModel,
  showSpendValue = true,
  setShowSpendValue,
  showSavedTokens = true,
  setShowSavedTokens,
  enableTokenCompression = false,
  setEnableTokenCompression,
}) {
  const [activeTab, setActiveTab] = useState("models");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState("");
  const [availableModels, setAvailableModels] = useState([]);
  const [localShowTokenCount, setLocalShowTokenCount] = useState(showTokenCount);
  const [localShowTokensPerModel, setLocalShowTokensPerModel] = useState(showTokensPerModel);
  const [localShowSpendValue, setLocalShowSpendValue] = useState(showSpendValue);
  const [localShowSavedTokens, setLocalShowSavedTokens] = useState(showSavedTokens);
  const [localEnableTokenCompression, setLocalEnableTokenCompression] = useState(enableTokenCompression);
  const [pricingInfo, setPricingInfo] = useState(null);
  const [refreshingPricing, setRefreshingPricing] = useState(false);
  const [compressionStats, setCompressionStats] = useState(null);
  const [resettingCompressionStats, setResettingCompressionStats] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setLocalShowTokenCount(showTokenCount);
      setLocalShowTokensPerModel(showTokensPerModel);
      setLocalShowSpendValue(showSpendValue);
      setLocalShowSavedTokens(showSavedTokens);
      setLocalEnableTokenCompression(enableTokenCompression);
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
      if (settings.show_token_count !== undefined) {
        setLocalShowTokenCount(Boolean(settings.show_token_count));
        if (setShowTokenCount) setShowTokenCount(Boolean(settings.show_token_count));
      }
      if (settings.show_tokens_per_model !== undefined) {
        setLocalShowTokensPerModel(Boolean(settings.show_tokens_per_model));
        if (setShowTokensPerModel) setShowTokensPerModel(Boolean(settings.show_tokens_per_model));
      }
      if (settings.show_spend_value !== undefined) {
        setLocalShowSpendValue(Boolean(settings.show_spend_value));
        if (setShowSpendValue) setShowSpendValue(Boolean(settings.show_spend_value));
      }
      if (settings.show_saved_tokens !== undefined) {
        setLocalShowSavedTokens(Boolean(settings.show_saved_tokens));
        if (setShowSavedTokens) setShowSavedTokens(Boolean(settings.show_saved_tokens));
      }
      if (settings.enable_token_compression !== undefined) {
        setLocalEnableTokenCompression(Boolean(settings.enable_token_compression));
        if (setEnableTokenCompression) setEnableTokenCompression(Boolean(settings.enable_token_compression));
      }

      // Fetch dynamic pricing status
      api.getPricing().then(setPricingInfo).catch((err) => {
        console.warn("Could not fetch pricing info:", err);
      });

      // Fetch compression savings stats
      api.getCompressionStats().then((res) => {
        if (res?.stats) setCompressionStats(res.stats);
      }).catch((err) => {
        console.warn("Could not fetch compression stats:", err);
      });

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

  async function handleRefreshPricing() {
    setRefreshingPricing(true);
    try {
      const res = await api.refreshPricing();
      setPricingInfo(res);
      setStatusMessage({
        type: "success",
        text: `Successfully refreshed OpenRouter pricing for ${res.count || Object.keys(res.rates || {}).length} models!`,
      });
    } catch (e) {
      console.error("Failed to refresh pricing:", e);
      setStatusMessage({
        type: "error",
        text: "Failed to refresh dynamic pricing: " + e.message,
      });
    } finally {
      setRefreshingPricing(false);
    }
  }

  async function handleResetCompressionStats() {
    setResettingCompressionStats(true);
    try {
      const res = await api.resetCompressionStats();
      if (res?.stats) {
        setCompressionStats(res.stats);
        setStatusMessage({
          type: "success",
          text: "Compression statistics reset successfully.",
        });
      }
    } catch (e) {
      console.error("Failed to reset compression stats:", e);
      setStatusMessage({
        type: "error",
        text: "Failed to reset compression stats: " + e.message,
      });
    } finally {
      setResettingCompressionStats(false);
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
        show_token_count: localShowTokenCount,
        show_tokens_per_model: localShowTokensPerModel,
        show_spend_value: localShowSpendValue,
        show_saved_tokens: localShowSavedTokens,
        enable_token_compression: localEnableTokenCompression,
        compression_algorithm: "headroom",
      });

      if (setShowTokenCount) setShowTokenCount(localShowTokenCount);
      if (setShowTokensPerModel) setShowTokensPerModel(localShowTokensPerModel);
      if (setShowSpendValue) setShowSpendValue(localShowSpendValue);
      if (setShowSavedTokens) setShowSavedTokens(localShowSavedTokens);
      if (setEnableTokenCompression) setEnableTokenCompression(localEnableTokenCompression);

      try {
        localStorage.setItem(
          "llmCouncilShowTokenCount",
          JSON.stringify(localShowTokenCount)
        );
        localStorage.setItem(
          "llmCouncilShowTokensPerModel",
          JSON.stringify(localShowTokensPerModel)
        );
        localStorage.setItem(
          "llmCouncilShowSpendValue",
          JSON.stringify(localShowSpendValue)
        );
        localStorage.setItem(
          "llmCouncilShowSavedTokens",
          JSON.stringify(localShowSavedTokens)
        );
        localStorage.setItem(
          "llmCouncilEnableTokenCompression",
          JSON.stringify(localEnableTokenCompression)
        );
      } catch (e) {
        console.error("Failed to save token preferences to localStorage:", e);
      }

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

                {/* Token Tracking & Display Settings */}
                <div className="settings-section">
                  <label className="section-title">Conversation Token Counter</label>
                  <p className="section-desc">
                    Count tokens spent in each conversation. Unique to each conversation.
                  </p>

                  <div className="token-settings-cards">
                    <div
                      className={`token-setting-card ${localShowTokenCount ? "selected" : ""}`}
                      onClick={() => setLocalShowTokenCount(!localShowTokenCount)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="display-card-header">
                        <input
                          type="checkbox"
                          checked={localShowTokenCount}
                          onChange={(e) => setLocalShowTokenCount(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="display-card-title">Show conversation token count</span>
                      </div>
                      <p className="display-card-desc">
                        Display a token counter badge unique to each conversation in the chat header and conversation list.
                      </p>
                    </div>

                    <div
                      className={`token-setting-card ${localShowTokensPerModel ? "selected" : ""} ${!localShowTokenCount ? "disabled" : ""}`}
                      onClick={() => {
                        if (localShowTokenCount) {
                          setLocalShowTokensPerModel(!localShowTokensPerModel);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={!localShowTokenCount ? "Enable token count to view tokens per model" : ""}
                    >
                      <div className="display-card-header">
                        <input
                          type="checkbox"
                          checked={localShowTokensPerModel}
                          disabled={!localShowTokenCount}
                          onChange={(e) => setLocalShowTokensPerModel(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="display-card-title">Show tokens per model</span>
                      </div>
                      <p className="display-card-desc">
                        Display a detailed breakdown of tokens spent by each model in the conversation.
                        {!localShowTokenCount && " (Requires token count toggle to be on)"}
                      </p>
                    </div>

                    <div
                      className={`token-setting-card ${localShowSpendValue ? "selected" : ""} ${!localShowTokenCount ? "disabled" : ""}`}
                      onClick={() => {
                        if (localShowTokenCount) {
                          setLocalShowSpendValue(!localShowSpendValue);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={!localShowTokenCount ? "Enable token count to view spend value" : ""}
                    >
                      <div className="display-card-header">
                        <input
                          type="checkbox"
                          checked={localShowSpendValue}
                          disabled={!localShowTokenCount}
                          onChange={(e) => setLocalShowSpendValue(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="display-card-title">Show estimated spend value ($)</span>
                      </div>
                      <p className="display-card-desc">
                        Translate token counts into live USD spend using dynamically fetched OpenRouter rates.
                        {!localShowTokenCount && " (Requires token count toggle to be on)"}
                      </p>
                    </div>

                    <div
                      className={`token-setting-card ${localShowSavedTokens ? "selected" : ""} ${!localShowTokenCount ? "disabled" : ""}`}
                      onClick={() => {
                        if (localShowTokenCount) {
                          setLocalShowSavedTokens(!localShowSavedTokens);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={!localShowTokenCount ? "Enable token count to view saved tokens" : ""}
                    >
                      <div className="display-card-header">
                        <input
                          type="checkbox"
                          checked={localShowSavedTokens}
                          disabled={!localShowTokenCount}
                          onChange={(e) => setLocalShowSavedTokens(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="display-card-title">Show saved tokens</span>
                      </div>
                      <p className="display-card-desc">
                        Display badges and indicators highlighting tokens and cost saved by Headroom Labs compression.
                        {!localShowTokenCount && " (Requires token count toggle to be on)"}
                      </p>
                    </div>

                    <div
                      className={`token-setting-card ${localEnableTokenCompression ? "selected" : ""}`}
                      onClick={() => setLocalEnableTokenCompression(!localEnableTokenCompression)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="display-card-header">
                        <input
                          type="checkbox"
                          checked={localEnableTokenCompression}
                          onChange={(e) => setLocalEnableTokenCompression(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="display-card-title">Enable Headroom Labs compression</span>
                      </div>
                      <p className="display-card-desc">
                        Optimize prompts and message payloads using Headroom Labs AI to reduce input token usage, latency, and costs.
                      </p>
                    </div>
                  </div>

                  <div className="dynamic-pricing-card">
                    <div className="dynamic-pricing-info">
                      <div className="dynamic-pricing-title">
                        <span className="pricing-icon">⚡</span>
                        <strong>Dynamic OpenRouter Rates</strong>
                      </div>
                      <p className="dynamic-pricing-status">
                        {pricingInfo?.count ? (
                          <>
                            <span>{pricingInfo.count} model rates loaded dynamically.</span>
                            {pricingInfo.updated_at && (
                              <span className="pricing-timestamp">
                                {" "}Updated {new Date(pricingInfo.updated_at).toLocaleTimeString()}
                              </span>
                            )}
                          </>
                        ) : (
                          "Dynamic pricing active. Rates fetched live from OpenRouter."
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="refresh-pricing-btn"
                      onClick={handleRefreshPricing}
                      disabled={refreshingPricing}
                    >
                      {refreshingPricing ? "↻ Refreshing..." : "↻ Refresh Rates"}
                    </button>
                  </div>

                  <div className="compression-savings-card">
                    <div className="compression-savings-info">
                      <div className="compression-savings-title">
                        <span className="pricing-icon">📉</span>
                        <strong>Headroom Compression Savings</strong>
                        {compressionStats?.headroom_available ? (
                          <span className="savings-badge active">Headroom Active</span>
                        ) : (
                          <span className="savings-badge fallback">Fallback Active</span>
                        )}
                      </div>
                      <div className="compression-stats-row">
                        <span className="savings-stat-pill highlight">
                          <strong>{(compressionStats?.tokens_saved || 0).toLocaleString()}</strong> tokens saved
                        </span>
                        <span className="savings-stat-pill spend">
                          <strong>{formatSpend(compressionStats?.estimated_dollars_saved || 0)}</strong> saved
                        </span>
                        <span className="savings-stat-pill">
                          <strong>{((compressionStats?.compression_ratio || 0) * 100).toFixed(1)}%</strong> avg ratio
                        </span>
                        <span className="savings-stat-pill muted">
                          {compressionStats?.total_queries || 0} queries processed
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="reset-stats-btn"
                      onClick={handleResetCompressionStats}
                      disabled={resettingCompressionStats}
                      title="Reset compression savings counters"
                    >
                      {resettingCompressionStats ? "Resetting..." : "Reset Stats"}
                    </button>
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
