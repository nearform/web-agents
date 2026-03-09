/* global navigator:false, setTimeout:false */
import { html } from "../util/html.js";
import React from "react";
import { callTool } from "../bridge/tool-registry.js";

const buildInitialArgs = (schema) => {
  const args = {};
  if (!schema?.properties) return args;
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.type === "boolean") args[key] = false;
    else if (prop.type === "number" || prop.type === "integer") args[key] = "";
    else args[key] = "";
  }
  return args;
};

const ToolDetailModal = ({ tool, onClose }) => {
  if (!tool) return null;

  const [args, setArgs] = React.useState(() =>
    buildInitialArgs(tool.inputSchema),
  );
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (result == null) return;
    const text = result.ok
      ? JSON.stringify(result.data, null, 2)
      : `Error: ${result.data}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const properties = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];
  const propEntries = Object.entries(properties);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleChange = (key, value, type) => {
    setArgs((prev) => ({
      ...prev,
      [key]: type === "boolean" ? value : value,
    }));
  };

  const handleExecute = async () => {
    setLoading(true);
    setResult(null);
    try {
      const parsed = {};
      for (const [key, prop] of Object.entries(properties)) {
        const val = args[key];
        if (val === "" || val === undefined) continue;
        if (prop.type === "number" || prop.type === "integer") {
          parsed[key] = Number(val);
        } else if (prop.type === "boolean") {
          parsed[key] = val;
        } else {
          parsed[key] = val;
        }
      }
      const res = await callTool(tool.name, parsed);
      setResult({ ok: true, data: res });
    } catch (err) {
      setResult({ ok: false, data: err.message });
    } finally {
      setLoading(false);
    }
  };

  const canExecute = tool.connected !== false && !loading;

  return html`
    <div className="activity-modal-overlay" onClick=${handleOverlayClick}>
      <div className="tool-modal">
        <div className="activity-modal-header">
          <div>
            <strong>${tool.name}</strong>
            <span className="tool-modal-source">${tool.source}</span>
            ${tool.connected !== false &&
            html`<span
              className="tool-status-dot connected"
              style=${{ display: "inline-block", marginLeft: 8 }}
            ></span>`}
            ${tool.connected === false &&
            html`<span
              className="tool-status-dot disconnected"
              style=${{ display: "inline-block", marginLeft: 8 }}
            ></span>`}
          </div>
          <button className="activity-modal-close" onClick=${onClose}>
            <i className="ph ph-x"></i>
          </button>
        </div>

        <div className="tool-modal-body">
          <div className="tool-modal-left">
            <div className="tool-modal-schema">
              ${tool.description &&
              html`<div className="tool-modal-description">
                ${tool.description}
              </div>`}
              ${propEntries.length > 0 &&
              html`
                <table className="tool-modal-properties">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${propEntries.map(
                      ([name, prop]) => html`
                        <tr key=${name}>
                          <td>
                            <code>${name}</code>
                            ${required.includes(name) &&
                            html`<span className="tool-modal-required">
                              ${" "}*</span
                            >`}
                          </td>
                          <td>${prop.type || "any"}</td>
                          <td>${prop.description || ""}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              `}
            </div>

            ${propEntries.length > 0 &&
            html`
              <div className="tool-modal-form">
                ${propEntries.map(([name, prop]) => {
                  if (prop.type === "boolean") {
                    return html`
                      <label key=${name} className="tool-modal-field">
                        <span className="tool-modal-label"
                          >${name}${required.includes(name) ? " *" : ""}</span
                        >
                        <input
                          type="checkbox"
                          checked=${args[name] || false}
                          onChange=${(e) =>
                            handleChange(name, e.target.checked, "boolean")}
                        />
                      </label>
                    `;
                  }
                  if (prop.type === "number" || prop.type === "integer") {
                    return html`
                      <label key=${name} className="tool-modal-field">
                        <span className="tool-modal-label"
                          >${name}${required.includes(name) ? " *" : ""}</span
                        >
                        <input
                          type="number"
                          className="tool-modal-input"
                          value=${args[name] || ""}
                          placeholder=${prop.description || name}
                          onChange=${(e) => handleChange(name, e.target.value)}
                        />
                      </label>
                    `;
                  }
                  return html`
                    <label key=${name} className="tool-modal-field">
                      <span className="tool-modal-label"
                        >${name}${required.includes(name) ? " *" : ""}</span
                      >
                      <textarea
                        className="tool-modal-input"
                        rows=${2}
                        value=${args[name] || ""}
                        placeholder=${prop.description || name}
                        onChange=${(e) => handleChange(name, e.target.value)}
                      />
                    </label>
                  `;
                })}
              </div>
            `}

            <div className="tool-modal-actions">
              <button
                className="tool-modal-execute"
                disabled=${!canExecute}
                onClick=${handleExecute}
              >
                ${loading ? "Executing..." : "Execute"}
              </button>
              ${tool.connected === false &&
              html`<span style=${{ fontSize: "0.75rem", color: "#ef4444" }}
                >Tool disconnected</span
              >`}
            </div>
          </div>

          <div className="tool-modal-right">
            <div className="tool-modal-right-header">
              <span>Output</span>
              ${result != null &&
              html`
                <button
                  className="tool-modal-copy-btn"
                  onClick=${handleCopy}
                  title=${copied ? "Copied!" : "Copy raw result"}
                >
                  <i className="ph ph-${copied ? "check" : "copy"}"></i>
                  ${copied &&
                  html`<span className="tool-modal-copy-tooltip"
                    >Copied!</span
                  >`}
                </button>
              `}
            </div>
            <pre className="tool-modal-result">
${result == null
                ? "No output yet. Execute the tool to see results."
                : result.ok
                  ? JSON.stringify(result.data, null, 2)
                  : `Error: ${result.data}`}</pre
            >
          </div>
        </div>
      </div>
    </div>
  `;
};

export const ToolStatus = ({ tools }) => {
  const [selectedTool, setSelectedTool] = React.useState(null);

  return html`
    <div className="tool-status-bar">
      <span className="tool-status-label">
        <i className="ph ph-plugs-connected"></i> Tools
      </span>
      ${tools.map(
        (tool) => html`
          <span
            key=${tool.name}
            className="tool-status-item"
            onClick=${() => setSelectedTool(tool)}
          >
            <span
              className="tool-status-dot ${tool.connected
                ? "connected"
                : "disconnected"}"
            ></span>
            <span className="tool-status-name">${tool.name}</span>
          </span>
        `,
      )}
      ${tools.length === 0 &&
      html`<span className="tool-status-none">Discovering tools...</span>`}
    </div>
    <${ToolDetailModal}
      tool=${selectedTool}
      onClose=${() => setSelectedTool(null)}
    />
  `;
};
