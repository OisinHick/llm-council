/**
 * Stage 2 Component: Blind Peer Review and Rankings.
 *
 * In Stage 2 of the Council workflow:
 * 1. Each model from Stage 1 receives the complete set of responses anonymized as
 *    "Response A", "Response B", etc., to prevent brand/vendor self-bias.
 * 2. Each model critiques strengths and weaknesses and outputs a ranked order.
 * 3. The backend calculates aggregate Borda scores ("street cred") where lower average
 *    rank indicates higher consensus quality.
 *
 * Client-Side De-Anonymization:
 * - The original evaluation prompt used synthetic labels (`Response A`, `Response B`).
 * - This component maps those labels back to the real model names (e.g., `**claude-3-5-sonnet**`)
 *   for clear, readable presentation to the human user.
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./Stage2.css";

/**
 * Escape special regex characters in a literal string.
 *
 * @param {string} string - Raw string to escape.
 * @returns {string} Regex-safe escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace anonymous labels ("Response A", "Response B") with bold model names for human readability.
 *
 * @param {string} text - Raw review text containing anonymous response labels.
 * @param {Object<string, string>} labelToModel - Mapping from label (e.g. "Response A") to model identifier.
 * @returns {string} De-anonymized markdown text.
 */
function deAnonymizeText(text, labelToModel) {
  if (!text || !labelToModel) return text || "";

  let result = text;
  // Replace each "Response X" with the actual model name
  Object.entries(labelToModel).forEach(([label, model]) => {
    const modelShortName = model?.split("/")[1] || model || label;
    result = result.replace(
      new RegExp(escapeRegExp(label), "g"),
      `**${modelShortName}**`,
    );
  });
  return result;
}

/**
 * Stage 2 peer review and rankings view.
 *
 * @param {Object} props - Component properties.
 * @param {Array<{model: string, ranking: string, parsed_ranking?: Array<string>}>} props.rankings -
 *   List of individual model peer evaluation critiques.
 * @param {Object<string, string>} [props.labelToModel] - Map from anonymous labels to model identifiers.
 * @param {Array<{model: string, average_rank: number, rankings_count: number}>} [props.aggregateRankings] -
 *   Aggregated Borda-count rankings across all evaluations.
 * @returns {JSX.Element|null} Rendered component or null if rankings array is empty.
 */
export default function Stage2({ rankings, labelToModel, aggregateRankings }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!rankings || rankings.length === 0) {
    return null;
  }

  const activeRanking = rankings[activeTab] || rankings[0] || {};

  return (
    <div className="stage stage2">
      <h3 className="stage-title">Stage 2: Peer Rankings</h3>

      <h4>Raw Evaluations</h4>
      <p className="stage-description">
        Each model evaluated all responses (anonymized as Response A, B, C,
        etc.) and provided rankings. Below, model names are shown in{" "}
        <strong>bold</strong> for readability, but the original evaluation used
        anonymous labels.
      </p>

      <div className="tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? "active" : ""}`}
            onClick={() => setActiveTab(index)}
          >
            {rank.model?.split("/")[1] || rank.model || `Model ${index + 1}`}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="ranking-model">{activeRanking.model || "Unknown Model"}</div>
        <div className="ranking-content markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {deAnonymizeText(activeRanking.ranking, labelToModel)}
          </ReactMarkdown>
        </div>

        {activeRanking.parsed_ranking &&
          activeRanking.parsed_ranking.length > 0 && (
            <div className="parsed-ranking">
              <strong>Extracted Ranking:</strong>
              <ol>
                {activeRanking.parsed_ranking.map((label, i) => (
                  <li key={i}>
                    {labelToModel && labelToModel[label]
                      ? labelToModel[label].split("/")[1] || labelToModel[label]
                      : label}
                  </li>
                ))}
              </ol>
            </div>
          )}
      </div>

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div className="aggregate-rankings">
          <h4>Aggregate Rankings (Street Cred)</h4>
          <p className="stage-description">
            Combined results across all peer evaluations (lower score is
            better):
          </p>
          <div className="aggregate-list">
            {aggregateRankings.map((agg, index) => (
              <div key={index} className="aggregate-item">
                <span className="rank-position">#{index + 1}</span>
                <span className="rank-model">
                  {agg.model.split("/")[1] || agg.model}
                </span>
                <span className="rank-score">
                  Avg: {agg.average_rank.toFixed(2)}
                </span>
                <span className="rank-count">({agg.rankings_count} votes)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
