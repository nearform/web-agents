/* global document:false */
import { html } from "../util/html.js";
import React from "react";

/**
 * Platform Status Modal — shows LanguageModel API and WebMCP status
 * with setup instructions when features are missing.
 */
export const PlatformStatusModal = ({ platformStatus, onClose }) => {
  React.useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!platformStatus) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const { languageModel, webMcp, isChrome } = platformStatus;

  const lmOk = languageModel.available;
  const webMcpOk = webMcp.native;
  const webMcpPolyfilled = webMcp.polyfilled;

  return html`
    <div className="activity-modal-overlay" onClick=${handleOverlayClick}>
      <div className="activity-modal">
        <div className="activity-modal-header">
          <div><strong>Platform Status</strong></div>
          <button className="activity-modal-close" onClick=${onClose}>
            <i className="ph ph-x"></i>
          </button>
        </div>
        <div className="platform-status-body">
          <div className="platform-status-row">
            <span
              className="platform-status-dot ${lmOk ? "ok" : "error"}"
            ></span>
            <strong>LanguageModel API</strong>
            <span className="platform-status-label">
              ${lmOk ? "Available" : "Not Available"}
            </span>
            ${webMcp.chromeVersion != null &&
            html`
              <span className="platform-status-chrome-ver"
                >Chrome ${webMcp.chromeVersion}</span
              >
            `}
          </div>
          ${!lmOk &&
          html`
            <div className="platform-status-instructions">
              ${!isChrome
                ? html`<p>
                    This feature requires <strong>Chrome 138+</strong>. Your
                    current browser is not supported.
                  </p>`
                : html`
                    <p>To enable the LanguageModel (Prompt) API:</p>
                    <ol>
                      <li>Use <strong>Chrome 138+</strong></li>
                      <li>
                        Open
                        <code
                          >chrome://flags/#optimization-guide-on-device-model</code
                        >
                        and set to <strong>Enabled</strong>
                      </li>
                      <li>
                        Open
                        <code
                          >chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code
                        >
                        and set to <strong>Enabled</strong>
                      </li>
                      <li>Relaunch Chrome</li>
                    </ol>
                  `}
            </div>
          `}

          <div className="platform-status-row">
            <span
              className="platform-status-dot ${webMcpOk
                ? "ok"
                : webMcpPolyfilled
                  ? "warn"
                  : "error"}"
            ></span>
            <strong>WebMCP</strong>
            <span className="platform-status-label">
              ${webMcpOk
                ? "Native"
                : webMcpPolyfilled
                  ? "Polyfilled"
                  : "Not Available"}
            </span>
            ${webMcp.chromeVersion != null &&
            html`
              <span className="platform-status-chrome-ver"
                >Chrome ${webMcp.chromeVersion}</span
              >
            `}
          </div>
          ${!webMcpOk &&
          html`
            <div className="platform-status-instructions">
              ${!isChrome
                ? html`<p>
                    This feature requires <strong>Chrome 146+</strong>. Your
                    current browser is not supported.
                  </p>`
                : html`
                    <p>To enable native WebMCP:</p>
                    <ol>
                      <li>Use <strong>Chrome 146+</strong></li>
                      <li>
                        Open <code>chrome://flags</code> and search for
                        <strong>WebMCP</strong>
                      </li>
                      <li>Enable <strong>"WebMCP for testing"</strong></li>
                      <li>Relaunch Chrome</li>
                    </ol>
                  `}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
};
