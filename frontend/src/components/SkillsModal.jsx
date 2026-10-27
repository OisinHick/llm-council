import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import "./SkillsModal.css";

export default function SkillsModal({ isOpen, onClose, onSkillSelected }) {
  const [skills, setSkills] = useState([]);
  const [selectedSkillId, setSelectedSkillId] = useState(null);
  const [selectedSkillDetails, setSelectedSkillDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Editing / Creating state
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    id: "",
    name: "",
    description: "",
    triggers: "",
    evaluation_rubric: "",
    expert_roles: "",
    instructions: "",
  });
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadSkills = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.listSkills();
      const list = res.skills || [];
      setSkills(list);
      if (list.length > 0 && !selectedSkillId) {
        setSelectedSkillId(list[0].id);
      }
    } catch (e) {
      setError(e.message || "Failed to load skills");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSkills();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!selectedSkillId) {
      setSelectedSkillDetails(null);
      return;
    }
    api
      .getSkill(selectedSkillId)
      .then((data) => {
        setSelectedSkillDetails(data);
      })
      .catch((e) => {
        console.error("Failed to load skill details:", e);
      });
  }, [selectedSkillId]);

  if (!isOpen) return null;

  const handleStartCreate = () => {
    setFormData({
      id: "",
      name: "",
      description: "",
      triggers: "",
      evaluation_rubric: "",
      expert_roles: "",
      instructions: "## Guidelines\n1. Analyze requirements\n2. Follow best practices\n3. Verify output",
    });
    setSaveError(null);
    setIsEditing(true);
  };

  const handleStartEdit = () => {
    if (!selectedSkillDetails) return;
    setFormData({
      id: selectedSkillDetails.id,
      name: selectedSkillDetails.name || "",
      description: selectedSkillDetails.description || "",
      triggers: (selectedSkillDetails.triggers || []).join(", "),
      evaluation_rubric: selectedSkillDetails.evaluation_rubric || "",
      expert_roles: (selectedSkillDetails.expert_roles || []).join(", "),
      instructions: selectedSkillDetails.instructions || "",
    });
    setSaveError(null);
    setIsEditing(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveLoading(true);
    setSaveError(null);
    try {
      const triggersList = formData.triggers
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const rolesList = formData.expert_roles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);

      await api.saveSkill({
        id: formData.id,
        name: formData.name,
        description: formData.description,
        instructions: formData.instructions,
        triggers: triggersList,
        evaluation_rubric: formData.evaluation_rubric,
        expert_roles: rolesList,
      });

      setIsEditing(false);
      await loadSkills();
      setSelectedSkillId(formData.id);
    } catch (err) {
      setSaveError(err.message || "Failed to save skill");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDelete = async (skillId) => {
    if (!window.confirm(`Are you sure you want to delete skill '${skillId}'?`)) {
      return;
    }
    try {
      await api.deleteSkill(skillId);
      await loadSkills();
      setSelectedSkillId(null);
    } catch (err) {
      alert(err.message || "Failed to delete skill");
    }
  };

  return (
    <div className="skills-modal-backdrop" onClick={onClose}>
      <div className="skills-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="skills-modal-header">
          <div>
            <h2>🎯 Domain Skills Registry</h2>
            <p className="skills-modal-subtitle">
              Specialized domain capability packages that equip the Council and Chairperson with focused guidelines, rubrics, and bundled tools.
            </p>
          </div>
          <div className="skills-modal-header-actions">
            {!isEditing && (
              <button
                type="button"
                className="skills-new-btn"
                onClick={handleStartCreate}
              >
                + New Skill
              </button>
            )}
            <button
              type="button"
              className="skills-close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {error && <div className="skills-error-banner">{error}</div>}

        <div className="skills-modal-body">
          {/* Left Sidebar: Skills List */}
          <div className="skills-sidebar-pane">
            <div className="skills-sidebar-title">Installed Skills ({skills.length})</div>
            {isLoading ? (
              <div className="skills-loading">Loading skills...</div>
            ) : skills.length === 0 ? (
              <div className="skills-list-empty">
                <p>No domain skills created yet.</p>
                <button
                  type="button"
                  className="skills-create-first-btn"
                  onClick={handleStartCreate}
                >
                  + Create First Skill
                </button>
              </div>
            ) : (
              <div className="skills-list">
                {skills.map((s) => (
                  <div
                    key={s.id}
                    className={`skills-list-item ${selectedSkillId === s.id && !isEditing ? "active" : ""}`}
                    onClick={() => {
                      setIsEditing(false);
                      setSelectedSkillId(s.id);
                    }}
                  >
                    <div className="skills-item-top">
                      <span className="skills-item-name">{s.name}</span>
                      <code className="skills-id-badge">{s.id}</code>
                    </div>
                    <div className="skills-item-desc">{s.description}</div>
                    {s.triggers && s.triggers.length > 0 && (
                      <div className="skills-item-triggers">
                        {s.triggers.slice(0, 3).map((t) => (
                          <span key={t} className="skills-trigger-tag">
                            #{t}
                          </span>
                        ))}
                        {s.triggers.length > 3 && (
                          <span className="skills-trigger-more">+{s.triggers.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Pane: Skill Details or Form */}
          <div className="skills-content-pane">
            {isEditing ? (
              <form className="skills-editor-form" onSubmit={handleSave}>
                <h3>{formData.id && skills.some((s) => s.id === formData.id) ? "Edit Skill" : "Create New Skill"}</h3>
                {saveError && <div className="skills-error-banner">{saveError}</div>}

                <div className="skills-form-row">
                  <div className="skills-form-group">
                    <label>Skill ID (slug)</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. cloud-deployment"
                      value={formData.id}
                      onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                      disabled={skills.some((s) => s.id === formData.id)}
                    />
                  </div>
                  <div className="skills-form-group">
                    <label>Display Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Cloud Deployment Specialist"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="skills-form-group">
                  <label>Concise Description</label>
                  <input
                    type="text"
                    required
                    placeholder="Short summary of what this skill accomplishes"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="skills-form-group">
                  <label>Trigger Keywords (comma separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. deploy, terraform, aws, kubernetes"
                    value={formData.triggers}
                    onChange={(e) => setFormData({ ...formData, triggers: e.target.value })}
                  />
                </div>

                <div className="skills-form-group">
                  <label>Stage 1 Council Expert Roles (comma separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. Cloud Architect, DevOps Specialist, Security Engineer"
                    value={formData.expert_roles}
                    onChange={(e) => setFormData({ ...formData, expert_roles: e.target.value })}
                  />
                </div>

                <div className="skills-form-group">
                  <label>Stage 2 Peer Evaluation Rubric</label>
                  <textarea
                    rows={3}
                    placeholder="Domain-specific criteria models will use to grade each other"
                    value={formData.evaluation_rubric}
                    onChange={(e) => setFormData({ ...formData, evaluation_rubric: e.target.value })}
                  />
                </div>

                <div className="skills-form-group">
                  <label>Markdown Instructions & Operational Checklist</label>
                  <textarea
                    rows={8}
                    required
                    placeholder="# Operational Guidelines..."
                    value={formData.instructions}
                    onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                  />
                </div>

                <div className="skills-form-actions">
                  <button
                    type="button"
                    className="skills-btn-secondary"
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="skills-btn-primary"
                    disabled={saveLoading}
                  >
                    {saveLoading ? "Saving..." : "Save Skill"}
                  </button>
                </div>
              </form>
            ) : selectedSkillDetails ? (
              <div className="skills-detail-view">
                <div className="skills-detail-header">
                  <div>
                    <h3>{selectedSkillDetails.name}</h3>
                    <div className="skills-detail-meta">
                      <code className="skills-id-badge">{selectedSkillDetails.id}</code>
                    </div>
                  </div>
                  <div className="skills-detail-actions">
                    {onSkillSelected && (
                      <button
                        type="button"
                        className="skills-btn-select"
                        onClick={() => {
                          onSkillSelected(selectedSkillDetails.id);
                          onClose();
                        }}
                      >
                        ⚡ Use in Prompt
                      </button>
                    )}
                    <button
                      type="button"
                      className="skills-btn-secondary"
                      onClick={handleStartEdit}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="skills-btn-danger"
                      onClick={() => handleDelete(selectedSkillDetails.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <p className="skills-detail-desc">{selectedSkillDetails.description}</p>

                {selectedSkillDetails.triggers && selectedSkillDetails.triggers.length > 0 && (
                  <div className="skills-detail-section">
                    <h4>Trigger Keywords</h4>
                    <div className="skills-detail-triggers">
                      {selectedSkillDetails.triggers.map((t) => (
                        <span key={t} className="skills-trigger-tag">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedSkillDetails.expert_roles && selectedSkillDetails.expert_roles.length > 0 && (
                  <div className="skills-detail-section">
                    <h4>Council of Experts (Stage 1 Lenses)</h4>
                    <ul className="skills-roles-list">
                      {selectedSkillDetails.expert_roles.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedSkillDetails.evaluation_rubric && (
                  <div className="skills-detail-section">
                    <h4>Stage 2 Evaluation Rubric</h4>
                    <pre className="skills-rubric-box">{selectedSkillDetails.evaluation_rubric}</pre>
                  </div>
                )}

                {selectedSkillDetails.scripts && selectedSkillDetails.scripts.length > 0 && (
                  <div className="skills-detail-section">
                    <h4>Bundled Helper Scripts ({selectedSkillDetails.scripts.length})</h4>
                    <div className="skills-scripts-list">
                      {selectedSkillDetails.scripts.map((sc) => (
                        <div key={sc.name} className="skills-script-item">
                          <span>⚙️ {sc.name}</span>
                          <span className="skills-script-type">
                            {sc.is_executable ? "Executable Tool" : "Asset"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="skills-detail-section">
                  <h4>Operational Guidelines & Instructions</h4>
                  <div className="skills-markdown-box">
                    <ReactMarkdown>{selectedSkillDetails.instructions || ""}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : (
              <div className="skills-empty-state">
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🎯</div>
                <h4>Domain Skills are User-Provided</h4>
                <p style={{ maxWidth: "420px", margin: "8px auto 16px", color: "#64748b", lineHeight: "1.5", fontSize: "0.88rem" }}>
                  Equip the Council and Chairperson with specialized domain guidelines, Stage 1 expert roles, and Stage 2 evaluation rubrics tailored to your specific project needs.
                </p>
                <button
                  type="button"
                  className="skills-new-btn"
                  onClick={handleStartCreate}
                >
                  + Create New Skill
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
