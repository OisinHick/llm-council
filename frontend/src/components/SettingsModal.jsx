/**
 * SettingsModal Component: Configuration Dialog for LLM Council.
 *
 * This modal allows users to configure:
 * - Tab 1 (OpenRouter Models):
 *     - OpenRouter API Key input with visibility toggle and catalog test fetch.
 *     - Chairman Model selector (responsible for Stage 3 synthesis & Stage 4 action plans).
 *     - Selected Council Members tag list (with single-click removal).
 *     - OpenRouter Model Catalog search picker (with real-time filtering by name or vendor).
 * - Tab 2 (Display & Appearance):
 *     - Deliberation steps display: "Show all deliberation steps" vs "Just show final answer".
 *     - Conversation Token Counter toggle.
 *     - Granular per-model token breakdown toggle.
 *     - Estimated USD spend value toggle ($) with live dynamic OpenRouter rates.
 *     - Headroom Labs token compression toggle & saved tokens display badge.
 *     - Dynamic OpenRouter rates status card with manual refresh button.
 *     - Headroom compression savings metrics card with reset button.
 *     - Custom message background colors (assistant & user) with color picker and reset button.
 */

import { useState, useEffect } from "react";
import { api } from "../api";
import { formatSpend } from "../formatters";
import "./SettingsModal.css";

