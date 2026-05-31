import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionPlanRequest, setActionPlanRequest] = useState('');
  const [actionPlanResult, setActionPlanResult] = useState(null);
  const [actionExecutionResult, setActionExecutionResult] = useState(null);
  const [actionStageResults, setActionStageResults] = useState({
    stage1: null,
    stage2: null,
    stage3: null,
    metadata: null,
  });
  const [actionStageLoading, setActionStageLoading] = useState({
    stage1: false,
    stage2: false,
    stage3: false,
    stage4: false,
    execution: false,
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const resetActionState = () => {
    setActionPlanRequest('');
    setActionPlanResult(null);
    setActionExecutionResult(null);
    setActionError(null);
    setActionStageResults({ stage1: null, stage2: null, stage3: null, metadata: null });
    setActionStageLoading({ stage1: false, stage2: false, stage3: false, stage4: false, execution: false });
    setActionLoading(false);
  };

  const handleNewConversation = async () => {
    try {
      resetActionState();
      setCurrentConversation(null);
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    if (id === currentConversationId) return;
    resetActionState();
    setCurrentConversation(null);
    setCurrentConversationId(id);
  };

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;

    setActionPlanResult(null);
    setActionExecutionResult(null);
    setActionPlanRequest('');
    setActionError(null);
    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(currentConversationId, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.loading.stage1 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = event.metadata;
              lastMsg.loading.stage2 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              lastMsg.loading.stage3 = false;
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            loadConversations();
            setIsLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  const handleGenerateActionPlan = async (requestText) => {
    if (!requestText.trim()) return;

    setActionLoading(true);
    setActionError(null);
    setActionPlanResult(null);
    setActionExecutionResult(null);
    setActionStageResults({ stage1: null, stage2: null, stage3: null, metadata: null });
    setActionStageLoading({ stage1: false, stage2: false, stage3: false, stage4: false, execution: false });
    setActionPlanRequest(requestText);

    try {
      await api.executeActionStream(requestText, false, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setActionStageLoading((prev) => ({ ...prev, stage1: true }));
            break;
          case 'stage1_complete':
            setActionStageResults((prev) => ({ ...prev, stage1: event.data }));
            setActionStageLoading((prev) => ({ ...prev, stage1: false }));
            break;
          case 'stage2_start':
            setActionStageLoading((prev) => ({ ...prev, stage2: true }));
            break;
          case 'stage2_complete':
            setActionStageResults((prev) => ({ ...prev, stage2: event.data, metadata: event.metadata }));
            setActionStageLoading((prev) => ({ ...prev, stage2: false }));
            break;
          case 'stage3_start':
            setActionStageLoading((prev) => ({ ...prev, stage3: true }));
            break;
          case 'stage3_complete':
            setActionStageResults((prev) => ({ ...prev, stage3: event.data }));
            setActionStageLoading((prev) => ({ ...prev, stage3: false }));
            break;
          case 'stage4_start':
            setActionStageLoading((prev) => ({ ...prev, stage4: true }));
            break;
          case 'stage4_action_plan':
            setActionStageLoading((prev) => ({ ...prev, stage4: false }));
            setActionPlanResult({ stage4_action_plan: event.data });
            break;
          case 'execution_start':
            setActionStageLoading((prev) => ({ ...prev, execution: true }));
            break;
          case 'execution_complete':
            setActionStageLoading((prev) => ({ ...prev, execution: false }));
            setActionExecutionResult(event.data);
            break;
          case 'complete':
            setActionLoading(false);
            break;
          case 'error':
            setActionLoading(false);
            setActionError(event.message);
            break;
          default:
            console.log('Unknown action stream event:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to generate action plan:', error);
      setActionError(error.message || 'Could not generate action plan');
      setActionLoading(false);
    }
  };

  const handleExecuteActionPlan = async () => {
    if (!actionPlanRequest) return;

    setActionLoading(true);
    setActionError(null);
    setActionExecutionResult(null);
    setActionStageLoading((prev) => ({ ...prev, execution: false }));

    try {
      await api.executeActionStream(actionPlanRequest, true, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setActionStageLoading((prev) => ({ ...prev, stage1: true }));
            break;
          case 'stage1_complete':
            setActionStageResults((prev) => ({ ...prev, stage1: event.data }));
            setActionStageLoading((prev) => ({ ...prev, stage1: false }));
            break;
          case 'stage2_start':
            setActionStageLoading((prev) => ({ ...prev, stage2: true }));
            break;
          case 'stage2_complete':
            setActionStageResults((prev) => ({ ...prev, stage2: event.data, metadata: event.metadata }));
            setActionStageLoading((prev) => ({ ...prev, stage2: false }));
            break;
          case 'stage3_start':
            setActionStageLoading((prev) => ({ ...prev, stage3: true }));
            break;
          case 'stage3_complete':
            setActionStageResults((prev) => ({ ...prev, stage3: event.data }));
            setActionStageLoading((prev) => ({ ...prev, stage3: false }));
            break;
          case 'stage4_start':
            setActionStageLoading((prev) => ({ ...prev, stage4: true }));
            break;
          case 'stage4_action_plan':
            setActionStageLoading((prev) => ({ ...prev, stage4: false }));
            setActionPlanResult({ stage4_action_plan: event.data });
            break;
          case 'execution_start':
            setActionStageLoading((prev) => ({ ...prev, execution: true }));
            break;
          case 'execution_complete':
            setActionStageLoading((prev) => ({ ...prev, execution: false }));
            setActionExecutionResult(event.data);
            break;
          case 'complete':
            setActionLoading(false);
            break;
          case 'error':
            setActionLoading(false);
            setActionError(event.message);
            break;
          default:
            console.log('Unknown action stream event:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to execute action plan:', error);
      setActionError(error.message || 'Could not execute action plan');
      setActionLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        onGenerateActionPlan={handleGenerateActionPlan}
        onExecuteActionPlan={handleExecuteActionPlan}
        actionPlanResult={actionPlanResult}
        actionExecutionResult={actionExecutionResult}
        actionStageResults={actionStageResults}
        actionStageLoading={actionStageLoading}
        actionLoading={actionLoading}
        actionError={actionError}
        actionPlanRequest={actionPlanRequest}
        isLoading={isLoading}
      />
    </div>
  );
}

export default App;
