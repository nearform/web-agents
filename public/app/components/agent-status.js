import { html } from "../util/html.js";
import React from "react";

const AGENTS = ["Coordinator", "Researcher", "Writer"];

const AgentDetailModal = ({ agent, status, onClose }) => {
  if (!agent) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return html`
    <div className="activity-modal-overlay" onClick=${handleOverlayClick}>
      <div className="activity-modal">
        <div className="activity-modal-header">
          <div>
            <strong>${agent}</strong>
            <span className="activity-modal-type">${status.status}</span>
          </div>
          <button className="activity-modal-close" onClick=${onClose}>
            <i className="ph ph-x"></i>
          </button>
        </div>
        <div className="activity-modal-body">
          ${status.contextPct != null
            ? `Context usage: ${status.contextPct}%\nStatus: ${status.status}`
            : `Status: ${status.status}\nNo context data available`}
        </div>
      </div>
    </div>
  `;
};

export const AgentStatus = ({ statuses }) => {
  const [selectedAgent, setSelectedAgent] = React.useState(null);

  return html`
    <div className="agent-status-bar">
      <span className="tool-status-label">
        <i className="ph ph-robot"></i> Agents
      </span>
      ${AGENTS.map((name) => {
        const s = statuses[name] || { status: "idle" };
        return html`
          <span
            key=${name}
            className="tool-status-item"
            onClick=${() => setSelectedAgent(name)}
          >
            <span
              className="agent-status-dot ${s.status}"
              style=${{
                "--agent-color": `var(--agent-${name.toLowerCase()})`,
              }}
            ></span>
            <span className="tool-status-name">${name}</span>
            ${s.status === "active" &&
            s.contextPct != null &&
            html`<span className="agent-context-badge">${s.contextPct}%</span>`}
          </span>
        `;
      })}
    </div>
    <${AgentDetailModal}
      agent=${selectedAgent}
      status=${statuses[selectedAgent] || { status: "idle" }}
      onClose=${() => setSelectedAgent(null)}
    />
  `;
};
