import { useState, useEffect } from "react";
import SettingsModal from "./SettingsModal";
import "./Sidebar.css";

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
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
                {conv.message_count} messages
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
