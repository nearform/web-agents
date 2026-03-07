import { html } from "../util/html.js";
import React from "react";
import { ActivityType } from "../util/activity.js";

const AGENT_COLORS = {
  Coordinator: "agent-coordinator",
  Researcher: "agent-researcher",
  Writer: "agent-writer",
};

const formatTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const getIcon = (type) => {
  switch (type) {
    case ActivityType.START:
      return "ph ph-play";
    case "thinking":
    case ActivityType.PROMPT:
      return "ph ph-brain";
    case ActivityType.DELEGATE:
      return "ph ph-arrow-right";
    case ActivityType.TOOL_CALL:
      return "ph ph-wrench";
    case ActivityType.TOOL_RESULT:
      return "ph ph-check-circle";
    case ActivityType.TOOL_ERROR:
    case ActivityType.ERROR:
      return "ph ph-warning";
    case ActivityType.RESPONSE:
    case ActivityType.RECEIVED:
      return "ph ph-chat-circle";
    case ActivityType.DONE:
      return "ph ph-flag-checkered";
    default:
      return "ph ph-dot";
  }
};

const formatDetail = (detail) => {
  if (typeof detail === "string") return detail;
  if (detail?.name) {
    return `${detail.name}(${detail.args ? JSON.stringify(detail.args).slice(0, 100) : ""})`;
  }
  return JSON.stringify(detail).slice(0, 150);
};

const ActivityEntry = ({ entry }) => {
  const [expanded, setExpanded] = React.useState(false);
  const isToolCall = entry.type === "tool-call";
  const detailStr = formatDetail(entry.detail);

  return html`
    <div
      className="activity-entry ${AGENT_COLORS[entry.agent] || ""}"
      onClick=${isToolCall ? () => setExpanded(!expanded) : undefined}
    >
      <span className="activity-time">${formatTime(entry.timestamp)}</span>
      <i className="${getIcon(entry.type)}"></i>
      <span className="activity-agent">${entry.agent}</span>
      <span className="activity-detail">
        ${detailStr.slice(0, expanded ? 500 : 120)}
        ${!expanded && detailStr.length > 120 ? "..." : ""}
      </span>
    </div>
  `;
};

export const ActivityLog = ({ activities }) => {
  const endRef = React.useRef(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities.length]);

  return html`
    <div className="activity-panel">
      <div className="activity-header">
        <i className="ph ph-activity"></i>
        <h2>Agent Activity</h2>
      </div>
      <div className="activity-feed">
        ${activities.length === 0 &&
        html`
          <div className="activity-empty">
            Agent activity will appear here when you send a message.
          </div>
        `}
        ${activities.map(
          (entry, i) => html`<${ActivityEntry} key=${i} entry=${entry} />`,
        )}
        <div ref=${endRef}></div>
      </div>
    </div>
  `;
};
