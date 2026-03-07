import React from "react";
import { html } from "./util/html.js";
import { ChatPanel } from "./components/chat-panel.js";
import { ActivityLog } from "./components/activity-log.js";
import { NotepadPanel } from "./components/notepad-panel.js";
import { ToolStatus } from "./components/tool-status.js";
import { initRegistry, listTools } from "./bridge/tool-registry.js";
import { setNotepadCallback, updateNotepad } from "./tools/notepad-tools.js";
import { checkAvailability } from "./agents/prompt-api.js";
import { runCoordinator } from "./agents/coordinator.js";

export const App = () => {
  const [messages, setMessages] = React.useState([]);
  const [activities, setActivities] = React.useState([]);
  const [notepadContent, setNotepadContent] = React.useState("");
  const [tools, setTools] = React.useState([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [status, setStatus] = React.useState("Initializing...");
  const [pendingQuery, setPendingQuery] = React.useState(null);

  React.useEffect(() => {
    setNotepadCallback(setNotepadContent);

    const init = async () => {
      // Check Prompt API
      const apiCheck = await checkAvailability();
      if (!apiCheck.available) {
        setStatus(`Prompt API: ${apiCheck.reason}`);
      }

      // Init tool registry (discovers remote + local tools)
      const discovered = await initRegistry();
      setTools(discovered);

      if (apiCheck.available) {
        setStatus("Ready");
      }
    };

    init();
  }, []);

  const onActivity = React.useCallback((event) => {
    setActivities((prev) => [...prev, event]);
  }, []);

  const executeCoordinator = React.useCallback(
    async (text, existingNotepad) => {
      setIsProcessing(true);
      try {
        const currentTools = listTools();
        const answer = await runCoordinator({
          userMessage: text,
          tools: currentTools,
          onActivity,
          existingNotepad,
        });

        setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Error: ${err.message}`,
          },
        ]);
      } finally {
        setIsProcessing(false);
        setTools(listTools());
      }
    },
    [onActivity],
  );

  const handleSend = React.useCallback(
    (text) => {
      setMessages((prev) => [...prev, { role: "user", text }]);

      if (notepadContent) {
        // Notepad has content — ask user whether to start fresh or build on it
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            type: "choice",
            text: "The notepad already has content. Would you like to start fresh or build on what's there?",
          },
        ]);
        setPendingQuery(text);
      } else {
        // No notepad content — run immediately
        executeCoordinator(text, undefined);
      }
    },
    [notepadContent, executeCoordinator],
  );

  const handleChoice = React.useCallback(
    (choice) => {
      if (!pendingQuery) return;
      const query = pendingQuery;
      setPendingQuery(null);

      if (choice === "fresh") {
        // Clear everything, then run
        setMessages([{ role: "user", text: query }]);
        setActivities([]);
        setNotepadContent("");
        updateNotepad("");
        executeCoordinator(query, undefined);
      } else {
        // Build on existing
        executeCoordinator(query, notepadContent);
      }
    },
    [pendingQuery, notepadContent, executeCoordinator],
  );

  const handleUpdateNotepad = React.useCallback((content) => {
    setNotepadContent(content);
    updateNotepad(content);
  }, []);

  return html`
    <div className="app-container">
      <header className="app-header">
        <h1>WebMCP Multi-Agent Demo</h1>
        <p className="intro">
          Three AI agents collaborate using cross-origin WebMCP tools${" "}
          <span
            className="status-badge status-badge--${status === "Ready"
              ? "ready"
              : "warn"}"
          >
            ${status}
          </span>
          ${" "}
          <a
            href="https://github.com/nearform/webmcp-demo"
            target="_blank"
            rel="noopener noreferrer"
            className="intro-github-link"
            aria-label="View on GitHub"
          >
            <i className="ph ph-github-logo"></i>
          </a>
        </p>
      </header>

      <div className="workspace">
        <${ChatPanel}
          messages=${messages}
          onSend=${handleSend}
          onChoice=${handleChoice}
          isProcessing=${isProcessing}
          pendingChoice=${!!pendingQuery}
        />
        <${ActivityLog} activities=${activities} />
        <${NotepadPanel}
          content=${notepadContent}
          onUpdateContent=${handleUpdateNotepad}
        />
      </div>

      <${ToolStatus} tools=${tools} />

      <footer className="footer">
        <a
          href="https://www.nearform.com/contact/?utm_source=open-source&utm_medium=banner&utm_campaign=os-project-pages"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://raw.githubusercontent.com/nearform/.github/refs/heads/master/assets/os-banner-green.svg"
            alt="Nearform Open Source"
            className="nearform-banner"
          />
        </a>
      </footer>
    </div>
  `;
};
