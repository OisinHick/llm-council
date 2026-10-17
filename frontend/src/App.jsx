/**
 * Main application component for LLM Council.
 *
 * Architecture and responsibilities:
 * - Conversation Management: Manages active and historical conversations, lazy-loading details on demand.
 * - Mode Routing: Orchestrates three distinct operational modes:
 *     1. `informational`: Standard 3-stage multi-model council deliberation (Proposals -> Peer Review -> Synthesis).
 *     2. `one_shot`: Single-turn action plan generation via Council Chairman with tool execution.
 *     3. `agentic`: Autonomous multi-step ReAct loop with iterative tool execution, observation, and sub-councils.
 * - Real-Time Streaming: Consumes Server-Sent Events (SSE) from the backend, progressively updating UI state.
 * - Preference Persistence: Stores user display preferences (token counters, model spend, deliberation steps)
 *   in `localStorage` and synchronizes with server settings.
 */

import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatInterface from "./components/ChatInterface";
import WorkflowSelectorModal from "./components/WorkflowSelectorModal";
import WorkflowEditorModal from "./components/WorkflowEditorModal";
import { api } from "./api";
import "./App.css";

/**
 * Root Application component.
 *
 * @returns {JSX.Element} The rendered LLM Council application.
 */
function App() {
  // List of all conversations with summary metadata for the sidebar
  const [conversations, setConversations] = useState([]);
  // Currently active conversation ID
  const [currentConversationId, setCurrentConversationId] = useState(null);
  // Full detail object for the currently selected conversation (including messages array and token usage)
  const [currentConversation, setCurrentConversation] = useState(null);
  // Loading flag for informational message streaming
  const [isLoading, setIsLoading] = useState(false);

  // --- One-Shot Action Mode State ---
  // The raw prompt text for the action plan
  const [actionPlanRequest, setActionPlanRequest] = useState("");
  // Generated Stage 4 action plan structure
  const [actionPlanResult, setActionPlanResult] = useState(null);
  // Result payload from tool execution
  const [actionExecutionResult, setActionExecutionResult] = useState(null);
  // Results for intermediate stages (1 to 3) during one-shot planning
  const [actionStageResults, setActionStageResults] = useState({
    stage1: null,
    stage2: null,
    stage3: null,
    metadata: null,
  });
  // Loading indicators for individual stages in one-shot mode
  const [actionStageLoading, setActionStageLoading] = useState({
    stage1: false,
    stage2: false,
    stage3: false,
    stage4: false,
    execution: false,
  });
  // Overall loading indicator for action plan generation/execution
  const [actionLoading, setActionLoading] = useState(false);
  // Error message for action plan operations
  const [actionError, setActionError] = useState(null);

  // --- Mode State & Migration ---
  // Map of conversationId -> mode ("informational" | "one_shot" | "agentic")
  const [councilModeState, setCouncilModeState] = useState(() => {
    try {
      const saved = localStorage.getItem("councilModeState");
      if (saved) return JSON.parse(saved);

      // Fallback migration from legacy boolean toggle states (agentToggleState / generateActionPlanToggleState)
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

  // Default mode for a new unsaved conversation before messages are sent
  const [pendingMode, setPendingMode] = useState("informational");

  // Display preference: Show all 3 deliberation steps vs. only the final Chairman answer
  const [showAllDeliberationSteps, setShowAllDeliberationSteps] = useState(() => {
    try {
      const saved = localStorage.getItem("llmCouncilShowAllSteps");
      if (saved !== null) return JSON.parse(saved);
      return true;
    } catch {
      return true;
    }
  });

  // Display preference: Show total tokens badge in header and list
  const [showTokenCount, setShowTokenCount] = useState(() => {
    try {
      const saved = localStorage.getItem("llmCouncilShowTokenCount");
      if (saved !== null) return JSON.parse(saved);
      return true;
    } catch {
      return true;
    }
  });

  // Display preference: Show granular per-model token breakdown
  const [showTokensPerModel, setShowTokensPerModel] = useState(() => {
    try {
      const saved = localStorage.getItem("llmCouncilShowTokensPerModel");
      if (saved !== null) return JSON.parse(saved);
      return false;
    } catch {
      return false;
    }
  });

  // Display preference: Show estimated USD spend values alongside tokens
  const [showSpendValue, setShowSpendValue] = useState(() => {
    try {
      const saved = localStorage.getItem("llmCouncilShowSpendValue");
      if (saved !== null) return JSON.parse(saved);
      return true;
    } catch {
      return true;
    }
  });

  // Display preference: Show tokens and cost saved by Headroom compression
  const [showSavedTokens, setShowSavedTokens] = useState(() => {
    try {
      const saved = localStorage.getItem("llmCouncilShowSavedTokens");
      if (saved !== null) return JSON.parse(saved);
      return true;
    } catch {
      return true;
    }
  });

  // Configuration preference: Enable prompt token compression via Headroom Labs
  const [enableTokenCompression, setEnableTokenCompression] = useState(() => {
    try {
      const saved = localStorage.getItem("llmCouncilEnableTokenCompression");
      if (saved !== null) return JSON.parse(saved);
      return false;
    } catch {
      return false;
    }
  });

  // Loading flag for autonomous ReAct agent execution
  const [agentLoading, setAgentLoading] = useState(false);
  // Error string from agent execution failure
  const [agentError, setAgentError] = useState(null);

  // Custom Workflows state
  const [activeWorkflow, setActiveWorkflow] = useState(null);
  const [showWorkflowSelector, setShowWorkflowSelector] = useState(false);
  const [showWorkflowEditor, setShowWorkflowEditor] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);

  // Load workflows on mount and select default template
  useEffect(() => {
    let isMounted = true;
    api
      .getWorkflows()
      .then((wfs) => {
        if (isMounted && wfs && wfs.length > 0) {
          setActiveWorkflow((prev) => (prev ? prev : wfs[0]));
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Sync display preferences to localStorage whenever changed
  useEffect(() => {
    try {
      localStorage.setItem(
        "llmCouncilShowAllSteps",
        JSON.stringify(showAllDeliberationSteps),
      );
    } catch (e) {
      console.error("Failed to save deliberation steps display preference:", e);
    }
  }, [showAllDeliberationSteps]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "llmCouncilShowTokenCount",
        JSON.stringify(showTokenCount),
      );
    } catch (e) {
      console.error("Failed to save token count preference:", e);
    }
  }, [showTokenCount]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "llmCouncilShowTokensPerModel",
        JSON.stringify(showTokensPerModel),
      );
    } catch (e) {
      console.error("Failed to save tokens per model preference:", e);
    }
  }, [showTokensPerModel]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "llmCouncilShowSpendValue",
        JSON.stringify(showSpendValue),
      );
    } catch (e) {
      console.error("Failed to save spend value preference:", e);
    }
  }, [showSpendValue]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "llmCouncilShowSavedTokens",
        JSON.stringify(showSavedTokens),
      );
    } catch (e) {
      console.error("Failed to save show saved tokens preference:", e);
    }
  }, [showSavedTokens]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "llmCouncilEnableTokenCompression",
        JSON.stringify(enableTokenCompression),
      );
    } catch (e) {
      console.error("Failed to save token compression preference:", e);
    }
  }, [enableTokenCompression]);

  /**
   * Synchronize local action plan and execution state from an existing conversation record.
   *
   * Scans the conversation's messages in reverse to find the most recent action message
   * (containing `action_request`, `stage4`, or `execution`). If found, populates
   * `actionPlanRequest`, `actionPlanResult`, `actionExecutionResult`, and stage states.
   *
   * @param {Object|null} conversation - The loaded conversation object or null.
   */
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

  /**
   * Optimistically append a user action request and empty assistant response pair to conversation state.
   *
   * @param {string} requestText - Prompt instruction for action plan generation.
   */
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

  /**
   * Immutably update fields on the most recent action message in current conversation.
   *
   * @param {function(Object): Object} updater - Transformation function receiving current message
   *   and returning partial patch object.
   */
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

  /**
   * Fetch all conversation summaries from backend and update local list and mode mapping.
   *
   * @returns {Promise<void>}
   */
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

  /**
   * Fetch full conversation details by ID, preserving unpersisted optimistic messages.
   *
   * @param {string} id - Unique conversation ID.
   * @returns {Promise<void>}
   */
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
          if (prev[id]) return prev;
          return { ...prev, [id]: conv.mode };
        });
      }
      syncActionStateFromConversation(conv);
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  }

  /**
   * Reusable event handler for one-shot action stream SSE events.
   * Handles stage transitions, action plan generation, tool execution, and token accumulation.
   */
  const handleActionStreamEvent = (eventType, event, targetConvId) => {
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
        if (targetConvId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetConvId
                ? {
                    ...c,
                    mode: "one_shot",
                    token_usage: event.token_usage || c.token_usage,
                  }
                : c,
            ),
          );
          setCurrentConversation((prev) =>
            prev?.id === targetConvId
              ? {
                  ...prev,
                  mode: "one_shot",
                  token_usage: event.token_usage || prev.token_usage,
                }
              : prev,
          );
        }
        setActionLoading(false);
        loadConversations();
        break;
      case "error":
        setActionLoading(false);
        setActionError(event.message);
        break;
      default:
        console.log("Unknown action stream event:", eventType);
        break;
    }
  };

  // Load conversations and settings on mount
  useEffect(() => {
    loadConversations();
    api
      .getSettings()
      .then((settings) => {
        if (settings?.show_all_deliberation_steps !== undefined) {
          setShowAllDeliberationSteps(Boolean(settings.show_all_deliberation_steps));
        }
        if (settings?.show_token_count !== undefined) {
          setShowTokenCount(Boolean(settings.show_token_count));
        }
        if (settings?.show_tokens_per_model !== undefined) {
          setShowTokensPerModel(Boolean(settings.show_tokens_per_model));
        }
        if (settings?.show_spend_value !== undefined) {
          setShowSpendValue(Boolean(settings.show_spend_value));
        }
        if (settings?.show_saved_tokens !== undefined) {
          setShowSavedTokens(Boolean(settings.show_saved_tokens));
        }
        if (settings?.enable_token_compression !== undefined) {
          setEnableTokenCompression(Boolean(settings.enable_token_compression));
        }
        if (settings?.default_mode) {
          setPendingMode(settings.default_mode);
        }
        if (settings?.assistant_color) {
          document.documentElement.style.setProperty(
            "--assistant-bg",
            settings.assistant_color
          );
          try {
            localStorage.setItem("llmCouncilColor", settings.assistant_color);
          } catch {
            // ignore
          }
        }
        if (settings?.user_color) {
          document.documentElement.style.setProperty(
            "--user-bg",
            settings.user_color
          );
          try {
            localStorage.setItem("userColor", settings.user_color);
          } catch {
            // ignore
          }
        }
        if (settings?.sensitivity_config) {
          try {
            localStorage.setItem(
              "llm_council_deliberation_sensitivity",
              JSON.stringify(settings.sensitivity_config)
            );
          } catch {
            // ignore
          }
        }
      })
      .catch((err) => {
        console.warn("Failed to load initial settings from server:", err);
      });

    // Periodically refresh conversation list and spend calculations in background (every 10 minutes)
    const interval = setInterval(() => {
      loadConversations();
    }, 600000);
    return () => clearInterval(interval);
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

  /**
   * Reset all local one-shot action plan states, loading flags, and error messages.
   */
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

  /**
   * Current active conversation mode:
   * Uses the mode bound to the current conversation ID if active,
   * otherwise defaults to `pendingMode`.
   */
  const activeMode = currentConversationId
    ? councilModeState[currentConversationId] || "informational"
    : pendingMode;

  /**
   * Initialize a new conversation with the currently active mode and set it active in the UI.
   *
   * @returns {Promise<void>}
   */
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

  /**
   * Switch the active conversation to a different conversation ID.
   *
   * @param {string} id - Selected conversation ID.
   */
  const handleSelectConversation = (id) => {
    if (id === currentConversationId) return;
    resetActionState();
    setCurrentConversation(null);
    setCurrentConversationId(id);
  };

  /**
   * Ensure that an active conversation exists before sending a message or running an action/agent.
   * Creates a new conversation automatically if none is currently active.
   *
   * @returns {Promise<string>} Active conversation identifier.
   */
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

  /**
   * Send a prompt in Informational mode and process streaming multi-model council events.
   *
   * Workflow:
   * 1. Ensures an active conversation exists.
   * 2. Optimistically injects the user's message and an empty assistant shell into UI state.
   * 3. Streams council deliberation events (`stage1_*`, `stage2_*`, `stage3_*`).
   * 4. Updates conversation title and accumulates token count on stream completion.
   *
   * @param {string} content - Raw user query or prompt.
   * @returns {Promise<void>}
   */
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
              // Stream complete, reload conversations list and update mode
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === activeId
                    ? {
                        ...c,
                        mode: "informational",
                        token_usage: event.token_usage || c.token_usage,
                      }
                    : c,
                ),
              );
              setCurrentConversation((prev) =>
                prev?.id === activeId
                  ? {
                      ...prev,
                      mode: "informational",
                      token_usage: event.token_usage || prev.token_usage,
                    }
                  : prev,
              );
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

  /**
   * Request a structured Stage 4 Action Plan without immediate tool execution.
   *
   * Sends the request with `execute=false`. Once the plan is returned, the user
   * can review the proposed tool calls before clicking "Execute Action Plan".
   *
   * @param {string} requestText - User instruction to plan out.
   * @returns {Promise<void>}
   */
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
        (eventType, event) => handleActionStreamEvent(eventType, event, activeId),
        activeId,
      );
    } catch (error) {
      console.error("Failed to generate action plan:", error);
      setActionError(error.message || "Could not generate action plan");
      setActionLoading(false);
    }
  };

  /**
   * Switch the active execution mode for the current conversation and UI slider.
   *
   * @param {string} mode - "informational" | "one_shot" | "agentic".
   */
  const handleModeChange = (mode) => {
    setPendingMode(mode);
    if (currentConversationId) {
      setCouncilModeState((prev) => ({
        ...prev,
        [currentConversationId]: mode,
      }));
    }
  };

  /**
   * Run the Council Autonomous Agent with streaming updates over SSE.
   *
   * Orchestrates the agent lifecycle:
   * 1. Creates or verifies active conversation.
   * 2. Sets up agent message shell with steps, artifacts, and running state.
   * 3. Streams Thought -> Action -> Observation steps in real-time.
   * 4. Updates file artifacts when files are written or edited.
   * 5. Displays nested sub-council consultations and recommendations.
   * 6. Marks final completion status, summary, and accumulated token usage.
   *
   * @param {string} requestText - High-level task description for the agent.
   * @param {Object} [sensitivityConfig] - Optional sensitivity configuration (preset level, triggers, caps).
   * @returns {Promise<void>}
   */
  const handleRunAgent = async (requestText, sensitivityConfig = undefined) => {
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
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === activeId
                    ? {
                        ...c,
                        mode: "agentic",
                        token_usage: event.token_usage || c.token_usage,
                      }
                    : c,
                ),
              );
              setCurrentConversation((prev) =>
                prev?.id === activeId
                  ? {
                      ...prev,
                      mode: "agentic",
                      token_usage: event.token_usage || prev.token_usage,
                    }
                  : prev,
              );
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
        sensitivityConfig?.max_steps !== undefined
          ? sensitivityConfig.max_steps
          : 20,
        sensitivityConfig,
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

  /**
   * Request premature cancellation of an active autonomous agent run on the backend.
   *
   * @returns {Promise<void>}
   */
  const handleCancelAgent = async () => {
    if (!currentConversationId) return;
    try {
      await api.cancelAgent(currentConversationId);
    } catch (err) {
      console.error("Failed to cancel agent:", err);
    }
  };

  /**
   * Execute the stored or generated Action Plan using connected tools.
   *
   * Streams execution events and updates the execution status badge and output blocks.
   *
   * @returns {Promise<void>}
   */
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
          (eventType, event) =>
            handleActionStreamEvent(eventType, event, currentConversationId),
        );
      } else {
        executeStream = api.executeActionStream(
          actionPlanRequest,
          true,
          (eventType, event) =>
            handleActionStreamEvent(eventType, event, currentConversationId),
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

  /**
   * Run a custom workflow graph on user input with live SSE streaming.
   *
   * @param {string} inputText - User prompt to execute through the graph.
   * @returns {Promise<void>}
   */
  const handleRunWorkflow = async (inputText) => {
    if (!inputText.trim()) return;

    setWorkflowLoading(true);

    let activeId = currentConversationId;
    if (!activeId || !currentConversation) {
      try {
        activeId = await ensureActiveConversation();
      } catch (error) {
        console.error("Failed to create conversation for workflow:", error);
        setWorkflowLoading(false);
        return;
      }
    }

    let currentWf = activeWorkflow;
    if (!currentWf) {
      const allWfs = await api.getWorkflows();
      if (allWfs && allWfs.length > 0) {
        currentWf = allWfs[0];
        setActiveWorkflow(currentWf);
      }
    }

    if (!currentWf) {
      alert("No workflow available. Please select or create a workflow first.");
      setWorkflowLoading(false);
      return;
    }

    const userMessage = { role: "user", content: inputText };
    const workflowAssistantMessage = {
      role: "assistant",
      type: "workflow",
      workflow_id: currentWf.id,
      workflow_name: currentWf.name,
      status: "running",
      nodes: (currentWf.nodes || []).map((n) => ({
        ...n,
        status: "pending",
        output: "",
      })),
      edges: currentWf.edges || [],
      final_output: "",
      token_usage: {
        total_tokens: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        tokens_saved: 0,
        total_cost: 0,
      },
    };

    setCurrentConversation((prev) => {
      const prevMessages = prev?.messages || [];
      return {
        ...prev,
        messages: [...prevMessages, userMessage, workflowAssistantMessage],
      };
    });

    const updateLastWorkflowMessage = (updater) => {
      setCurrentConversation((prev) => {
        if (!prev?.messages?.length) return prev;
        const messages = [...prev.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant" && messages[i].type === "workflow") {
            messages[i] = updater(messages[i]);
            break;
          }
        }
        return { ...prev, messages };
      });
    };

    try {
      await api.runWorkflowStream({
        workflowId: currentWf.id,
        workflow: currentWf,
        input: inputText,
        conversationId: activeId,
        onEvent: (eventType, event) => {
          const eventData = event.data || event;
          switch (eventType) {
            case "workflow_start":
              updateLastWorkflowMessage((msg) => ({
                ...msg,
                status: "running",
              }));
              break;
            case "node_start":
              updateLastWorkflowMessage((msg) => {
                const updatedNodes = (msg.nodes || []).map((n) =>
                  n.id === eventData.node_id ? { ...n, status: "running" } : n
                );
                return { ...msg, nodes: updatedNodes };
              });
              break;
            case "node_complete":
              updateLastWorkflowMessage((msg) => {
                const updatedNodes = (msg.nodes || []).map((n) =>
                  n.id === eventData.id ? { ...n, ...eventData, status: "completed" } : n
                );
                return { ...msg, nodes: updatedNodes };
              });
              break;
            case "workflow_complete":
              updateLastWorkflowMessage((msg) => ({
                ...msg,
                status: eventData.status || "completed",
                final_output: eventData.final_output || "",
                nodes: eventData.nodes || msg.nodes,
                token_usage: eventData.token_usage || msg.token_usage,
              }));
              break;
            case "title_complete":
              if (eventData.title) {
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === activeId ? { ...c, title: eventData.title } : c
                  )
                );
              }
              break;
            case "complete":
              if (event.token_usage) {
                setCurrentConversation((prev) =>
                  prev ? { ...prev, token_usage: event.token_usage } : prev
                );
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === activeId ? { ...c, token_usage: event.token_usage } : c
                  )
                );
              }
              break;
            default:
              break;
          }
        },
      });
    } catch (err) {
      console.error("Workflow streaming failed:", err);
      updateLastWorkflowMessage((msg) => ({
        ...msg,
        status: "failed",
        error: err.message,
      }));
    } finally {
      setWorkflowLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
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
      <ChatInterface
        conversation={currentConversation}
        mode={activeMode}
        onModeChange={handleModeChange}
        showAllDeliberationSteps={showAllDeliberationSteps}
        showTokenCount={showTokenCount}
        showTokensPerModel={showTokensPerModel}
        showSpendValue={showSpendValue}
        showSavedTokens={showSavedTokens}
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
        activeWorkflow={activeWorkflow}
        onOpenWorkflowSelector={() => setShowWorkflowSelector(true)}
        onRunWorkflow={handleRunWorkflow}
        workflowLoading={workflowLoading}
      />

      <WorkflowSelectorModal
        isOpen={showWorkflowSelector}
        onClose={() => setShowWorkflowSelector(false)}
        selectedWorkflowId={activeWorkflow?.id}
        onSelectWorkflow={(wf) => {
          setActiveWorkflow(wf);
          handleModeChange("custom_workflows");
        }}
        onOpenEditor={(wfToEdit) => {
          setEditingWorkflow(wfToEdit);
          setShowWorkflowEditor(true);
        }}
      />

      <WorkflowEditorModal
        isOpen={showWorkflowEditor}
        onClose={() => {
          setShowWorkflowEditor(false);
          setEditingWorkflow(null);
        }}
        initialWorkflow={editingWorkflow}
        onWorkflowSaved={(savedWf) => {
          setActiveWorkflow(savedWf);
          setEditingWorkflow(null);
        }}
      />
    </div>
  );
}

export default App;
