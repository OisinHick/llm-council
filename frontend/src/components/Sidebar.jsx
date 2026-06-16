import { useState, useEffect } from "react";
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
    document.documentElement.style.setProperty("--assistant-bg", assistantColor);
    localStorage.setItem("llmCouncilColor", assistantColor);
  }, [assistantColor]);

  useEffect(() => {
    document.documentElement.style.setProperty("--user-bg", userColor);
    localStorage.setItem("userColor", userColor);
  }, [userColor]);

  const handleAssistantColorChange = (e) => {
    setAssistantColor(e.target.value);
  };

  const handleUserColorChange = (e) => {
    setUserColor(e.target.value);
  };

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
          onClick={() => setShowSettings(!showSettings)}
          title="Appearance Settings"
        >
          ⚙️
        </button>
        {showSettings && (
          <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)}>
            <div className="settings-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="settings-modal-header">
                <h3>Appearance Settings</h3>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="close-settings-btn"
                >
                  ×
                </button>
              </div>
              <div className="settings-modal-body">
                <div className="settings-field">
                  <label>LLM Council Color</label>
                  <input 
                    type="color" 
                    value={assistantColor} 
                    onChange={handleAssistantColorChange} 
                  />
                </div>
                <div className="settings-field">
                  <label>User Message Color</label>
                  <input 
                    type="color" 
                    value={userColor} 
                    onChange={handleUserColorChange} 
                  />
                </div>
                <button 
                  type="button" 
                  className="reset-colors-btn" 
                  onClick={handleResetColors}
                >
                  Reset Defaults
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

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
