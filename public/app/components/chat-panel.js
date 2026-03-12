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
  collapsed,
  onToggle,
  onStop,
  stoppedState,
  onStopContinue,
  onStopNewQuery,
}) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    const input = e.currentTarget.elements.message;
    const text = input.value.trim();
    if (!text || !ready || isProcessing) return;
    onSend(text);
    input.value = "";
  };

  const hasMessages = messages.length > 0;
  const showStartFresh = hasNotepad && !isProcessing && !stoppedState;

  if (collapsed) {
    return html`
      <button
        type="button"
        className="chat-panel panel-collapsed"
        onClick=${onToggle}
        aria-label="Expand chat panel"
      >
        <div className="panel-collapsed-inner">
          <i className="ph ph-chat-circle-text"></i>
          <span className="panel-collapsed-label">Chat</span>
          <i className="ph ph-caret-right panel-collapsed-chevron"></i>
        </div>
      </button>
    `;
  }

  return html`
    <div className="chat-panel">
      <div className="chat-header">
        <i className="ph ph-chat-circle-text"></i>
        <h2>Chat</h2>
        <button
          type="button"
          className="panel-toggle-btn"
          onClick=${onToggle}
          title="Collapse panel"
          aria-label="Collapse chat panel"
        >
          <i className="ph ph-caret-left"></i>
        </button>
      </div>
      <div className="chat-messages">
        ${!hasMessages &&
        !stoppedState &&
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
        ${stoppedState &&
        html`
          <div
            className="chat-bubble chat-bubble--assistant chat-bubble--stopped"
          >
            <span className="chat-agent-label">
              Coordinator
              <span className="chat-stopped-label">Stopped</span>
            </span>
            ${stoppedState.partialText
              ? html`<${ChatBubbleText}
                  text=${stoppedState.partialText}
                  isAssistant=${true}
                />`
              : html`<div className="chat-bubble-text chat-stopped-empty">
                  Processing was stopped before a response was generated.
                </div>`}
          </div>
          <div className="chat-stopped-options">
            <button
              className="chat-stopped-option-btn chat-stopped-option--continue"
              onClick=${onStopContinue}
            >
              <i className="ph ph-play"></i> Continue
            </button>
            <button
              className="chat-stopped-option-btn chat-stopped-option--new"
              onClick=${onStopNewQuery}
            >
              <i className="ph ph-arrow-bend-up-left"></i> New query
            </button>
            <button
              className="chat-stopped-option-btn chat-stopped-option--restart"
              onClick=${onStartFresh}
            >
              <i className="ph ph-arrow-counter-clockwise"></i> Start fresh
            </button>
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
        <div className="chat-input-wrapper">
          <textarea
            name="message"
            className="chat-input"
            placeholder=${stoppedState
              ? "Type a follow-up or new question..."
              : hasNotepad
                ? "Ask a follow-up question to build on the notepad, or start fresh..."
                : "Ask about Nearform's AI articles, services..."}
            rows="2"
            disabled=${!ready || (isProcessing && !stoppedState)}
            onKeyDown=${(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form.requestSubmit();
              }
            }}
          ></textarea>
          ${isProcessing
            ? html`
                <button
                  type="button"
                  className="chat-send-btn chat-stop-btn"
                  onClick=${onStop}
                  title="Stop processing"
                  aria-label="Stop processing"
                >
                  <i className="ph ph-stop-circle"></i>
                </button>
              `
            : html`
                <button
                  type="submit"
                  className="chat-send-btn ${!ready ||
                  (isProcessing && !stoppedState)
                    ? "disabled"
                    : ""}"
                  disabled=${!ready || (isProcessing && !stoppedState)}
                >
                  <i className="ph ph-paper-plane-tilt"></i>
                </button>
              `}
        </div>
      </form>
    </div>
  `;
};
