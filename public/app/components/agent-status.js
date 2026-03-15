/* global navigator:false, setTimeout:false */
import { html } from "../util/html.js";
import React from "react";

const AGENTS = ["Coordinator", "Researcher", "Writer"];

const HistoryEntries = ({ entries, expanded, toggle, idPrefix }) => {
  let promptNum = 0;
  let answerNum = 0;
  const numbered = entries.map((entry) => {
    if (entry.role === "user") {
      promptNum++;
      return { ...entry, label: `Prompt #${promptNum}`, num: promptNum };
    }
    answerNum++;
    return { ...entry, label: `Answer #${answerNum}`, num: answerNum };
  });

  return numbered.map((entry, idx) => {
    const key = `${idPrefix}-${idx}`;
    const isOpen = expanded.has(key);
    const preview =
      entry.text?.length > 80
        ? entry.text.slice(0, 80) + "..."
        : entry.text || "";
    return html`
      <div
        key=${key}
        className="agent-history-item agent-history-${entry.role}"
      >
        <button
          className="agent-history-header"
          onClick=${() => toggle(key)}
          aria-expanded=${isOpen}
        >
          <span className="agent-history-chevron ${isOpen ? "open" : ""}">
            <i className="ph ph-caret-right"></i>
          </span>
          <span className="agent-history-role"
            >${entry.role === "user" ? "PROMPT" : "ANSWER"}</span
          >
          <span className="agent-history-label">${entry.label}</span>
          <span className="agent-history-time">${entry.timestamp}</span>
          ${!isOpen &&
          html`<span className="agent-history-preview">${preview}</span>`}
        </button>
        ${isOpen &&
        html`<div className="agent-history-body">
          <pre>${entry.text || "(empty)"}</pre>
        </div>`}
      </div>
    `;
  });
};

const HistoryAccordion = ({ history }) => {
  const [expanded, setExpanded] = React.useState(new Set());

  if (!history || history.length === 0) {
    return html`<div className="agent-modal-empty">No history yet</div>`;
  }

  const toggle = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Group entries by run number
  const runGroups = [];
  const runMap = new Map();
  for (const entry of history) {
    const run = entry.run ?? 1;
    if (!runMap.has(run)) {
      const group = { run, entries: [] };
      runMap.set(run, group);
      runGroups.push(group);
    }
    runMap.get(run).entries.push(entry);
  }

  // Single run — show flat view (no grouping)
  if (runGroups.length === 1) {
    return html`
      <div className="agent-history-list">
        <${HistoryEntries}
          entries=${runGroups[0].entries}
          expanded=${expanded}
          toggle=${toggle}
          idPrefix="r1"
        />
      </div>
    `;
  }

  // Default: most recent run expanded
  const latestRun = runGroups[runGroups.length - 1].run;
  const isRunExpanded = (run) => {
    const key = `run-${run}`;
    // If user hasn't toggled anything yet, expand the latest run
    if (!expanded.has("__toggled")) {
      return run === latestRun;
    }
    return expanded.has(key);
  };

  const toggleRun = (run) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add("__toggled");
      const key = `run-${run}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return html`
    <div className="agent-history-list">
      ${runGroups.map((group) => {
        const open = isRunExpanded(group.run);
        const prompts = group.entries.filter((e) => e.role === "user").length;
        const answers = group.entries.filter((e) => e.role === "answer").length;
        const time = group.entries[0]?.timestamp || "";
        return html`
          <div key=${group.run} className="agent-history-run-group">
            <button
              className="agent-history-run-header"
              onClick=${() => toggleRun(group.run)}
              aria-expanded=${open}
            >
              <span className="agent-history-run-chevron ${open ? "open" : ""}">
                <i className="ph ph-caret-right"></i>
              </span>
              <span className="agent-history-run-label">Run #${group.run}</span>
              <span className="agent-history-time">${time}</span>
              ${!open &&
              html`<span className="agent-history-run-summary"
                >${prompts} prompt${prompts !== 1 ? "s" : ""}, ${answers}
                ${" "}answer${answers !== 1 ? "s" : ""}</span
              >`}
            </button>
            ${open &&
            html`<div className="agent-history-run-entries">
              <${HistoryEntries}
                entries=${group.entries}
                expanded=${expanded}
                toggle=${toggle}
                idPrefix=${"r" + group.run}
              />
            </div>`}
          </div>
        `;
      })}
    </div>
  `;
};

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
    if (tab === "history") return null; // handled separately
    return contextText + prevText;
  };

  const tabContent = getTabContent();

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleCopy = async () => {
    let text;
    if (tab === "history") {
      let pNum = 0;
      let aNum = 0;
      let lastRun = null;
      text = (prompts?.history || [])
        .map((entry) => {
          const label =
            entry.role === "user" ? `PROMPT #${++pNum}` : `ANSWER #${++aNum}`;
          const runHeader =
            entry.run != null && entry.run !== lastRun
              ? `=== Run #${entry.run} ===\n`
              : "";
          lastRun = entry.run;
          return `${runHeader}[${label} ${entry.timestamp}]\n${entry.text}\n---`;
        })
        .join("\n");
    } else {
      text = tabContent || "";
    }
    await navigator.clipboard.writeText(text);
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
            System
          </button>
          <button
            className="agent-modal-tab ${tab === "history" ? "active" : ""}"
            onClick=${() => setTab("history")}
          >
            History
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
          ${tab === "history" &&
          html`<${HistoryAccordion} history=${prompts?.history} />`}
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
