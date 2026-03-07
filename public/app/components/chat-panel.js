import { html } from "../util/html.js";

export const ChatPanel = ({ messages, onSend, onChoice, isProcessing, pendingChoice }) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    const input = e.currentTarget.elements.message;
    const text = input.value.trim();
    if (!text || isProcessing || pendingChoice) return;
    onSend(text);
    input.value = "";
  };

  const inputDisabled = isProcessing || pendingChoice;

  return html`
    <div className="chat-panel">
      <div className="chat-header">
        <i className="ph ph-chat-circle-text"></i>
        <h2>Chat</h2>
      </div>
      <div className="chat-messages">
        ${messages.length === 0 &&
        html`
          <div className="chat-empty">
            Ask a question about Nearform's content to see the agents
            collaborate.
          </div>
        `}
        ${messages.map(
          (msg, i) => html`
            <div key=${i} className="chat-bubble chat-bubble--${msg.role}">
              ${msg.role === "assistant" &&
              html`<span className="chat-agent-label">Coordinator</span>`}
              ${msg.type === "choice"
                ? html`
                    <div className="chat-bubble-text">${msg.text}</div>
                    <div className="chat-choice-buttons">
                      <button
                        className="chat-choice-btn chat-choice-btn--fresh"
                        onClick=${() => onChoice("fresh")}
                        disabled=${!pendingChoice}
                      >
                        <i className="ph ph-arrow-counter-clockwise"></i> Start Fresh
                      </button>
                      <button
                        className="chat-choice-btn chat-choice-btn--build"
                        onClick=${() => onChoice("build")}
                        disabled=${!pendingChoice}
                      >
                        <i className="ph ph-plus-circle"></i> Build On Existing
                      </button>
                    </div>
                  `
                : html`<div className="chat-bubble-text">${msg.text}</div>`}
            </div>
          `,
        )}
        ${isProcessing &&
        html`
          <div className="chat-bubble chat-bubble--assistant">
            <div className="chat-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        `}
      </div>
      <form className="chat-input-form" onSubmit=${handleSubmit}>
        <textarea
          name="message"
          className="chat-input"
          placeholder="Ask about Nearform's AI articles, services..."
          rows="2"
          disabled=${inputDisabled}
          onKeyDown=${(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form.requestSubmit();
            }
          }}
        ></textarea>
        <button
          type="submit"
          className="chat-send-btn ${inputDisabled ? "disabled" : ""}"
          disabled=${inputDisabled}
        >
          <i className="ph ph-paper-plane-tilt"></i>
        </button>
      </form>
    </div>
  `;
};
