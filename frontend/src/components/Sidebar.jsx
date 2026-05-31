import { useState, useEffect } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  mode = 'conversation',
  onModeChange = () => {},
}) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
      </div>

      <div className="mode-switcher">
        <button
          className={`mode-btn ${mode === 'conversation' ? 'active' : ''}`}
          onClick={() => onModeChange('conversation')}
          title="Chat Mode: Ask the council questions"
        >
          💬 Chat
        </button>
        <button
          className={`mode-btn ${mode === 'action' ? 'active' : ''}`}
          onClick={() => onModeChange('action')}
          title="Action Mode: Council votes and executes tasks"
        >
          ⚙️ Action
        </button>
      </div>

      {mode === 'conversation' && (
        <>
          <button className="new-conversation-btn" onClick={onNewConversation}>
            + New Conversation
          </button>

          <div className="conversation-list">
            {conversations.length === 0 ? (
              <div className="no-conversations">No conversations yet</div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`conversation-item ${
                    conv.id === currentConversationId ? 'active' : ''
                  }`}
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <div className="conversation-title">
                    {conv.title || 'New Conversation'}
                  </div>
                  <div className="conversation-meta">
                    {conv.message_count} messages
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {mode === 'action' && (
        <div className="action-mode-info">
          <h3>Action Mode</h3>
          <p>
            Ask the council to perform a task. They will vote on the best approach, and then execute it.
          </p>
          <ul>
            <li>🤔 Council generates approaches</li>
            <li>🗳️ Members vote anonymously</li>
            <li>✨ Chairman synthesizes</li>
            <li>⚙️ Action plan executes</li>
          </ul>
        </div>
      )}
    </div>
  );
}
