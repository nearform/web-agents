import React from "react";
import { html } from "../util/html.js";

const renderMarkdown = (text) => {
  if (!text) return "";

  return text
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
};

export const NotepadPanel = ({ content, onUpdateContent }) => {
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(content);

  React.useEffect(() => {
    if (!editing) setEditText(content);
  }, [content, editing]);

  const handleStartEdit = () => {
    setEditText(content);
    setEditing(true);
  };

  const handleSave = () => {
    onUpdateContent(editText);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditText(content);
    setEditing(false);
  };

  return html`
    <div className="notepad-panel">
      <div className="notepad-header">
        <div className="notepad-header-left">
          <i className="ph ph-notepad"></i>
          <h2>Notepad</h2>
        </div>
        ${content &&
        !editing &&
        html`
          <button
            className="notepad-edit-btn"
            onClick=${handleStartEdit}
            title="Edit notepad"
          >
            <i className="ph ph-pencil-simple"></i>
          </button>
        `}
        ${editing &&
        html`
          <div className="notepad-edit-actions">
            <button
              className="notepad-edit-btn notepad-save-btn"
              onClick=${handleSave}
              title="Save"
            >
              <i className="ph ph-check"></i>
            </button>
            <button
              className="notepad-edit-btn notepad-cancel-btn"
              onClick=${handleCancel}
              title="Cancel"
            >
              <i className="ph ph-x"></i>
            </button>
          </div>
        `}
      </div>
      ${!content &&
      html`
        <div className="notepad-description">
          Your working document. Agents write here, and you can edit it too.
          Content is used as context for follow-up queries.
        </div>
      `}
      <div className="notepad-content">
        ${editing
          ? html`<textarea
              className="notepad-editor"
              value=${editText}
              onChange=${(e) => setEditText(e.target.value)}
            />`
          : content
            ? html`<div
                className="notepad-rendered"
                dangerouslySetInnerHTML=${{ __html: renderMarkdown(content) }}
              />`
            : html`
                <div className="notepad-empty">
                  The Writer agent will compose content here.
                </div>
              `}
      </div>
    </div>
  `;
};
