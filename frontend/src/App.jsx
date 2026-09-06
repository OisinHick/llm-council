import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatInterface from "./components/ChatInterface";
import { api } from "./api";
import "./App.css";

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionPlanRequest, setActionPlanRequest] = useState("");
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
  const [councilModeState, setCouncilModeState] = useState(() => {
    try {
      const saved = localStorage.getItem("councilModeState");
      if (saved) return JSON.parse(saved);

      // Fallback migration from legacy toggle states
      const legacyAgent = localStorage.getItem("agentToggleState");
      const legacyAction = localStorage.getItem("generateActionPlanToggleState");
      const parsedAgent = legacyAgent ? JSON.parse(legacyAgent) : {};
      const parsedAction = legacyAction ? JSON.parse(legacyAction) : {};
      const migrated = {};
      const allKeys = new Set([
        ...Object.keys(parsedAgent),
        ...Object.keys(parsedAction),
      ]);
      allKeys.forEach((key) => {
        if (parsedAgent[key]) {
          migrated[key] = "agentic";
        } else if (parsedAction[key]) {
          migrated[key] = "one_shot";
        } else {
          migrated[key] = "informational";
        }
      });
      return migrated;
    } catch (e) {
      console.error("Failed to load council mode state from localStorage:", e);
      return {};
    }
  });
  const [pendingMode, setPendingMode] = useState("informational");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState(null);

  const syncActionStateFromConversation = (conversation) => {
    if (!conversation?.messages?.length) {
      resetActionState();
      return;
    }

    const actionMessage = [...conversation.messages]
      .reverse()
      .find(
        (msg) =>
          msg.role === "assistant" &&
          (msg.action_request || msg.stage4 || msg.execution),
      );

    if (!actionMessage) {
      resetActionState();
      return;
    }

    setActionPlanRequest(actionMessage.action_request || "");
    setActionPlanResult(
      actionMessage.stage4
        ? { stage4_action_plan: actionMessage.stage4 }
        : null,
    );
    setActionExecutionResult(actionMessage.execution || null);
    setActionStageResults({
      stage1: actionMessage.stage1 || null,
      stage2: actionMessage.stage2 || null,
      stage3: actionMessage.stage3 || null,
      metadata: actionMessage.metadata || null,
    });
    setActionStageLoading({
      stage1: false,
      stage2: false,
      stage3: false,
      stage4: false,
      execution: false,
    });
    setActionLoading(false);
    setActionError(null);
  };

  const appendActionRequestMessage = (requestText) => {
    if (!currentConversation) return;

    const userMessage = { role: "user", content: requestText };
    const assistantMessage = {
      role: "assistant",
      action_request: requestText,
      stage1: null,
      stage2: null,
      stage3: null,
      stage4: null,
      execution: null,
      metadata: null,
      loading: {
        stage1: false,
        stage2: false,
        stage3: false,
        stage4: false,
        execution: false,
      },
    };

    setCurrentConversation((prev) => ({
      ...prev,
      messages: [...(prev?.messages || []), userMessage, assistantMessage],
    }));
  };

  const updateLastActionMessage = (updater) => {
    setCurrentConversation((prev) => {
      if (!prev?.messages?.length) return prev;
      const messages = [...prev.messages];
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role !== "assistant" || !lastMsg.action_request) return prev;
      messages[messages.length - 1] = { ...lastMsg, ...updater(lastMsg) };
      return { ...prev, messages };
    });
  };

  async function loadConversations() {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
      setCouncilModeState((prev) => {
        const next = { ...prev };
        convs.forEach((c) => {
          if (c.mode && !next[c.id]) {
            next[c.id] = c.mode;
          }
        });
        return next;
      });
    } catch (error) {
      console.error("Failed to load conversations:", error);
    }
  }

  async function loadConversation(id) {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation((prev) => {
        if (prev?.id === id && prev?.messages?.length > conv.messages.length) {
          return { ...conv, messages: prev.messages };
        }
        return conv;
      });
      if (conv?.mode) {
        setCouncilModeState((prev) => {
          if (prev[id] === conv.mode) return prev;
          return { ...prev, [id]: conv.mode };
        });
      }
      syncActionStateFromConversation(conv);
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  }

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId && currentConversation?.id !== currentConversationId) {
      loadConversation(currentConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConversationId]);

  // Save council mode state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(
        "councilModeState",
        JSON.stringify(councilModeState),
      );
    } catch (e) {
      console.error("Failed to save council mode state to localStorage:", e);
    }
  }, [councilModeState]);

  const resetActionState = () => {
    setActionPlanRequest("");
    setActionPlanResult(null);
    setActionExecutionResult(null);
    setActionError(null);
    setActionStageResults({
      stage1: null,
      stage2: null,
      stage3: null,
      metadata: null,
    });
    setActionStageLoading({
      stage1: false,
      stage2: false,
      stage3: false,
      stage4: false,
      execution: false,
    });
    setActionLoading(false);
  };

  const activeMode = currentConversationId
    ? councilModeState[currentConversationId] || "informational"
    : pendingMode;

  const handleNewConversation = async () => {
    try {
      resetActionState();
      setCurrentConversation(null);
      const modeToUse = activeMode;
      const newConv = await api.createConversation(modeToUse);
      setConversations((prev) => [
        {
          id: newConv.id,
          created_at: newConv.created_at,
          title: "New Conversation",
          message_count: 0,
          mode: modeToUse,
        },
        ...prev,
      ]);
      setCurrentConversationId(newConv.id);
      setCurrentConversation({
        id: newConv.id,
        created_at: newConv.created_at,
        title: "New Conversation",
        mode: modeToUse,
        messages: [],
      });
      setCouncilModeState((prev) => ({
        ...prev,
        [newConv.id]: modeToUse,
      }));
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
  };

  const handleSelectConversation = (id) => {
    if (id === currentConversationId) return;
    resetActionState();
    setCurrentConversation(null);
    setCurrentConversationId(id);
  };

  const ensureActiveConversation = async () => {
    if (currentConversationId && currentConversation) {
      return currentConversationId;
    }
    resetActionState();
    const modeToUse = activeMode;
    const newConv = await api.createConversation(modeToUse);
    const convObj = {
      id: newConv.id,
      created_at: newConv.created_at,
      title: "New Conversation",
      mode: modeToUse,
      messages: [],
    };
    setConversations((prev) => [
      {
        id: newConv.id,
        created_at: newConv.created_at,
        title: "New Conversation",
        message_count: 0,
        mode: modeToUse,
      },
      ...prev,
    ]);
    setCurrentConversationId(newConv.id);
    setCurrentConversation(convObj);
    setCouncilModeState((prev) => ({
      ...prev,
      [newConv.id]: modeToUse,
    }));
    return newConv.id;
  };

  const handleSendMessage = async (content) => {
    if (!content.trim()) return;

    setActionPlanResult(null);
    setActionExecutionResult(null);
    setActionPlanRequest("");
    setActionError(null);
    setIsLoading(true);
    try {
      let activeId = currentConversationId;
      if (!activeId || !currentConversation) {
        activeId = await ensureActiveConversation();
      }

      // Optimistically add user message to UI
      const userMessage = { role: "user", content };
      const assistantMessage = {
        role: "assistant",
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

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...(prev?.messages || []), userMessage, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(
        activeId,
        content,
        (eventType, event) => {
          switch (eventType) {
            case "stage1_start":
              setCurrentConversation((prev) => {
                if (!prev?.messages?.length) return prev;
                const messages = [...prev.messages];
                const lastIdx = messages.length - 1;
                if (messages[lastIdx]?.role !== "assistant") return prev;
                messages[lastIdx] = {
                  ...messages[lastIdx],
                  loading: { ...(messages[lastIdx].loading || {}), stage1: true },
                };
                return { ...prev, messages };
              });
              break;

            case "stage1_complete":
              setCurrentConversation((prev) => {
                if (!prev?.messages?.length) return prev;
                const messages = [...prev.messages];
                const lastIdx = messages.length - 1;
                if (messages[lastIdx]?.role !== "assistant") return prev;
                messages[lastIdx] = {
                  ...messages[lastIdx],
                  stage1: event.data,
                  loading: { ...(messages[lastIdx].loading || {}), stage1: false },
                };
                return { ...prev, messages };
              });
              break;

            case "stage2_start":
              setCurrentConversation((prev) => {
                if (!prev?.messages?.length) return prev;
                const messages = [...prev.messages];
                const lastIdx = messages.length - 1;
                if (messages[lastIdx]?.role !== "assistant") return prev;
                messages[lastIdx] = {
                  ...messages[lastIdx],
                  loading: { ...(messages[lastIdx].loading || {}), stage2: true },
                };
                return { ...prev, messages };
              });
              break;

            case "stage2_complete":
              setCurrentConversation((prev) => {
                if (!prev?.messages?.length) return prev;
                const messages = [...prev.messages];
                const lastIdx = messages.length - 1;
                if (messages[lastIdx]?.role !== "assistant") return prev;
                messages[lastIdx] = {
                  ...messages[lastIdx],
                  stage2: event.data,
                  metadata: event.metadata,
                  loading: { ...(messages[lastIdx].loading || {}), stage2: false },
                };
                return { ...prev, messages };
              });
              break;

            case "stage3_start":
              setCurrentConversation((prev) => {
                if (!prev?.messages?.length) return prev;
                const messages = [...prev.messages];
                const lastIdx = messages.length - 1;
                if (messages[lastIdx]?.role !== "assistant") return prev;
                messages[lastIdx] = {
                  ...messages[lastIdx],
                  loading: { ...(messages[lastIdx].loading || {}), stage3: true },
                };
                return { ...prev, messages };
              });
              break;

            case "stage3_complete":
              setCurrentConversation((prev) => {
                if (!prev?.messages?.length) return prev;
                const messages = [...prev.messages];
                const lastIdx = messages.length - 1;
                if (messages[lastIdx]?.role !== "assistant") return prev;
                messages[lastIdx] = {
                  ...messages[lastIdx],
                  stage3: event.data,
                  loading: { ...(messages[lastIdx].loading || {}), stage3: false },
                };
                return { ...prev, messages };
              });
              break;

            case "title_complete":
              // Reload conversations to get updated title
              loadConversations();
              break;

            case "complete":
              // Stream complete, reload conversations list
              loadConversations();
              setIsLoading(false);
              break;

            case "error":
              console.error("Stream error:", event.message);
              setIsLoading(false);
              break;

            default:
              console.log("Unknown event type:", eventType);
          }
        },
      );
    } catch (error) {
      console.error("Failed to send message:", error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => {
        if (!prev?.messages?.length) return prev;
        return {
          ...prev,
          messages: prev.messages.slice(0, -2),
        };
      });
      setIsLoading(false);
    }
  };

  const handleGenerateActionPlan = async (requestText) => {
    if (!requestText.trim()) return;

    setActionLoading(true);
    setActionError(null);
    setActionPlanResult(null);
    setActionExecutionResult(null);
    setActionStageResults({
      stage1: null,
      stage2: null,
      stage3: null,
      metadata: null,
    });
    setActionStageLoading({
      stage1: false,
      stage2: false,
      stage3: false,
      stage4: false,
      execution: false,
    });
    setActionPlanRequest(requestText);

    let activeId = currentConversationId;
    if (!activeId || !currentConversation) {
      try {
        activeId = await ensureActiveConversation();
      } catch (error) {
        console.error("Failed to create conversation:", error);
        setActionError("Could not create conversation");
        setActionLoading(false);
        return;
      }
    }

    appendActionRequestMessage(requestText);

    try {
      await api.executeActionStream(
        requestText,
        false,
        (eventType, event) => {
          switch (eventType) {
            case "stage1_start":
              updateLastActionMessage((lastMsg) => ({
                loading: { ...lastMsg.loading, stage1: true },
              }));
              setActionStageLoading((prev) => ({ ...prev, stage1: true }));
              break;
            case "stage1_complete":
              updateLastActionMessage((lastMsg) => ({
                stage1: event.data,
                loading: { ...lastMsg.loading, stage1: false },
              }));
              setActionStageResults((prev) => ({
                ...prev,
                stage1: event.data,
              }));
              setActionStageLoading((prev) => ({ ...prev, stage1: false }));
              break;
            case "stage2_start":
              updateLastActionMessage((lastMsg) => ({
                loading: { ...lastMsg.loading, stage2: true },
              }));
              setActionStageLoading((prev) => ({ ...prev, stage2: true }));
              break;
            case "stage2_complete":
              updateLastActionMessage((lastMsg) => ({
                stage2: event.data,
                metadata: event.metadata,
                loading: { ...lastMsg.loading, stage2: false },
              }));
              setActionStageResults((prev) => ({
                ...prev,
                stage2: event.data,
                metadata: event.metadata,
              }));
              setActionStageLoading((prev) => ({ ...prev, stage2: false }));
              break;
            case "stage3_start":
              updateLastActionMessage((lastMsg) => ({
                loading: { ...lastMsg.loading, stage3: true },
              }));
              setActionStageLoading((prev) => ({ ...prev, stage3: true }));
              break;
            case "stage3_complete":
              updateLastActionMessage((lastMsg) => ({
                stage3: event.data,
                loading: { ...lastMsg.loading, stage3: false },
              }));
              setActionStageResults((prev) => ({
                ...prev,
                stage3: event.data,
              }));
              setActionStageLoading((prev) => ({ ...prev, stage3: false }));
              break;
            case "stage4_start":
              updateLastActionMessage((lastMsg) => ({
                loading: { ...lastMsg.loading, stage4: true },
              }));
              setActionStageLoading((prev) => ({ ...prev, stage4: true }));
              break;
            case "stage4_action_plan":
              updateLastActionMessage((lastMsg) => ({
                stage4: event.data,
                loading: { ...lastMsg.loading, stage4: false },
              }));
              setActionStageLoading((prev) => ({ ...prev, stage4: false }));
              setActionPlanResult({ stage4_action_plan: event.data });
              break;
            case "execution_start":
              updateLastActionMessage((lastMsg) => ({
                loading: { ...lastMsg.loading, execution: true },
              }));
              setActionStageLoading((prev) => ({ ...prev, execution: true }));
              break;
            case "execution_complete":
              updateLastActionMessage((lastMsg) => ({
                execution: event.data,
                loading: { ...lastMsg.loading, execution: false },
              }));
              setActionExecutionResult(event.data);
              setActionStageLoading((prev) => ({ ...prev, execution: false }));
              break;
            case "complete":
              setActionLoading(false);
              loadConversations();
              break;
            case "error":
              setActionLoading(false);
              setActionError(event.message);
              break;
            default:
              console.log("Unknown action stream event:", eventType);
          }
        },
        activeId,
      );
    } catch (error) {
      console.error("Failed to generate action plan:", error);
      setActionError(error.message || "Could not generate action plan");
      setActionLoading(false);
    }
  };

  const handleModeChange = async (mode) => {
    setPendingMode(mode);
    if (currentConversationId) {
      setCouncilModeState((prev) => ({
        ...prev,
        [currentConversationId]: mode,
      }));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConversationId ? { ...c, mode } : c,
        ),
      );
      try {
        await api.updateConversationMode(currentConversationId, mode);
      } catch (err) {
        console.warn("Failed to persist conversation mode to backend:", err);
      }
    }
  };

  const handleRunAgent = async (requestText) => {
    if (!requestText.trim()) return;

    setAgentLoading(true);
    setAgentError(null);

    let activeId = currentConversationId;
    if (!activeId || !currentConversation) {
      try {
        activeId = await ensureActiveConversation();
      } catch (error) {
        console.error("Failed to create conversation:", error);
        setAgentError("Could not create conversation");
        setAgentLoading(false);
        return;
      }
    }

    const userMessage = { role: "user", content: requestText };
    const agentAssistantMessage = {
      role: "assistant",
      type: "agent",
      action_request: requestText,
      initial_council: {
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
      },
      steps: [],
      artifacts: [],
      summary: null,
      error: null,
      status: "running",
      isRunning: true,
    };

    setCurrentConversation((prev) => ({
      ...prev,
      messages: [...(prev?.messages || []), userMessage, agentAssistantMessage],
    }));

    const updateCurrentAgentMessage = (updater) => {
      setCurrentConversation((prev) => {
        if (!prev?.messages?.length) return prev;
        const messages = [...prev.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx]?.role !== "assistant") return prev;
        messages[lastIdx] = updater(messages[lastIdx]);
        return { ...prev, messages };
      });
    };

    try {
      await api.runAgentStream(
        requestText,
        activeId,
        (eventType, event) => {
          switch (eventType) {
            case "stage1_start":
              break;
            case "stage1_complete":
              updateCurrentAgentMessage((msg) => ({
                ...msg,
                initial_council: {
                  ...msg.initial_council,
                  stage1: event.data,
                },
              }));
              break;
            case "stage2_start":
              break;
            case "stage2_complete":
              updateCurrentAgentMessage((msg) => ({
                ...msg,
                initial_council: {
                  ...msg.initial_council,
                  stage2: event.data,
                  metadata: event.metadata,
                },
              }));
              break;
            case "stage3_start":
              break;
            case "stage3_complete":
              updateCurrentAgentMessage((msg) => ({
                ...msg,
                initial_council: {
                  ...msg.initial_council,
                  stage3: event.data,
                },
              }));
              break;
            case "agent_thought":
              updateCurrentAgentMessage((msg) => {
                const steps = [...(msg.steps || [])];
                const existingIdx = steps.findIndex(
                  (s) => s.step === event.data.step,
                );
                const stepObj = {
                  step: event.data.step,
                  thought: event.data.thought,
                  action: event.data.action,
                  params: event.data.params,
                  observation: null,
                  council_consultation: null,
                };
                if (existingIdx >= 0) {
                  steps[existingIdx] = { ...steps[existingIdx], ...stepObj };
                } else {
                  steps.push(stepObj);
                }
                return { ...msg, steps };
              });
              break;
            case "consult_council_complete":
              updateCurrentAgentMessage((msg) => {
                const steps = [...(msg.steps || [])];
                const existingIdx = steps.findIndex(
                  (s) => s.step === event.data.step,
                );
                if (existingIdx >= 0) {
                  steps[existingIdx] = {
                    ...steps[existingIdx],
                    council_consultation: event.data.council_data,
                  };
                }
                return { ...msg, steps };
              });
              break;
            case "agent_tool_result":
              updateCurrentAgentMessage((msg) => {
                const steps = [...(msg.steps || [])];
                const existingIdx = steps.findIndex(
                  (s) => s.step === event.data.step,
                );
                if (existingIdx >= 0) {
                  steps[existingIdx] = {
                    ...steps[existingIdx],
                    observation: event.data.observation,
                  };
                }
                const newArtifacts = [...(msg.artifacts || [])];
                if (
                  (event.data.action === "write_file" ||
                    event.data.action === "edit_file") &&
                  event.data.observation?.success
                ) {
                  const p =
                    steps[existingIdx]?.params?.path ||
                    event.data.observation?.path;
                  if (p && !newArtifacts.includes(p)) newArtifacts.push(p);
                }
                return { ...msg, steps, artifacts: newArtifacts };
              });
              break;
            case "agent_complete":
              updateCurrentAgentMessage((msg) => ({
                ...msg,
                status: "completed",
                isRunning: false,
                summary: event.data.summary,
                artifacts: event.data.artifacts || msg.artifacts,
              }));
              setAgentLoading(false);
              loadConversations();
              break;
            case "agent_cancelled":
              updateCurrentAgentMessage((msg) => ({
                ...msg,
                status: "cancelled",
                isRunning: false,
                error: event.data.message || "Agent cancelled by user.",
              }));
              setAgentLoading(false);
              break;
            case "agent_error":
              updateCurrentAgentMessage((msg) => ({
                ...msg,
                status: "failed",
                isRunning: false,
                error: event.data.error,
              }));
              setAgentLoading(false);
              setAgentError(event.data.error);
              break;
            case "title_complete":
              loadConversations();
              break;
            case "complete":
              setAgentLoading(false);
              loadConversations();
              break;
            case "error":
              setAgentLoading(false);
              setAgentError(event.message);
              updateCurrentAgentMessage((msg) => ({
                ...msg,
                status: "failed",
                isRunning: false,
                error: event.message,
              }));
              break;
            default:
              console.log("Agent event:", eventType, event);
          }
        },
      );
    } catch (err) {
      console.error("Agent run error:", err);
      setAgentError(err.message || "Failed to run agent");
      setAgentLoading(false);
      updateCurrentAgentMessage((msg) => ({
        ...msg,
        status: "failed",
        isRunning: false,
        error: err.message,
      }));
    }
  };

  const handleCancelAgent = async () => {
    if (!currentConversationId) return;
    try {
      await api.cancelAgent(currentConversationId);
    } catch (err) {
      console.error("Failed to cancel agent:", err);
    }
  };

  const handleExecuteActionPlan = async () => {
    if (!actionPlanRequest || !currentConversationId) return;

    setActionLoading(true);
    setActionError(null);
    setActionExecutionResult(null);
    setActionStageLoading((prev) => ({ ...prev, execution: false }));

    try {
      let executeStream;
      if (actionPlanResult?.stage4_action_plan) {
        executeStream = api.executeStoredActionPlanStream(
          currentConversationId,
          (eventType, event) => {
            switch (eventType) {
              case "execution_start":
                updateLastActionMessage((lastMsg) => ({
                  loading: { ...lastMsg.loading, execution: true },
                }));
                setActionStageLoading((prev) => ({ ...prev, execution: true }));
                break;
              case "execution_complete":
                updateLastActionMessage((lastMsg) => ({
                  execution: event.data,
                  loading: { ...lastMsg.loading, execution: false },
                }));
                setActionExecutionResult(event.data);
                setActionStageLoading((prev) => ({
                  ...prev,
                  execution: false,
                }));
                break;
              case "complete":
                setActionLoading(false);
                loadConversations();
                break;
              case "error":
                setActionLoading(false);
                setActionError(event.message);
                break;
              default:
                console.log("Unknown action stream event:", eventType);
            }
          },
        );
      } else {
        executeStream = api.executeActionStream(
          actionPlanRequest,
          true,
          (eventType, event) => {
            switch (eventType) {
              case "stage1_start":
                updateLastActionMessage((lastMsg) => ({
                  loading: { ...lastMsg.loading, stage1: true },
                }));
                setActionStageLoading((prev) => ({ ...prev, stage1: true }));
                break;
              case "stage1_complete":
                updateLastActionMessage((lastMsg) => ({
                  stage1: event.data,
                  loading: { ...lastMsg.loading, stage1: false },
                }));
                setActionStageResults((prev) => ({
                  ...prev,
                  stage1: event.data,
                }));
                setActionStageLoading((prev) => ({ ...prev, stage1: false }));
                break;
              case "stage2_start":
                updateLastActionMessage((lastMsg) => ({
                  loading: { ...lastMsg.loading, stage2: true },
                }));
                setActionStageLoading((prev) => ({ ...prev, stage2: true }));
                break;
              case "stage2_complete":
                updateLastActionMessage((lastMsg) => ({
                  stage2: event.data,
                  metadata: event.metadata,
                  loading: { ...lastMsg.loading, stage2: false },
                }));
                setActionStageResults((prev) => ({
                  ...prev,
                  stage2: event.data,
                  metadata: event.metadata,
                }));
                setActionStageLoading((prev) => ({ ...prev, stage2: false }));
                break;
              case "stage3_start":
                updateLastActionMessage((lastMsg) => ({
                  loading: { ...lastMsg.loading, stage3: true },
                }));
                setActionStageLoading((prev) => ({ ...prev, stage3: true }));
                break;
              case "stage3_complete":
                updateLastActionMessage((lastMsg) => ({
                  stage3: event.data,
                  loading: { ...lastMsg.loading, stage3: false },
                }));
                setActionStageResults((prev) => ({
                  ...prev,
                  stage3: event.data,
                }));
                setActionStageLoading((prev) => ({ ...prev, stage3: false }));
                break;
              case "stage4_start":
                updateLastActionMessage((lastMsg) => ({
                  loading: { ...lastMsg.loading, stage4: true },
                }));
                setActionStageLoading((prev) => ({ ...prev, stage4: true }));
                break;
              case "stage4_action_plan":
                updateLastActionMessage((lastMsg) => ({
                  stage4: event.data,
                  loading: { ...lastMsg.loading, stage4: false },
                }));
                setActionStageLoading((prev) => ({ ...prev, stage4: false }));
                setActionPlanResult({ stage4_action_plan: event.data });
                break;
              case "execution_start":
                updateLastActionMessage((lastMsg) => ({
                  loading: { ...lastMsg.loading, execution: true },
                }));
                setActionStageLoading((prev) => ({ ...prev, execution: true }));
                break;
              case "execution_complete":
                updateLastActionMessage((lastMsg) => ({
                  execution: event.data,
                  loading: { ...lastMsg.loading, execution: false },
                }));
                setActionExecutionResult(event.data);
                setActionStageLoading((prev) => ({
                  ...prev,
                  execution: false,
                }));
                break;
              case "complete":
                setActionLoading(false);
                loadConversations();
                break;
              case "error":
                setActionLoading(false);
                setActionError(event.message);
                break;
              default:
                console.log("Unknown action stream event:", eventType);
            }
          },
          currentConversationId,
        );
      }

      await executeStream;
    } catch (error) {
      console.error("Failed to execute action plan:", error);
      setActionError(error.message || "Could not execute action plan");
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
        mode={activeMode}
        onModeChange={handleModeChange}
        onSendMessage={handleSendMessage}
        onGenerateActionPlan={handleGenerateActionPlan}
        onExecuteActionPlan={handleExecuteActionPlan}
        onRunAgent={handleRunAgent}
        onCancelAgent={handleCancelAgent}
        agentLoading={agentLoading}
        agentError={agentError}
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
