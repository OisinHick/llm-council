/**
 * Stage 3 Component: Final Synthesized Council Answer.
 *
 * In Stage 3 of the Council deliberation:
 * - The designated Chairman Model receives the original user prompt, all Stage 1 responses,
 *   and all Stage 2 peer evaluations and rankings.
 * - The Chairman synthesizes the best points, reconciles contradictions, and outputs
 *   the comprehensive, definitive answer on behalf of the entire council.
 * - In "Just show final answer" mode, this synthesized answer is displayed directly.
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./Stage3.css";

/**
 * Stage 3 final synthesized response view.
 *
 * @param {Object} props - Component properties.
 * @param {{model?: string, response?: string}|null} props.finalResponse - Chairman synthesis result object.
 * @returns {JSX.Element|null} Rendered component or null if finalResponse is not provided.
 */
function Stage3({ finalResponse }) {
  if (!finalResponse) {
    return null;
  }

  const chairmanName =
    finalResponse.model?.split("/")[1] ||
    finalResponse.model ||
    "Council Chairman";

  return (
    <div className="stage stage3">
      <h3 className="stage-title">Stage 3: Final Council Answer</h3>
      <div className="final-response">
        <div className="chairman-label">
          Chairman: {chairmanName}
        </div>
        <div className="final-text markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {finalResponse.response || ""}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default memo(Stage3);
