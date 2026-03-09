import React from "react";
import { html } from "./util/html.js";
import { ChatPanel } from "./components/chat-panel.js";
import { ActivityLog } from "./components/activity-log.js";
import { NotepadPanel } from "./components/notepad-panel.js";
import { ToolStatus } from "./components/tool-status.js";
import { AgentStatus } from "./components/agent-status.js";
import { initRegistry, listTools } from "./bridge/tool-registry.js";
import { setNotepadCallback, updateNotepad } from "./tools/notepad-tools.js";
import { setDebugActivityCallback } from "./util/debug.js";
import { checkAvailability } from "./agents/prompt-api.js";
import { runCoordinator } from "./agents/coordinator.js";
import { detectPlatformStatus } from "./util/platform-status.js";
import { PlatformStatusModal } from "./components/platform-status-modal.js";

const INITIAL_AGENT_STATUSES = {
  Coordinator: {
    status: "idle",
    contextPct: null,
    contextUsed: null,
    contextTotal: null,
  },
  Researcher: {
    status: "idle",
    contextPct: null,
    contextUsed: null,
    contextTotal: null,
  },
  Writer: {
    status: "idle",
    contextPct: null,
    contextUsed: null,
    contextTotal: null,
  },
};

export const App = () => {
  const [messages, setMessages] = React.useState([]);
  const [activities, setActivities] = React.useState([]);
  const [notepadContent, setNotepadContent] = React.useState("");
  const [tools, setTools] = React.useState([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState(null);
  const [status, setStatus] = React.useState("Initializing...");
  const [agentStatuses, setAgentStatuses] = React.useState(
    INITIAL_AGENT_STATUSES,
  );
  const [platformStatus, setPlatformStatus] = React.useState(null);
  const [showPlatformModal, setShowPlatformModal] = React.useState(false);

  React.useEffect(() => {
    setNotepadCallback(setNotepadContent);
    setDebugActivityCallback((event) => {
      setActivities((prev) => [...prev, event]);
    });

    const init = async () => {
      // Check Prompt API
      const apiCheck = await checkAvailability();
      if (!apiCheck.available) {
        setStatus(`Prompt API: ${apiCheck.reason}`);
      }

      // Init tool registry (discovers remote + local tools)
      const discovered = await initRegistry();
      setTools(discovered);

      // Detect platform status
      const ps = detectPlatformStatus(apiCheck);
      setPlatformStatus(ps);

      // Auto-open modal if LanguageModel is unavailable
      if (!ps.languageModel.available) {
        setShowPlatformModal(true);
      }

      if (apiCheck.available) {
        setStatus("Ready");
      }
    };

    init();
  }, []);

  const onActivity = React.useCallback((event) => {
    setActivities((prev) => [...prev, event]);
  }, []);

  const onAgentStatus = React.useCallback(
    (agentName, statusValue, contextInfo) => {
      setAgentStatuses((prev) => ({
        ...prev,
        [agentName]: {
          status: statusValue,
          contextPct: contextInfo?.pct ?? prev[agentName]?.contextPct ?? null,
          contextUsed:
            contextInfo?.used ?? prev[agentName]?.contextUsed ?? null,
          contextTotal:
            contextInfo?.total ?? prev[agentName]?.contextTotal ?? null,
        },
      }));
    },
    [],
  );

  const executeCoordinator = React.useCallback(
    async (text, existingNotepad, chatHistory) => {
      setIsProcessing(true);
      setStreamingText(null);
      setAgentStatuses(INITIAL_AGENT_STATUSES);
      try {
        const currentTools = listTools();
        const answer = await runCoordinator({
          userMessage: text,
          tools: currentTools,
          onActivity,
          existingNotepad,
          chatHistory,
          onStreamChunk: (chunk) => setStreamingText(chunk),
          onNotepadStreamChunk: (chunk) => setNotepadContent(chunk),
          onAgentStatus,
        });

        setStreamingText(null);
        setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      } catch (err) {
        setStreamingText(null);
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
    [onActivity, onAgentStatus],
  );

  const handleSend = React.useCallback(
    (text) => {
      setMessages((prev) => [...prev, { role: "user", text }]);
      executeCoordinator(text, notepadContent || undefined, messages);
    },
    [notepadContent, executeCoordinator],
  );

  const handleStartFresh = React.useCallback(() => {
    setMessages([]);
    setActivities([]);
    setNotepadContent("");
    setAgentStatuses(INITIAL_AGENT_STATUSES);
    updateNotepad("");
  }, []);

  const handleUpdateNotepad = React.useCallback((content) => {
    setNotepadContent(content);
    updateNotepad(content);
  }, []);

  return html`
    <div className="app-container">
      <header className="app-header">
        <h1>Research Agents in the Web</h1>
        <p className="intro">
          Three AI agents research Nearform knowledge using WebMCP and
          in-browser AI models${" "}
          <span
            className="status-badge status-badge--${status === "Ready"
              ? "ready"
              : "warn"}"
          >
            ${status}
          </span>
          ${" "}
          <a
            href="https://github.com/nearform/web-agents"
            target="_blank"
            rel="noopener noreferrer"
            className="intro-github-link"
            aria-label="View on GitHub"
          >
            <i className="ph ph-github-logo"></i>
          </a>
          ${" "}
          <button
            className="platform-status-btn ${platformStatus &&
            (!platformStatus.languageModel.available ||
              !platformStatus.webMcp.native)
              ? "has-issues"
              : ""}"
            onClick=${() => setShowPlatformModal(true)}
            aria-label="Platform status"
          >
            <i className="ph ph-info"></i>
          </button>
        </p>
      </header>

      <div className="workspace">
        <${ChatPanel}
          messages=${messages}
          onSend=${handleSend}
          onStartFresh=${handleStartFresh}
          isProcessing=${isProcessing}
          streamingText=${streamingText}
          hasNotepad=${!!notepadContent}
        />
        <${ActivityLog} activities=${activities} />
        <${NotepadPanel}
          content=${notepadContent}
          onUpdateContent=${handleUpdateNotepad}
        />
      </div>

      <div className="status-bars">
        <${AgentStatus} statuses=${agentStatuses} />
        <${ToolStatus} tools=${tools} />
      </div>

      ${showPlatformModal &&
      html`
        <${PlatformStatusModal}
          platformStatus=${platformStatus}
          onClose=${() => setShowPlatformModal(false)}
        />
      `}

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
