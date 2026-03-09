/* global navigator:false, setTimeout:false */
import { html } from "../util/html.js";
import React from "react";

const AGENTS = ["Coordinator", "Researcher", "Writer"];

const AgentDetailModal = ({ agent, status, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  if (!agent) return null;

  const rawText =
    status.contextPct != null
      ? `Context: ${status.contextUsed} / ${status.contextTotal} tokens (${status.contextPct}%)\nAvailable: ${status.contextTotal - status.contextUsed} tokens\nStatus: ${status.status}`
      : `Status: ${status.status}\nNo context data available`;

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
            <strong>${agent}</strong>
            <span className="activity-modal-type">${status.status}</span>
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
        <div className="activity-modal-body">${rawText}</div>
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
            ${s.contextPct != null &&
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
