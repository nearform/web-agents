/* global document:false */
import { html } from "../util/html.js";
import React from "react";

/**
 * Platform Status Modal — shows LanguageModel API, DecisionModel API and WebMCP status
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

  const { languageModel, decisionModel, webMcp, isChrome } = platformStatus;

  const lmOk = languageModel.available;
  const decisionOk = decisionModel.available;
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
            ${
              webMcp.chromeVersion != null &&
              html`
                <span className="platform-status-chrome-ver"
                  >Chrome ${webMcp.chromeVersion}</span
                >
              `
            }
          </div>
          ${
            !lmOk &&
            html`
              <div className="platform-status-instructions">
                ${
                  !isChrome
                    ? html`<p>
                        This feature requires <strong>Chrome 138+</strong>. Your
                        current browser is not supported.
                      </p>`
                    : html`
                        <p>To enable the LanguageModel (Prompt) API:</p>
                        <ol>
                          <li>Use <strong>Chrome 138+</strong></li>
                          <li>
                            Open <code>chrome://flags/#prompt-api</code> and set
                            to <strong>Enabled</strong>
                          </li>
                          <li>
                            Open <code>chrome://settings/ai</code> and turn on
                            <strong>"On-device AI"</strong>
                          </li>
                          <li>Relaunch Chrome</li>
                        </ol>
                      `
                }
              </div>
            `
          }

          <div className="platform-status-row">
            <span
              className="platform-status-dot ${decisionOk ? "ok" : "warn"}"
            ></span>
            <strong>DecisionModel API</strong>
            <span className="platform-status-label">
              ${
                !decisionOk
                  ? (decisionModel.reason ?? "Not Available")
                  : decisionModel.status === "available"
                    ? "Available"
                    : `Available (${decisionModel.status})`
              }
            </span>
          </div>
          ${
            !decisionOk &&
            html`
              <div className="platform-status-instructions">
                <p>
                  Optional. Without it, triage uses the Prompt API. To enable
                  the Decisions API:
                </p>
                <ol>
                  <li>
                    Open <code>chrome://flags/#decisions-api</code> and set to
                    ${" "}<strong>Enabled</strong>
                  </li>
                  <li>Relaunch Chrome</li>
                </ol>
              </div>
            `
          }

          <div className="platform-status-row">
            <span
              className="platform-status-dot ${
                webMcpOk ? "ok" : webMcpPolyfilled ? "warn" : "error"
              }"
            ></span>
            <strong>WebMCP</strong>
            <span className="platform-status-label">
              ${
                webMcpOk
                  ? "Native"
                  : webMcpPolyfilled
                    ? "Polyfilled"
                    : "Not Available"
              }
            </span>
            ${
              webMcp.chromeVersion != null &&
              html`
                <span className="platform-status-chrome-ver"
                  >Chrome ${webMcp.chromeVersion}</span
                >
              `
            }
          </div>
          ${
            !webMcpOk &&
            html`
              <div className="platform-status-instructions">
                ${
                  !isChrome
                    ? html`<p>
                        Native WebMCP requires <strong>Chrome 146+</strong>.
                        Your current browser is not
                        supported${
                          webMcpPolyfilled
                            ? ", but a polyfill is active to provide functionality"
                            : ""
                        }.
                      </p>`
                    : html`
                        <p>To enable native WebMCP:</p>
                        <ol>
                          <li>Use <strong>Chrome 146+</strong></li>
                          <li>
                            Open
                            <code>chrome://flags/#enable-webmcp-testing</code>
                            ${" "}and set to <strong>Enabled</strong>
                          </li>
                          <li>Relaunch Chrome</li>
                        </ol>
                      `
                }
              </div>
            `
          }
        </div>
      </div>
    </div>
  `;
};
