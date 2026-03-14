/* global navigator:false, setTimeout:false */
import { html } from "../util/html.js";
import React from "react";

const AGENTS = ["Coordinator", "Researcher", "Writer"];

const AgentDetailModal = ({ agent, status, prevStatus, prompts, onClose }) => {
  const [copied, setCopied] = React.useState(false);
  const [tab, setTab] = React.useState("context");

  // Reset tab when agent changes
  React.useEffect(() => {
    setTab("context");
  }, [agent]);

  if (!agent) return null;

  const contextText =
    status.contextPct != null
      ? `Context: ${status.contextUsed} / ${status.contextTotal} tokens (${status.contextPct}%)\nAvailable: ${status.contextTotal - status.contextUsed} tokens\nStatus: ${status.status}`
      : `Status: ${status.status}\nNo context data available`;

  const prevText =
    prevStatus?.contextPct != null
      ? `\n\nPrevious run:\nContext: ${prevStatus.contextUsed} / ${prevStatus.contextTotal} tokens (${prevStatus.contextPct}%)\nStatus: ${prevStatus.status}`
      : "";

  const getTabContent = () => {
    if (tab === "system") return prompts?.systemPrompt || null;
    if (tab === "user") return prompts?.lastUserPrompt || null;
    return contextText + prevText;
  };

  const tabContent = getTabContent();

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tabContent || "");
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
        <div className="agent-modal-tabs">
          <button
            className="agent-modal-tab ${tab === "context" ? "active" : ""}"
            onClick=${() => setTab("context")}
          >
            Context
          </button>
          <button
            className="agent-modal-tab ${tab === "system" ? "active" : ""}"
            onClick=${() => setTab("system")}
          >
            System Prompt
          </button>
          <button
            className="agent-modal-tab ${tab === "user" ? "active" : ""}"
            onClick=${() => setTab("user")}
          >
            Last Prompt
          </button>
        </div>
        <div className="activity-modal-body">
          ${tab === "context" &&
          html`${contextText}
          ${prevText &&
          html`<div className="agent-detail-prev">${prevText.trim()}</div>`}`}
          ${tab === "system" &&
          (prompts?.systemPrompt
            ? html`${prompts.systemPrompt}`
            : html`<div className="agent-modal-empty">
                No prompt captured yet
              </div>`)}
          ${tab === "user" &&
          (prompts?.lastUserPrompt
            ? html`${prompts.lastUserPrompt}`
            : html`<div className="agent-modal-empty">
                No prompt captured yet
              </div>`)}
        </div>
      </div>
    </div>
  `;
};

export const AgentStatus = ({ statuses, prevStatuses, prompts }) => {
  const [selectedAgent, setSelectedAgent] = React.useState(null);

  return html`
    <div className="agent-status-bar">
      <span className="tool-status-label">
        <i className="ph ph-robot"></i> Agents
      </span>
      ${AGENTS.map((name) => {
        const s = statuses[name] || { status: "idle" };
        const prev = prevStatuses?.[name];
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
            ${prev?.contextPct != null &&
            html`<span
              className="agent-context-badge agent-context-badge--prev"
              title="Previous run"
              >${prev.contextPct}%</span
            >`}
          </span>
        `;
      })}
    </div>
    <${AgentDetailModal}
      agent=${selectedAgent}
      status=${statuses[selectedAgent] || { status: "idle" }}
      prevStatus=${prevStatuses?.[selectedAgent]}
      prompts=${prompts?.[selectedAgent]}
      onClose=${() => setSelectedAgent(null)}
    />
  `;
};
