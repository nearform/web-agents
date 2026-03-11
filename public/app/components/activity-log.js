/* global document:false, navigator:false, setTimeout:false */
import { html } from "../util/html.js";
import React from "react";
import { ActivityType } from "../util/activity.js";

const AGENT_COLORS = {
  Coordinator: "agent-coordinator",
  Researcher: "agent-researcher",
  Writer: "agent-writer",
  System: "agent-system",
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
    case ActivityType.SYSTEM:
      return "ph ph-terminal";
    default:
      return "ph ph-dot";
  }
};

const formatDetail = (type, detail) => {
  if (typeof detail === "string") return detail;
  if (type === "tool-call" && detail?.name) {
    return `${detail.name}(${detail.args ? JSON.stringify(detail.args) : ""})`;
  }
  if (type === "tool-result" && detail?.name) {
    const preview =
      typeof detail.result === "string"
        ? detail.result
        : JSON.stringify(detail.result);
    return `${detail.name} → ${preview}`;
  }
  if (type === "tool-error" && detail?.name) {
    return `${detail.name} ✗ ${detail.error || "unknown error"}`;
  }
  if (detail?.summary) return detail.summary;
  return JSON.stringify(detail);
};

const isExpandable = (entry) => {
  if (typeof entry.detail === "object" && entry.detail !== null) return true;
  const str = formatDetail(entry.type, entry.detail);
  return str.length > 120;
};

const ActivityEntry = ({ entry, onClick }) => {
  const expandable = isExpandable(entry);
  const detailStr = formatDetail(entry.type, entry.detail);

  return html`
    <div
      className="activity-entry ${AGENT_COLORS[entry.agent] || ""} ${expandable
        ? "expandable"
        : ""}"
      onClick=${() => expandable && onClick(entry)}
    >
      <span className="activity-time">${formatTime(entry.timestamp)}</span>
      <i className="${getIcon(entry.type)}"></i>
      <span className="activity-agent">${entry.agent}</span>
      <span className="activity-detail">
        ${detailStr.slice(0, 120)}${detailStr.length > 120 ? "..." : ""}
      </span>
    </div>
  `;
};

const formatDetailRaw = (detail) => {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (detail?.prompt && typeof detail.prompt === "string") {
    const parts = [];
    if (detail.kind) parts.push(`[${detail.kind}]`);
    if (detail.summary) parts.push(detail.summary);
    parts.push("---");
    parts.push(detail.prompt);
    return parts.join("\n");
  }
  try {
    const display = { ...detail };
    for (const [key, val] of Object.entries(display)) {
      if (
        typeof val === "string" &&
        (val.startsWith("{") || val.startsWith("["))
      ) {
        try {
          display[key] = JSON.parse(val);
        } catch {} // eslint-disable-line no-empty
      }
    }
    return JSON.stringify(display, null, 2);
  } catch {
    return String(detail);
  }
};

const DetailModal = ({ entry, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!entry) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [entry, onClose]);

  if (!entry) return null;

  const rawText = formatDetailRaw(entry.detail);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          <div className="activity-modal-header-actions">
            <button
              className="tool-modal-copy-btn"
              onClick=${handleCopy}
              title=${copied ? "Copied!" : "Copy raw content"}
            >
              <i className="ph ph-${copied ? "check" : "copy"}"></i>
              ${copied &&
              html`<span className="tool-modal-copy-tooltip">Copied!</span>`}
            </button>
            <button className="activity-modal-close" onClick=${onClose}>
              <i className="ph ph-x"></i>
            </button>
          </div>
        </div>
        <pre className="activity-modal-body">${rawText}</pre>
      </div>
    </div>
  `;
};

export const ActivityLog = ({ activities, collapsed, onToggle }) => {
  const endRef = React.useRef(null);
  const [selectedEntry, setSelectedEntry] = React.useState(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities.length]);

  if (collapsed) {
    return html`
      <button
        type="button"
        className="activity-panel panel-collapsed"
        onClick=${onToggle}
        aria-label="Expand activity panel"
      >
        <div className="panel-collapsed-inner">
          <i className="ph ph-activity"></i>
          <span className="panel-collapsed-label">Activity</span>
          <i className="ph ph-caret-right panel-collapsed-chevron"></i>
        </div>
      </button>
    `;
  }

  return html`
    <div className="activity-panel">
      <div className="activity-header">
        <i className="ph ph-activity"></i>
        <h2>Agent Activity</h2>
        <button
          type="button"
          className="panel-toggle-btn"
          onClick=${onToggle}
          title="Collapse panel"
          aria-label="Collapse activity panel"
        >
          <i className="ph ph-caret-left"></i>
        </button>
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
