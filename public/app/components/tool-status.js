import { html } from "../util/html.js";

export const ToolStatus = ({ tools }) => {
  return html`
    <div className="tool-status-bar">
      <span className="tool-status-label">
        <i className="ph ph-plugs-connected"></i> Tools
      </span>
      ${tools.map(
        (tool) => html`
          <span key=${tool.name} className="tool-status-item">
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
  `;
};
