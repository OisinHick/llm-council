/**
 * WorkflowEditorModal Component.
 *
 * Full-featured visual graph node editor providing:
 * - Palette of draggable node types (Input, Model Step, Synthesis, Output).
 * - Drag-and-drop canvas layout with free repositioning of nodes.
 * - Interactive SVG bezier curved connectors between node ports.
 * - Dynamic edge creation (drag/click from output port to input port) and deletion.
 * - Node Configuration Inspector:
 *     * Custom step label/name
 *     * Model selector (with OpenRouter models & custom model ID entry)
 *     * Dynamic prompt template editor with {input}, {previous}, and {nodes.<id>.output} tags
 *     * Temperature and execution settings
 * - Graph DAG validation (cycle detection, input/output completeness check).
 * - Atomic persistence to backend via api.saveWorkflow.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "../api";
import "./WorkflowEditorModal.css";

// Default template node coordinates and types
const NODE_TYPES = [
  {
    type: "input",
    title: "Input Node",
    subtitle: "User prompt entrypoint",
    icon: "📥",
    defaultLabel: "User Input",
    colorClass: "icon-input",
  },
  {
    type: "model_step",
    title: "Model Step",
    subtitle: "Individual LLM step",
    icon: "🤖",
    defaultLabel: "LLM Step",
    colorClass: "icon-model_step",
  },
  {
    type: "synthesis",
    title: "Synthesis Node",
    subtitle: "Reconcile branches",
    icon: "🧬",
    defaultLabel: "Consensus Synthesis",
    colorClass: "icon-synthesis",
  },
  {
    type: "output",
    title: "Output Node",
    subtitle: "Final response deliverable",
    icon: "📤",
    defaultLabel: "Final Output",
    colorClass: "icon-output",
  },
];

const DEFAULT_POPULAR_MODELS = [
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
  "anthropic/claude-3-haiku",
  "meta-llama/llama-3.3-70b-instruct",
  "google/gemini-2.0-flash-thinking-exp:free",
  "deepseek/deepseek-chat",
  "openai/gpt-4o",
  "anthropic/claude-3.5-sonnet",
];

export default function WorkflowEditorModal({
  isOpen,
  onClose,
  initialWorkflow,
  onWorkflowSaved,
}) {
  const [workflowName, setWorkflowName] = useState("Custom Workflow");
  const [workflowDesc, setWorkflowDesc] = useState("Multi-step LLM processing graph");
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState(DEFAULT_POPULAR_MODELS);

  // Dragging node state on canvas
  const [draggingNode, setDraggingNode] = useState(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Edge drawing state
  const [connectingSource, setConnectingSource] = useState(null); // { nodeId, portType: 'out' }
  const [mouseCanvasPos, setMouseCanvasPos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);

  // Initialize workflow state when modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (initialWorkflow) {
      setWorkflowName(initialWorkflow.name || "Custom Workflow");
      setWorkflowDesc(initialWorkflow.description || "");
      setNodes(initialWorkflow.nodes ? JSON.parse(JSON.stringify(initialWorkflow.nodes)) : []);
      setEdges(initialWorkflow.edges ? JSON.parse(JSON.stringify(initialWorkflow.edges)) : []);
      if (initialWorkflow.nodes?.length > 0) {
        setSelectedNodeId(initialWorkflow.nodes[0].id);
      }
    } else {
      // Default initial starter graph: Input -> Model Step -> Output
      const starterNodes = [
        {
          id: "node_input",
          type: "input",
          label: "User Input",
          model: "",
          prompt_template: "",
          position: { x: 80, y: 220 },
        },
        {
          id: "node_step_1",
          type: "model_step",
          label: "Specialist Analysis",
          model: "google/gemini-2.5-flash",
          prompt_template: "Analyze and provide a detailed response for:\n\n{input}",
          position: { x: 420, y: 220 },
          temperature: 0.7,
        },
        {
          id: "node_output",
          type: "output",
          label: "Final Output",
          model: "",
          prompt_template: "",
          position: { x: 760, y: 220 },
        },
      ];
      const starterEdges = [
        { id: "e_in_s1", source: "node_input", target: "node_step_1", sourceHandle: "out", targetHandle: "in" },
        { id: "e_s1_out", source: "node_step_1", target: "node_output", sourceHandle: "out", targetHandle: "in" },
      ];
      setWorkflowName("New Custom Workflow");
      setWorkflowDesc("Sequential processing pipeline");
      setNodes(starterNodes);
      setEdges(starterEdges);
      setSelectedNodeId("node_step_1");
    }

    // Load configured models from settings to populate model options
    api
      .getSettings()
      .then((settings) => {
        if (settings) {
          const list = new Set(DEFAULT_POPULAR_MODELS);
          if (settings.council_models) {
            settings.council_models.forEach((m) => list.add(m));
          }
          if (settings.chairman_model) {
            list.add(settings.chairman_model);
          }
          setAvailableModels(Array.from(list));
        }
      })
      .catch(() => {});
  }, [isOpen, initialWorkflow]);

  // Selected node object
  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // Compute node map for easy coordinate lookup
  const nodeMap = useMemo(() => {
    const map = {};
    nodes.forEach((n) => {
      map[n.id] = n;
    });
    return map;
  }, [nodes]);

  // Handle Palette Drag Start (HTML5 drag and drop)
  const handlePaletteDragStart = (e, nodeTypeObj) => {
    e.dataTransfer.setData("application/json", JSON.stringify(nodeTypeObj));
    e.dataTransfer.effectAllowed = "copy";
  };

  // Handle Drop on Canvas
  const handleCanvasDrop = (e) => {
    e.preventDefault();
    const dataStr = e.dataTransfer.getData("application/json");
    if (!dataStr) return;

    try {
      const typeObj = JSON.parse(dataStr);
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const scrollLeft = canvasRef.current.scrollLeft;
      const scrollTop = canvasRef.current.scrollTop;

      const x = Math.max(20, Math.round(e.clientX - canvasRect.left + scrollLeft - 120));
      const y = Math.max(20, Math.round(e.clientY - canvasRect.top + scrollTop - 40));

      const newId = `node_${Date.now()}`;
      const defaultModel =
        typeObj.type === "model_step" || typeObj.type === "synthesis"
          ? "google/gemini-2.5-flash"
          : "";

      const defaultPrompt =
        typeObj.type === "model_step"
          ? "Process the following:\n\n{previous}"
          : typeObj.type === "synthesis"
            ? "Synthesize the following predecessor perspectives:\n\n{previous}"
            : "";

      const newNode = {
        id: newId,
        type: typeObj.type,
        label: typeObj.defaultLabel,
        model: defaultModel,
        prompt_template: defaultPrompt,
        position: { x, y },
        temperature: 0.7,
      };

      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(newId);
    } catch (err) {
      console.error("Drop error:", err);
    }
  };

  const handleCanvasDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  // Node position drag handling on canvas
  const handleNodeMouseDown = (e, node) => {
    if (e.target.closest(".node-port") || e.target.closest(".node-delete-icon-btn")) {
      return;
    }
    e.stopPropagation();
    setSelectedNodeId(node.id);

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const scrollLeft = canvasRef.current.scrollLeft;
    const scrollTop = canvasRef.current.scrollTop;

    dragOffsetRef.current = {
      x: e.clientX - (node.position.x - scrollLeft + canvasRect.left),
      y: e.clientY - (node.position.y - scrollTop + canvasRect.top),
    };

    setDraggingNode(node.id);
  };

  // Mouse move handler for node dragging and edge drawing
  const handleCanvasMouseMove = (e) => {
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const scrollLeft = canvasRef.current.scrollLeft;
    const scrollTop = canvasRef.current.scrollTop;

    const currentCanvasX = e.clientX - canvasRect.left + scrollLeft;
    const currentCanvasY = e.clientY - canvasRect.top + scrollTop;

    setMouseCanvasPos({ x: currentCanvasX, y: currentCanvasY });

    if (draggingNode) {
      const newX = Math.max(20, Math.round(currentCanvasX - dragOffsetRef.current.x));
      const newY = Math.max(20, Math.round(currentCanvasY - dragOffsetRef.current.y));

      setNodes((prev) =>
        prev.map((n) => (n.id === draggingNode ? { ...n, position: { x: newX, y: newY } } : n))
      );
    }
  };

  const handleCanvasMouseUp = () => {
    if (draggingNode) {
      setDraggingNode(null);
    }
  };

  // Edge drawing: Click/Drag from Output Port
  const handlePortMouseDown = (e, node, portType) => {
    e.stopPropagation();
    if (portType === "out") {
      setConnectingSource({ nodeId: node.id, portType: "out" });
    }
  };

  // Edge drawing: Release or Click on Input Port
  const handlePortMouseUp = (e, targetNode, portType) => {
    e.stopPropagation();
    if (connectingSource && portType === "in") {
      const srcId = connectingSource.nodeId;
      const tgtId = targetNode.id;

      // Disallow self-loops and duplicate edges
      if (srcId !== tgtId) {
        const edgeExists = edges.some((ed) => ed.source === srcId && ed.target === tgtId);
        if (!edgeExists) {
          const newEdge = {
            id: `e_${srcId}_${tgtId}`,
            source: srcId,
            target: tgtId,
            sourceHandle: "out",
            targetHandle: "in",
          };
          setEdges((prev) => [...prev, newEdge]);
        }
      }
    }
    setConnectingSource(null);
  };

  // Delete an edge
  const handleDeleteEdge = (edgeId) => {
    setEdges((prev) => prev.filter((ed) => ed.id !== edgeId));
  };

  // Delete a node
  const handleDeleteNode = (nodeId) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((ed) => ed.source !== nodeId && ed.target !== nodeId));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  };

  // Update selected node attributes
  const updateSelectedNode = (field, value) => {
    if (!selectedNodeId) return;
    setNodes((prev) =>
      prev.map((n) => (n.id === selectedNodeId ? { ...n, [field]: value } : n))
    );
  };

  // Add variable tag into prompt template
  const insertPromptTag = (tag) => {
    if (!selectedNode) return;
    const current = selectedNode.prompt_template || "";
    updateSelectedNode("prompt_template", `${current} ${tag} `);
  };

  // Validate the DAG
  const handleValidateGraph = () => {
    const hasInput = nodes.some((n) => n.type === "input");
    const hasOutput = nodes.some((n) => n.type === "output");

    if (!hasInput) {
      setValidationResult({
        valid: false,
        message: "Validation Error: Graph must contain at least one Input Node (📥).",
      });
      return false;
    }

    if (!hasOutput) {
      setValidationResult({
        valid: false,
        message: "Validation Error: Graph must contain at least one Output Node (📤).",
      });
      return false;
    }

    // Check all model steps specify a model
    for (const n of nodes) {
      if ((n.type === "model_step" || n.type === "synthesis") && !n.model?.trim()) {
        setValidationResult({
          valid: false,
          message: `Validation Error: Node '${n.label || n.id}' must specify an LLM model.`,
        });
        return false;
      }
    }

    // Cycle check via Kahn's algorithm
    const nodeIds = new Set(nodes.map((n) => n.id));
    const inDegree = {};
    const adj = {};
    nodeIds.forEach((id) => {
      inDegree[id] = 0;
      adj[id] = [];
    });

    edges.forEach((ed) => {
      if (nodeIds.has(ed.source) && nodeIds.has(ed.target)) {
        adj[ed.source].push(ed.target);
        inDegree[ed.target] += 1;
      }
    });

    const queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
    let visited = 0;
    while (queue.length > 0) {
      const curr = queue.shift();
      visited += 1;
      for (const neighbor of adj[curr]) {
        inDegree[neighbor] -= 1;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (visited !== nodeIds.size) {
      setValidationResult({
        valid: false,
        message: "Validation Error: Graph contains circular dependency / loop.",
      });
      return false;
    }

    setValidationResult({
      valid: true,
      message: `Graph is valid! (${nodes.length} nodes, ${edges.length} connections)`,
    });
    return true;
  };

  // Save workflow
  const handleSave = async () => {
    if (!handleValidateGraph()) {
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        id: initialWorkflow?.id || null,
        name: workflowName.trim() || "Untitled Workflow",
        description: workflowDesc.trim(),
        is_template: false,
        nodes,
        edges,
      };

      const saved = await api.saveWorkflow(payload);
      if (onWorkflowSaved) {
        onWorkflowSaved(saved);
      }
      onClose();
    } catch (err) {
      setValidationResult({
        valid: false,
        message: `Save failed: ${err.message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="workflow-editor-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="workflow-editor-modal"
        onClick={(e) => e.stopPropagation()}
        onMouseUp={handleCanvasMouseUp}
      >
        {/* Top Header */}
        <div className="workflow-editor-header">
          <div className="workflow-editor-title-group">
            <input
              type="text"
              className="workflow-name-input"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Workflow Name..."
              title="Click to rename workflow"
            />
            <input
              type="text"
              className="workflow-desc-input"
              value={workflowDesc}
              onChange={(e) => setWorkflowDesc(e.target.value)}
              placeholder="Short description of this workflow's objective..."
            />
          </div>

          <div className="workflow-editor-header-actions">
            <button
              type="button"
              className="btn-validate-wf"
              onClick={handleValidateGraph}
              title="Check for cycles, missing inputs or models"
            >
              ✓ Validate Graph
            </button>
            <button
              type="button"
              className="btn-save-wf"
              onClick={handleSave}
              disabled={isSaving}
              title="Save this workflow"
            >
              💾 {isSaving ? "Saving..." : "Save Workflow"}
            </button>
            <button
              type="button"
              className="btn-close-editor"
              onClick={onClose}
              title="Close editor"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Validation Notice Banner */}
        {validationResult && (
          <div
            className={`editor-validation-banner ${
              validationResult.valid ? "banner-success" : "banner-error"
            }`}
          >
            <span>{validationResult.valid ? "✓" : "⚠️"}</span>
            <span>{validationResult.message}</span>
          </div>
        )}

        {/* Main Editor Body */}
        <div className="workflow-editor-body">
          {/* Left: Palette */}
          <div className="node-palette">
            <h4>Node Palette</h4>
            <div className="palette-items">
              {NODE_TYPES.map((typeObj) => (
                <div
                  key={typeObj.type}
                  className="palette-card"
                  draggable
                  onDragStart={(e) => handlePaletteDragStart(e, typeObj)}
                  onClick={() => {
                    // Also support click-to-add
                    const newId = `node_${Date.now()}`;
                    const defaultModel =
                      typeObj.type === "model_step" || typeObj.type === "synthesis"
                        ? "google/gemini-2.5-flash"
                        : "";
                    const newNode = {
                      id: newId,
                      type: typeObj.type,
                      label: typeObj.defaultLabel,
                      model: defaultModel,
                      prompt_template:
                        typeObj.type === "model_step" ? "Process: {previous}" : "",
                      position: { x: 300, y: 200 },
                      temperature: 0.7,
                    };
                    setNodes((prev) => [...prev, newNode]);
                    setSelectedNodeId(newId);
                  }}
                  title="Drag onto canvas or click to add"
                >
                  <div className={`palette-icon ${typeObj.colorClass}`}>
                    {typeObj.icon}
                  </div>
                  <div className="palette-info">
                    <span className="palette-title">{typeObj.title}</span>
                    <span className="palette-subtitle">{typeObj.subtitle}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="palette-help">
              <strong>Quick Guide:</strong>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: "16px" }}>
                <li>Drag nodes from palette onto the canvas.</li>
                <li>Drag node header to reposition.</li>
                <li>
                  Drag from right port (<strong>●</strong>) to left port (
                  <strong>●</strong>) to connect.
                </li>
                <li>Click any line to remove connection.</li>
              </ul>
            </div>
          </div>

          {/* Center: Graph Canvas */}
          <div
            className="graph-canvas-container"
            ref={canvasRef}
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
            onMouseMove={handleCanvasMouseMove}
            onClick={() => {
              // Click canvas to clear active selection
              setSelectedNodeId(null);
              setConnectingSource(null);
            }}
          >
            <div className="graph-canvas-world">
              {/* SVG Connector Layer */}
              <svg className="graph-svg-layer">
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 4, 0 8" fill="#94a3b8" />
                  </marker>
                  <marker
                    id="arrowhead-active"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 4, 0 8" fill="#3b82f6" />
                  </marker>
                </defs>

                {/* Render Edges */}
                {edges.map((edge) => {
                  const src = nodeMap[edge.source];
                  const tgt = nodeMap[edge.target];
                  if (!src || !tgt) return null;

                  // Node width is 240px; port is at height 50%
                  const srcX = src.position.x + 240;
                  const srcY = src.position.y + 45;
                  const tgtX = tgt.position.x;
                  const tgtY = tgt.position.y + 45;

                  const deltaX = Math.abs(tgtX - srcX);
                  const curveOffset = Math.max(deltaX * 0.45, 40);

                  const pathD = `M ${srcX} ${srcY} C ${srcX + curveOffset} ${srcY}, ${tgtX - curveOffset} ${tgtY}, ${tgtX} ${tgtY}`;
                  const midX = (srcX + tgtX) / 2;
                  const midY = (srcY + tgtY) / 2;

                  return (
                    <g key={edge.id}>
                      <path
                        d={pathD}
                        className="graph-edge-path"
                        markerEnd="url(#arrowhead)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEdge(edge.id);
                        }}
                      >
                        <title>Click connection to delete</title>
                      </path>
                      {/* Edge delete button on mid-point */}
                      <g
                        transform={`translate(${midX}, ${midY})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEdge(edge.id);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <circle r="9" className="edge-delete-btn" />
                        <text
                          textAnchor="middle"
                          dy="3.5"
                          fontSize="10"
                          fontWeight="bold"
                          fill="#ef4444"
                          pointerEvents="none"
                        >
                          ✕
                        </text>
                      </g>
                    </g>
                  );
                })}

                {/* Live drawing preview edge */}
                {connectingSource && (
                  <path
                    d={`M ${nodeMap[connectingSource.nodeId].position.x + 240} ${
                      nodeMap[connectingSource.nodeId].position.y + 45
                    } C ${
                      nodeMap[connectingSource.nodeId].position.x + 240 + 60
                    } ${
                      nodeMap[connectingSource.nodeId].position.y + 45
                    }, ${mouseCanvasPos.x - 60} ${mouseCanvasPos.y}, ${mouseCanvasPos.x} ${mouseCanvasPos.y}`}
                    className="graph-edge-path drawing"
                    markerEnd="url(#arrowhead-active)"
                  />
                )}
              </svg>

              {/* Render Nodes on Canvas */}
              {nodes.map((node) => {
                const isSelected = selectedNodeId === node.id;
                const typeObj = NODE_TYPES.find((t) => t.type === node.type) || NODE_TYPES[1];

                return (
                  <div
                    key={node.id}
                    className={`canvas-node ${isSelected ? "is-selected" : ""}`}
                    style={{
                      left: `${node.position.x}px`,
                      top: `${node.position.y}px`,
                    }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNodeId(node.id);
                    }}
                  >
                    {/* Left Port: Input (only for non-input nodes) */}
                    {node.type !== "input" && (
                      <div
                        className={`node-port port-input ${
                          connectingSource ? "connecting" : ""
                        }`}
                        title="Input port (drop connection here)"
                        onMouseUp={(e) => handlePortMouseUp(e, node, "in")}
                      />
                    )}

                    {/* Node Card Header */}
                    <div className={`node-header node-header-type-${node.type}`}>
                      <div className="node-header-left">
                        <span className="node-type-icon">{typeObj.icon}</span>
                        <span className="node-label-title" title={node.label}>
                          {node.label || typeObj.defaultLabel}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="node-delete-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNode(node.id);
                        }}
                        title="Delete node"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Node Card Body */}
                    <div className="node-content-body">
                      {node.type !== "input" && node.type !== "output" && (
                        <div className="node-model-chip" title={node.model}>
                          {node.model
                            ? node.model.split("/")[1] || node.model
                            : "⚠️ Select model..."}
                        </div>
                      )}

                      {node.prompt_template && (
                        <div className="node-prompt-snippet">
                          "{node.prompt_template}"
                        </div>
                      )}
                    </div>

                    {/* Right Port: Output (only for non-output nodes) */}
                    {node.type !== "output" && (
                      <div
                        className="node-port port-output"
                        title="Output port (drag to an input port)"
                        onMouseDown={(e) => handlePortMouseDown(e, node, "out")}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Node Inspector */}
          <div className="node-inspector">
            {selectedNode ? (
              <>
                <div className="inspector-header">
                  <h4>
                    <span>
                      {NODE_TYPES.find((t) => t.type === selectedNode.type)?.icon}
                    </span>
                    <span>Node Configuration</span>
                  </h4>
                  <button
                    type="button"
                    className="btn-icon-action btn-delete-wf"
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    title="Delete this node"
                  >
                    🗑️ Delete Node
                  </button>
                </div>

                {/* Step Title / Label */}
                <div className="inspector-field">
                  <label>Step Label</label>
                  <input
                    type="text"
                    value={selectedNode.label || ""}
                    onChange={(e) => updateSelectedNode("label", e.target.value)}
                    placeholder="e.g. Draft Specialist"
                  />
                </div>

                {/* Model Selector (for model_step and synthesis) */}
                {selectedNode.type !== "input" && selectedNode.type !== "output" && (
                  <div className="inspector-field">
                    <label>LLM Model</label>
                    <select
                      value={
                        availableModels.includes(selectedNode.model)
                          ? selectedNode.model
                          : "custom"
                      }
                      onChange={(e) => {
                        if (e.target.value !== "custom") {
                          updateSelectedNode("model", e.target.value);
                        }
                      }}
                    >
                      {availableModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      <option value="custom">+ Custom Model ID...</option>
                    </select>

                    {/* Custom model text input if custom selected or not in preset list */}
                    {(!availableModels.includes(selectedNode.model) ||
                      selectedNode.model === "custom") && (
                      <input
                        type="text"
                        style={{ marginTop: "6px" }}
                        placeholder="Enter model ID (e.g. gemini argon 4)..."
                        value={selectedNode.model === "custom" ? "" : selectedNode.model}
                        onChange={(e) => updateSelectedNode("model", e.target.value)}
                      />
                    )}
                  </div>
                )}

                {/* Prompt Template (for model_step and synthesis) */}
                {selectedNode.type !== "input" && selectedNode.type !== "output" && (
                  <div className="inspector-field">
                    <label>
                      <span>Prompt Template</span>
                      <span style={{ fontSize: "0.7rem", color: "#64748b" }}>
                        Markdown & Tags
                      </span>
                    </label>
                    <textarea
                      rows={7}
                      value={selectedNode.prompt_template || ""}
                      onChange={(e) =>
                        updateSelectedNode("prompt_template", e.target.value)
                      }
                      placeholder="Prompt to send to this model... Use {input} or {previous}"
                    />

                    {/* Quick Insert Variable Tags */}
                    <div className="prompt-tags-container">
                      <button
                        type="button"
                        className="btn-prompt-tag"
                        onClick={() => insertPromptTag("{input}")}
                        title="Original user request"
                      >
                        + &#123;input&#125;
                      </button>
                      <button
                        type="button"
                        className="btn-prompt-tag"
                        onClick={() => insertPromptTag("{previous}")}
                        title="Combined outputs of predecessor nodes"
                      >
                        + &#123;previous&#125;
                      </button>
                      {nodes
                        .filter((n) => n.id !== selectedNode.id && n.type !== "output")
                        .map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            className="btn-prompt-tag"
                            onClick={() => insertPromptTag(`{nodes.${n.id}.output}`)}
                            title={`Output of ${n.label || n.id}`}
                          >
                            + &#123;{n.label || n.id}&#125;
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Temperature Slider */}
                {selectedNode.type !== "input" && selectedNode.type !== "output" && (
                  <div className="inspector-field">
                    <label>
                      <span>Temperature</span>
                      <span>{selectedNode.temperature ?? 0.7}</span>
                    </label>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={selectedNode.temperature ?? 0.7}
                      onChange={(e) =>
                        updateSelectedNode("temperature", parseFloat(e.target.value))
                      }
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="inspector-empty">
                <div style={{ fontSize: "2rem", marginBottom: "8px" }}>👆</div>
                <p>Click on any node to configure its step model, prompt, and settings.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
