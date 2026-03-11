import React from "react";
import { html } from "../util/html.js";
import { renderMarkdown } from "../util/markdown.js";

const ChatBubbleText = ({ text, isAssistant }) => {
  const [showRaw, setShowRaw] = React.useState(false);

  if (!isAssistant) {
    return html`<div className="chat-bubble-text">${text}</div>`;
  }

  return html`
    <div className="chat-bubble-text">
      ${showRaw
        ? html`<pre className="chat-bubble-raw">${text}</pre>`
        : html`<div
            className="chat-bubble-rendered"
            dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}
          />`}
      <button
        className="chat-toggle-md"
        onClick=${() => setShowRaw((v) => !v)}
        title=${showRaw ? "Show formatted" : "Show raw markdown"}
      >
        <i className="ph ph-${showRaw ? "text-aa" : "code"}"></i>
      </button>
    </div>
  `;
};

export const ChatPanel = ({
  messages,
  onSend,
  onStartFresh,
  isProcessing,
  streamingText,
  hasNotepad,
  ready,
}) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    const input = e.currentTarget.elements.message;
    const text = input.value.trim();
    if (!text || !ready || isProcessing) return;
    onSend(text);
    input.value = "";
  };

  const inputDisabled = !ready || isProcessing;
  const hasMessages = messages.length > 0;
  const showStartFresh = hasNotepad && !isProcessing;

  return html`
    <div className="chat-panel">
      <div className="chat-header">
        <i className="ph ph-chat-circle-text"></i>
        <h2>Chat</h2>
      </div>
      <div className="chat-messages">
        ${!hasMessages &&
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
              <${ChatBubbleText}
                text=${msg.text}
                isAssistant=${msg.role === "assistant"}
              />
            </div>
          `,
        )}
        ${isProcessing &&
        streamingText &&
        html`
          <div className="chat-bubble chat-bubble--assistant">
            <span className="chat-agent-label">Coordinator</span>
            <${ChatBubbleText} text=${streamingText} isAssistant=${true} />
          </div>
        `}
        ${isProcessing &&
        !streamingText &&
        html`
          <div className="chat-bubble chat-bubble--assistant">
            <div className="chat-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        `}
        ${showStartFresh &&
        html`
          <div className="chat-start-fresh">
            <button className="chat-start-fresh-btn" onClick=${onStartFresh}>
              <i className="ph ph-arrow-counter-clockwise"></i> Clear notepad &
              start a new topic
            </button>
          </div>
        `}
      </div>
      <form className="chat-input-form" onSubmit=${handleSubmit}>
        <textarea
          name="message"
          className="chat-input"
          placeholder=${hasNotepad
            ? "Ask a follow-up question to build on the notepad, or start fresh..."
            : "Ask about Nearform's AI articles, services..."}
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
