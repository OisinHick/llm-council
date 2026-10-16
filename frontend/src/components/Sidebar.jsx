import { useState, useEffect } from "react";
import SettingsModal from "./SettingsModal";
import { formatShortNumber, formatSpend, formatExactSpend } from "../formatters";
import "./Sidebar.css";

export default function Sidebar({
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
  const [showSettings, setShowSettings] = useState(false);
  const [assistantColor, setAssistantColor] = useState(() => {
    return localStorage.getItem("llmCouncilColor") || "#f6f9ff";
  });
  const [userColor, setUserColor] = useState(() => {
    return localStorage.getItem("userColor") || "#f0f7ff";
  });

  // Apply colors on mount and state changes
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

  const handleResetColors = () => {
    setAssistantColor("#f6f9ff");
    setUserColor("#f0f7ff");
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
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? "active" : ""
              }`}
              onClick={() => onSelectConversation(conv.id)}
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
                      ? "⚡ One Shot"
                      : "💬 Info"}
                </span>
                <span className="conv-message-count">{conv.message_count} msgs</span>
                {showTokenCount && conv.token_usage?.total_tokens > 0 && (
                  <span
                    className="conv-token-tag"
                    title={`Total tokens: ${conv.token_usage.total_tokens.toLocaleString()} (Input: ${(conv.token_usage.prompt_tokens || 0).toLocaleString()} | Output: ${(conv.token_usage.completion_tokens || 0).toLocaleString()})${
                      conv.token_usage?.total_cost !== undefined ? ` · Est. Spend: ${formatExactSpend(conv.token_usage.total_cost)}` : ""
                    }${
                      showSavedTokens && conv.token_usage?.tokens_saved ? ` · Saved: ${conv.token_usage.tokens_saved.toLocaleString()} tokens` : ""
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
          ))
        )}
      </div>
    </div>
  );
}
