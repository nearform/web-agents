import React from "react";
import { html } from "../util/html.js";
import { renderMarkdown } from "../util/markdown.js";

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
          <h2>Research Notepad</h2>
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
          Research findings will appear here. You can edit them to refine
          context for follow-up queries.
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
                  Research findings will appear here once you ask a question.
                </div>
              `}
      </div>
    </div>
  `;
};
