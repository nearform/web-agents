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
    return `${detail.name}(${detail.args ? JSON.stringify(detail.args) : ""})`;
  }
  return JSON.stringify(detail);
};

const ActivityEntry = ({ entry, onClick }) => {
  const [expanded, setExpanded] = React.useState(false);
  const isToolCall = entry.type === "tool-call";
  const detailStr = formatDetail(entry.detail);

  const handleClick = () => {
    if (isToolCall) setExpanded(!expanded);
    onClick(entry);
  };

  return html`
    <div
      className="activity-entry ${AGENT_COLORS[entry.agent] || ""}"
      onClick=${handleClick}
    >
      <span className="activity-time">${formatTime(entry.timestamp)}</span>
      <i className="${getIcon(entry.type)}"></i>
      <span className="activity-agent">${entry.agent}</span>
      <span className="activity-detail">
        ${expanded ? detailStr : detailStr.slice(0, 120)}
        ${!expanded && detailStr.length > 120 ? "..." : ""}
      </span>
    </div>
  `;
};

const formatDetailRaw = (detail) => {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
};

const DetailModal = ({ entry, onClose }) => {
  if (!entry) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return html`
    <div className="activity-modal-overlay" onClick=${handleOverlayClick}>
      <div className="activity-modal">
        <div className="activity-modal-header">
          <div>
            <strong>${entry.agent}</strong>
            <span className="activity-modal-type">${entry.type}</span>
            <span className="activity-modal-time"
              >${formatTime(entry.timestamp)}</span
            >
          </div>
          <button className="activity-modal-close" onClick=${onClose}>
            <i className="ph ph-x"></i>
          </button>
        </div>
        <pre className="activity-modal-body">
${formatDetailRaw(entry.detail)}</pre
        >
      </div>
    </div>
  `;
};

export const ActivityLog = ({ activities }) => {
  const endRef = React.useRef(null);
  const [selectedEntry, setSelectedEntry] = React.useState(null);

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
          (entry, i) =>
            html`<${ActivityEntry}
              key=${i}
              entry=${entry}
              onClick=${setSelectedEntry}
            />`,
        )}
        <div ref=${endRef}></div>
      </div>
      <${DetailModal}
        entry=${selectedEntry}
        onClose=${() => setSelectedEntry(null)}
      />
    </div>
  `;
};
