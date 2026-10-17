/**
 * Sidebar component for LLM Council navigation and conversation management.
 *
 * Responsibilities:
 * - Displays the application header and settings cog modal launcher.
 * - Manages conversation switching and creating new conversations.
 * - Renders conversation cards with title, message count, execution mode badge,
 *   token usage indicator, estimated USD spend, and Headroom compression savings.
 * - Persists and injects user-customizable CSS background color variables
 *   (`--assistant-bg` and `--user-bg`) into the root document style.
 */

import { useState, useEffect, memo } from "react";
import SettingsModal from "./SettingsModal";
import { api } from "../api";
import { formatShortNumber, formatSpend, formatExactSpend } from "../formatters";
import "./Sidebar.css";

/**
 * Individual memoized conversation card in sidebar.
 */
const ConversationItem = memo(function ConversationItem({
  conv,
  isActive,
  onSelect,
  showTokenCount,
  showSpendValue,
  showSavedTokens,
}) {
  return (
    <div
      className={`conversation-item ${isActive ? "active" : ""}`}
      onClick={() => onSelect(conv.id)}
    >
      <div className="conversation-title">
        {conv.title || "New Conversation"}
      </div>
      <div className="conversation-meta">
        <span
          className={`conv-mode-tag mode-${conv.mode || "informational"}`}
        >
          {conv.mode === "agentic"
            ? "🤖 Agentic"
            : conv.mode === "one_shot"
              ? "⚡ One Shot Execution"
              : conv.mode === "custom_workflows"
                ? "🔀 Workflow"
                : "💬 Info"}
        </span>
        <span className="conv-message-count">{conv.message_count} msgs</span>
        {showTokenCount && conv.token_usage?.total_tokens > 0 && (
          <span
            className="conv-token-tag"
            title={`Total tokens: ${conv.token_usage.total_tokens.toLocaleString()} (Input: ${(conv.token_usage.prompt_tokens || 0).toLocaleString()} | Output: ${(conv.token_usage.completion_tokens || 0).toLocaleString()})${
              conv.token_usage?.total_cost !== undefined ? ` · Est. Spend: ${formatExactSpend(conv.token_usage.total_cost)}` : ""
            }${
              showSavedTokens ? ` · Saved: ${(conv.token_usage?.tokens_saved || 0).toLocaleString()} tokens` : ""
            }${
              showSavedTokens && conv.token_usage?.total_cost_saved ? ` (${formatExactSpend(conv.token_usage.total_cost_saved)})` : ""
            }`}
          >
            🪙 {formatShortNumber(conv.token_usage.total_tokens)}
            {showSpendValue && conv.token_usage?.total_cost > 0 && (
              <span className="conv-token-spend"> · {formatSpend(conv.token_usage.total_cost)}</span>
            )}
            {showSavedTokens && conv.token_usage?.tokens_saved > 0 && (
              <span className="conv-token-saved" style={{ color: "#16a34a", fontWeight: 600 }}>
                {" "}· 🌱 {formatShortNumber(conv.token_usage.tokens_saved)}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
});

/**
 * Sidebar navigation component.
 *
 * @param {Object} props - Component properties.
 * @param {Array<Object>} props.conversations - List of all conversation summaries.
 * @param {string|null} props.currentConversationId - Active conversation ID.
 * @param {function(string): void} props.onSelectConversation - Callback when a conversation is clicked.
 * @param {function(): void} props.onNewConversation - Callback to initialize a new conversation.
 * @param {boolean} props.showAllDeliberationSteps - Toggle to display all deliberation stages vs only final answer.
 * @param {function(boolean): void} props.setShowAllDeliberationSteps - Setter for deliberation display preference.
 * @param {boolean} props.showTokenCount - Toggle to display token counters.
 * @param {function(boolean): void} props.setShowTokenCount - Setter for token count display preference.
 * @param {boolean} props.showTokensPerModel - Toggle to display per-model token breakdown.
 * @param {function(boolean): void} props.setShowTokensPerModel - Setter for per-model breakdown preference.
 * @param {boolean} props.showSpendValue - Toggle to display USD spend values.
 * @param {function(boolean): void} props.setShowSpendValue - Setter for spend value display preference.
 * @param {boolean} props.showSavedTokens - Toggle to display compression savings.
 * @param {function(boolean): void} props.setShowSavedTokens - Setter for saved tokens display preference.
 * @param {boolean} props.enableTokenCompression - Toggle for Headroom Labs compression.
 * @param {function(boolean): void} props.setEnableTokenCompression - Setter for compression configuration.
 * @returns {JSX.Element} Rendered Sidebar component.
 */
function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  showAllDeliberationSteps,
  setShowAllDeliberationSteps,
  showTokenCount,
  setShowTokenCount,
  showTokensPerModel,
  setShowTokensPerModel,
  showSpendValue,
  setShowSpendValue,
  showSavedTokens,
  setShowSavedTokens,
  enableTokenCompression,
  setEnableTokenCompression,
}) {
  // Modal visibility flag for SettingsModal
  const [showSettings, setShowSettings] = useState(false);
  // Custom response background color for assistant messages
  const [assistantColor, setAssistantColor] = useState(() => {
    return localStorage.getItem("llmCouncilColor") || "#f6f9ff";
  });
  // Custom message background color for user messages
  const [userColor, setUserColor] = useState(() => {
    return localStorage.getItem("userColor") || "#f0f7ff";
  });

  // Fetch persisted colors from backend settings on mount
  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        if (settings?.assistant_color) {
          setAssistantColor(settings.assistant_color);
        }
        if (settings?.user_color) {
          setUserColor(settings.user_color);
        }
      })
      .catch(() => {});
  }, []);

  // Apply colors on mount and state changes to CSS custom properties
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--assistant-bg",
      assistantColor
    );
    localStorage.setItem("llmCouncilColor", assistantColor);
  }, [assistantColor]);

  useEffect(() => {
    document.documentElement.style.setProperty("--user-bg", userColor);
    localStorage.setItem("userColor", userColor);
  }, [userColor]);

  /**
   * Reset message background colors to default pastel blue/slate hues.
   */
  const handleResetColors = () => {
    const defaultAssistant = "#f6f9ff";
    const defaultUser = "#f0f7ff";
    setAssistantColor(defaultAssistant);
    setUserColor(defaultUser);
    api
      .updateSettings({
        assistant_color: defaultAssistant,
        user_color: defaultUser,
      })
      .catch((err) => {
        console.warn("Failed to persist reset colors to backend:", err);
      });
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button
          type="button"
          className="settings-cog-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        assistantColor={assistantColor}
        setAssistantColor={setAssistantColor}
        userColor={userColor}
        setUserColor={setUserColor}
        onResetColors={handleResetColors}
        showAllDeliberationSteps={showAllDeliberationSteps}
        setShowAllDeliberationSteps={setShowAllDeliberationSteps}
        showTokenCount={showTokenCount}
        setShowTokenCount={setShowTokenCount}
        showTokensPerModel={showTokensPerModel}
        setShowTokensPerModel={setShowTokensPerModel}
        showSpendValue={showSpendValue}
        setShowSpendValue={setShowSpendValue}
        showSavedTokens={showSavedTokens}
        setShowSavedTokens={setShowSavedTokens}
        enableTokenCompression={enableTokenCompression}
        setEnableTokenCompression={setEnableTokenCompression}
      />

      <div className="conversation-list">
        <button
          className="new-conversation-btn"
          onClick={onNewConversation}
          style={{
            width: "100%",
            display: "block",
            boxSizing: "border-box",
            marginBottom: "10px",
          }}
        >
          + New Conversation
        </button>

        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={conv.id === currentConversationId}
              onSelect={onSelectConversation}
              showTokenCount={showTokenCount}
              showSpendValue={showSpendValue}
              showSavedTokens={showSavedTokens}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default memo(Sidebar);
