/**
 * Stage 1 Component: Individual Council Member Responses.
 *
 * In Stage 1 of the Council workflow, each configured council model receives
 * the user prompt independently in parallel and drafts its proposed response
 * without visibility into other models' outputs.
 *
 * This component provides:
 * - Tabbed navigation across each participating model's proposal.
 * - Formatted Markdown rendering of the active model's response using `react-markdown`
 *   and `remark-gfm` (supporting tables, checklists, strikethrough, and fenced code).
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./Stage1.css";

/**
 * Stage 1 individual responses view.
 *
 * @param {Object} props - Component properties.
 * @param {Array<{model: string, response: string}>} props.responses - List of model response objects.
 * @returns {JSX.Element|null} Rendered component or null if responses array is empty.
 */
export default function Stage1({ responses }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!responses || responses.length === 0) {
    return null;
  }

  const activeResponse = responses[activeTab] || responses[0] || {};

  return (
    <div className="stage stage1">
      <h3 className="stage-title">Stage 1: Individual Responses</h3>

      <div className="tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? "active" : ""}`}
            onClick={() => setActiveTab(index)}
          >
            {resp.model?.split("/")[1] || resp.model || `Model ${index + 1}`}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="model-name">{activeResponse.model || "Unknown Model"}</div>
        <div className="response-text markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {activeResponse.response || ""}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