/**
 * Settings configuration modal dialog.
 *
 * @param {Object} props - Component properties.
 * @param {boolean} props.isOpen - Whether the modal dialog is rendered.
 * @param {function(): void} props.onClose - Callback invoked when the modal is dismissed.
 * @param {string} props.assistantColor - Hex color for assistant messages.
 * @param {function(string): void} props.setAssistantColor - Assistant color setter.
 * @param {string} props.userColor - Hex color for user messages.
 * @param {function(string): void} props.setUserColor - User color setter.
 * @param {function(): void} props.onResetColors - Resets message colors to defaults.
 * @param {boolean} [props.showAllDeliberationSteps=true] - Toggle for all steps vs final answer.
 * @param {function(boolean): void} [props.setShowAllDeliberationSteps] - Setter for deliberation steps.
 * @param {boolean} [props.showTokenCount=true] - Toggle for token counters.
 * @param {function(boolean): void} [props.setShowTokenCount] - Setter for token count.
 * @param {boolean} [props.showTokensPerModel=false] - Toggle for per-model token breakdown.
 * @param {function(boolean): void} [props.setShowTokensPerModel] - Setter for tokens per model.
 * @param {boolean} [props.showSpendValue=true] - Toggle for dollar spend display.
 * @param {function(boolean): void} [props.setShowSpendValue] - Setter for spend value.
 * @param {boolean} [props.showSavedTokens=true] - Toggle for saved tokens display.
 * @param {function(boolean): void} [props.setShowSavedTokens] - Setter for saved tokens.
 * @param {boolean} [props.enableTokenCompression=false] - Toggle for token compression.
 * @param {function(boolean): void} [props.setEnableTokenCompression] - Setter for compression toggle.
 * @returns {JSX.Element|null} Rendered modal or null if isOpen is false.
 */
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
  // Active navigation tab ("models" | "appearance")
  const [activeTab, setActiveTab] = useState("models");
  // OpenRouter API key input
  const [apiKey, setApiKey] = useState("");
  // Toggle password masking on API key input
  const [showApiKey, setShowApiKey] = useState(false);
  // List of selected council model IDs
  const [councilModels, setCouncilModels] = useState([]);
  // Input for adding arbitrary custom council models (e.g. gemini argon 4)
  const [customCouncilModel, setCustomCouncilModel] = useState("");
  // Selected Chairman model ID
  const [chairmanModel, setChairmanModel] = useState("");
  // Active compression algorithm (headroom, heuristic, or adaptive)
  const [compressionAlgorithm, setCompressionAlgorithm] = useState("headroom");
  // All available models fetched from OpenRouter
  const [availableModels, setAvailableModels] = useState([]);
  // Local staged toggle states before saving
  const [localShowTokenCount, setLocalShowTokenCount] = useState(showTokenCount);
  const [localShowTokensPerModel, setLocalShowTokensPerModel] = useState(showTokensPerModel);
  const [localShowSpendValue, setLocalShowSpendValue] = useState(showSpendValue);
  const [localShowSavedTokens, setLocalShowSavedTokens] = useState(showSavedTokens);
  const [localEnableTokenCompression, setLocalEnableTokenCompression] = useState(enableTokenCompression);
  // Dynamic OpenRouter pricing status info
  const [pricingInfo, setPricingInfo] = useState(null);
  const [refreshingPricing, setRefreshingPricing] = useState(false);
  // Cumulative compression savings stats
  const [compressionStats, setCompressionStats] = useState(null);
  const [resettingCompressionStats, setResettingCompressionStats] = useState(false);
  
  // Loading and status banners
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

  /**
   * Load active configuration settings, dynamic model pricing rates,
   * compression savings statistics, and available models from the backend.
   */
  async function loadInitialData() {
    setLoading(true);
    setStatusMessage(null);
    try {
      const settings = await api.getSettings();
      setApiKey(settings.openrouter_api_key || "");
      setCouncilModels(settings.council_models || []);
      setChairmanModel(settings.chairman_model || "");
      if (settings.compression_algorithm) {
        setCompressionAlgorithm(settings.compression_algorithm);
      }
      if (settings.show_all_deliberation_steps !== undefined && setShowAllDeliberationSteps) {
        setShowAllDeliberationSteps(Boolean(settings.show_all_deliberation_steps));
      }
      if (settings.assistant_color && setAssistantColor) {
        setAssistantColor(settings.assistant_color);
      }
      if (settings.user_color && setUserColor) {
        setUserColor(settings.user_color);
      }
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

  /**
   * Force refresh dynamic OpenRouter pricing rates and display confirmation banner.
   */
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

  /**
   * Reset cumulative compression savings counters (tokens, dollars, query counts) to zero.
   */
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

  /**
   * Fetch full OpenRouter models catalog using the provided or saved API key.
   *
   * @param {string} [keyToUse] - OpenRouter API key.
   */
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

  /**
   * Add an arbitrary custom model to the Council member list (e.g. gemini argon 4).
   */
  const handleAddCustomCouncilModel = () => {
    const trimmed = customCouncilModel.trim();
    if (!trimmed) return;
    if (!councilModels.includes(trimmed)) {
      setCouncilModels((prev) => [...prev, trimmed]);
      setStatusMessage({
        type: "success",
        text: `Added "${trimmed}" to Council Members.`,
      });
    } else {
      setStatusMessage({
        type: "error",
        text: `"${trimmed}" is already in Council Members.`,
      });
    }
    setCustomCouncilModel("");
  };

  /**
   * Toggle a model's inclusion in the Council member list.
   *
   * @param {string} modelId - Model identifier string.
   */
  const handleToggleCouncilModel = (modelId) => {
    setCouncilModels((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((id) => id !== modelId);
      } else {
        return [...prev, modelId];
      }
    });
  };

  /**
   * Remove a model from the Council member list.
   *
   * @param {string} modelId - Model identifier string.
   */
  const handleRemoveCouncilModel = (modelId) => {
    setCouncilModels((prev) => prev.filter((id) => id !== modelId));
  };

  /**
   * Validate selections and persist updated settings to backend storage and localStorage.
   */
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
        compression_algorithm: compressionAlgorithm || "headroom",
        show_all_deliberation_steps: showAllDeliberationSteps,
        assistant_color: assistantColor,
        user_color: userColor,
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
        localStorage.setItem(
          "llmCouncilShowAllSteps",
          JSON.stringify(showAllDeliberationSteps)
        );
        localStorage.setItem("llmCouncilColor", assistantColor);
        localStorage.setItem("userColor", userColor);
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
                    {/* Active custom chairman option if not in catalog or council */}
                    {chairmanModel &&
                      !availableModels.some((m) => m.id === chairmanModel) &&
                      !councilModels.includes(chairmanModel) && (
                        <option value={chairmanModel}>
                          {chairmanModel} (Active Chairman / Custom)
                        </option>
                      )}

                    {/* Council Models */}
                    {councilModels.length > 0 && (
                      <optgroup label="Council Members">
                        {councilModels.map((mId) => {
                          const matched = availableModels.find((m) => m.id === mId);
                          return (
                            <option key={`council-${mId}`} value={mId}>
                              {matched ? `${matched.name} (${matched.id})` : `${mId} (Council Member)`}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}

                    {/* Catalog Models */}
                    {availableModels.length > 0 && (
                      <optgroup label="OpenRouter Catalog">
                        {availableModels
                          .filter((m) => !councilModels.includes(m.id))
                          .map((m) => (
                            <option key={`catalog-${m.id}`} value={m.id}>
                              {m.name} ({m.id})
                            </option>
                          ))}
                      </optgroup>
                    )}

                    {availableModels.length === 0 && councilModels.length === 0 && (
                      <option value={chairmanModel}>{chairmanModel}</option>
                    )}
                  </select>
                  <div className="custom-chairman-input-row">
                    <input
                      type="text"
                      placeholder="Or enter custom Chairman model ID (e.g. gemini argon 4)..."
                      value={chairmanModel}
                      onChange={(e) => setChairmanModel(e.target.value)}
                      className="text-input custom-chairman-input"
                    />
                  </div>
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

                  {/* Add Custom Council Model Input */}
                  <div className="add-custom-model-row">
                    <input
                      type="text"
                      placeholder="Add custom model to council (e.g. gemini argon 4)..."
                      value={customCouncilModel}
                      onChange={(e) => setCustomCouncilModel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustomCouncilModel();
                        }
                      }}
                      className="text-input"
                    />
                    <button
                      type="button"
                      className="add-custom-btn"
                      onClick={handleAddCustomCouncilModel}
                      disabled={!customCouncilModel.trim()}
                    >
                      + Add to Council
                    </button>
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
