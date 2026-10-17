/**
 * WorkflowSelectorModal Component.
 *
 * Provides a user-friendly directory modal to:
 * - Browse pre-configured workflow templates and custom user-designed workflows.
 * - Inspect high-level node sequence graphs (Input -> Model Steps -> Output).
 * - Select a workflow for active execution in the chat interface.
 * - Launch the interactive drag-and-drop WorkflowEditorModal via the "+ New Workflow" button.
 * - Edit, duplicate, or delete workflows.
 */

import { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import "./WorkflowSelectorModal.css";

/**
 * Format node type to readable icon and label.
 *
 * @param {string} type - Node type string.
 * @returns {{icon: string, label: string}} Formatted type descriptor.
 */
function getNodeTypeInfo(type) {
  switch (type) {
    case "input":
      return { icon: "📥", label: "Input" };
    case "output":
      return { icon: "📤", label: "Output" };
    case "synthesis":
      return { icon: "🧬", label: "Synthesis" };
    case "model_step":
    default:
      return { icon: "🤖", label: "Model Step" };
  }
}

/**
 * Workflow Selector Modal component.
 *
 * @param {Object} props - Component properties.
 * @param {boolean} props.isOpen - Whether modal is displayed.
 * @param {function(): void} props.onClose - Modal close handler.
 * @param {string|null} props.selectedWorkflowId - Currently active workflow ID.
 * @param {function(Object): void} props.onSelectWorkflow - Callback when a workflow is chosen.
 * @param {function(Object|null): void} props.onOpenEditor - Callback to open the drag-and-drop editor.
 * @returns {JSX.Element|null} Rendered modal or null if closed.
 */
export default function WorkflowSelectorModal({
  isOpen,
  onClose,
  selectedWorkflowId,
  onSelectWorkflow,
  onOpenEditor,
}) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all"); // "all" | "templates" | "custom"

  // Load workflows on open
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    api
      .getWorkflows()
      .then((data) => {
        if (isMounted) {
          setWorkflows(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || "Failed to load workflows");
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Filter workflows by search query and category
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((wf) => {
      if (filterType === "templates" && !wf.is_template) return false;
      if (filterType === "custom" && wf.is_template) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const nameMatch = wf.name?.toLowerCase().includes(q);
      const descMatch = wf.description?.toLowerCase().includes(q);
      return nameMatch || descMatch;
    });
  }, [workflows, searchQuery, filterType]);

  const handleDeleteWorkflow = async (e, wfId) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this custom workflow?")) {
      return;
    }
    try {
      await api.deleteWorkflow(wfId);
      setWorkflows((prev) => prev.filter((w) => w.id !== wfId));
    } catch (err) {
      alert(`Failed to delete workflow: ${err.message}`);
    }
  };

  const handleDuplicate = (e, wf) => {
    e.stopPropagation();
    const copy = {
      ...wf,
      id: null,
      name: `${wf.name} (Copy)`,
      description: wf.description,
      is_template: false,
    };
    onOpenEditor(copy);
  };

  if (!isOpen) return null;

  return (
    <div
      className="workflow-selector-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="workflow-selector-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="workflow-selector-header">
          <div className="workflow-selector-header-left">
            <div>
              <h2>🔀 Custom Workflows</h2>
              <p>
                Configure multi-step LLM processing pipelines using a visual drag-and-drop node graph.
              </p>
            </div>
          </div>
          <div className="workflow-selector-header-actions">
            <button
              type="button"
              className="btn-new-workflow"
              onClick={() => onOpenEditor(null)}
              title="Design a new custom workflow graph"
            >
              <span>+ New Workflow</span>
            </button>
            <button
              type="button"
              className="workflow-selector-close-btn"
              onClick={onClose}
              title="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Toolbar: Search & Filter Tabs */}
        <div className="workflow-selector-toolbar">
          <div className="workflow-search-box">
            <span className="workflow-search-icon">🔍</span>
            <input
              type="text"
              className="workflow-search-input"
              placeholder="Search workflows by title or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="workflow-filter-tabs">
            <button
              type="button"
              className={`workflow-filter-btn ${filterType === "all" ? "active" : ""}`}
              onClick={() => setFilterType("all")}
            >
              All ({workflows.length})
            </button>
            <button
              type="button"
              className={`workflow-filter-btn ${filterType === "templates" ? "active" : ""}`}
              onClick={() => setFilterType("templates")}
            >
              Templates
            </button>
            <button
              type="button"
              className={`workflow-filter-btn ${filterType === "custom" ? "active" : ""}`}
              onClick={() => setFilterType("custom")}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="workflow-list-container">
          {loading && (
            <div className="workflow-empty-state">
              <div className="workflow-empty-icon">⏳</div>
              <p>Loading workflows...</p>
            </div>
          )}

          {error && (
            <div className="workflow-empty-state">
              <div className="workflow-empty-icon">⚠️</div>
              <p style={{ color: "#ef4444" }}>{error}</p>
            </div>
          )}

          {!loading && !error && filteredWorkflows.length === 0 && (
            <div className="workflow-empty-state">
              <div className="workflow-empty-icon">📂</div>
              <h3>No workflows found</h3>
              <p>Create a new custom workflow to get started!</p>
              <button
                type="button"
                className="btn-new-workflow"
                style={{ marginTop: "12px" }}
                onClick={() => onOpenEditor(null)}
              >
                + New Workflow
              </button>
            </div>
          )}

          {!loading &&
            !error &&
            filteredWorkflows.map((wf) => {
              const isSelected = selectedWorkflowId === wf.id;
              const nodes = wf.nodes || [];

              return (
                <div
                  key={wf.id}
                  className={`workflow-card ${isSelected ? "is-active" : ""}`}
                >
                  <div className="workflow-card-top">
                    <div className="workflow-card-info">
                      <h3>
                        <span>{wf.name}</span>
                        {wf.is_template ? (
                          <span className="workflow-badge badge-template">Template</span>
                        ) : (
                          <span className="workflow-badge badge-custom">Custom</span>
                        )}
                        {isSelected && (
                          <span className="workflow-badge badge-active">Active</span>
                        )}
                      </h3>
                      {wf.description && (
                        <p className="workflow-card-desc">{wf.description}</p>
                      )}
                    </div>

                    <div className="workflow-card-actions">
                      <button
                        type="button"
                        className={`btn-select-wf ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          onSelectWorkflow(wf);
                          onClose();
                        }}
                      >
                        {isSelected ? "✓ Active" : "Use Workflow"}
                      </button>

                      <button
                        type="button"
                        className="btn-icon-action"
                        onClick={() => onOpenEditor(wf)}
                        title="Open in Drag & Drop Graph Editor"
                      >
                        ✏️ {wf.is_template ? "View / Edit" : "Edit"}
                      </button>

                      <button
                        type="button"
                        className="btn-icon-action"
                        onClick={(e) => handleDuplicate(e, wf)}
                        title="Duplicate as new custom workflow"
                      >
                        📑 Duplicate
                      </button>

                      {!wf.is_template && (
                        <button
                          type="button"
                          className="btn-icon-action btn-delete-wf"
                          onClick={(e) => handleDeleteWorkflow(e, wf.id)}
                          title="Delete custom workflow"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Flow summary representation */}
                  <div className="workflow-graph-summary">
                    <span className="graph-summary-label">Pipeline:</span>
                    {nodes.map((n, i) => {
                      const typeInfo = getNodeTypeInfo(n.type);
                      const modelShort = n.model ? n.model.split("/")[1] || n.model : "";

                      return (
                        <span key={n.id} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <span className={`summary-node-chip chip-${n.type}`}>
                            <span>{typeInfo.icon}</span>
                            <span>{n.label || typeInfo.label}</span>
                            {modelShort && (
                              <span className="summary-node-model">{modelShort}</span>
                            )}
                          </span>
                          {i < nodes.length - 1 && (
                            <span className="summary-arrow">➔</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="workflow-selector-footer">
          <div>
            Showing <strong>{filteredWorkflows.length}</strong> of{" "}
            <strong>{workflows.length}</strong> workflows
          </div>
          <div>
            Click <strong>Use Workflow</strong> to set it as active, or{" "}
            <strong>+ New Workflow</strong> to design your own.
          </div>
        </div>
      </div>
    </div>
  );
}
