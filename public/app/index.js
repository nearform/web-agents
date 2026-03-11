/* global AbortController:false */
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

const ExtLink = ({ href, children }) =>
  html`<a href=${href} target="_blank" rel="noopener noreferrer"
    >${children}</a
  >`;

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
  const [prevAgentStatuses, setPrevAgentStatuses] = React.useState(null);
  const [platformStatus, setPlatformStatus] = React.useState(null);
  const [showPlatformModal, setShowPlatformModal] = React.useState(false);
  const [collapsedPanels, setCollapsedPanels] = React.useState({
    chat: false,
    activity: false,
    notepad: false,
  });
  const [bannerMinimized, setBannerMinimized] = React.useState(false);
  const abortControllerRef = React.useRef(null);
  const [stoppedState, setStoppedState] = React.useState(null);

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
      if (contextInfo?.pct != null) {
        setPrevAgentStatuses((prev) => {
          if (!prev) return null;
          const next = { ...prev };
          delete next[agentName];
          return Object.keys(next).length > 0 ? next : null;
        });
      }
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
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsProcessing(true);
      setStreamingText(null);
      setStoppedState(null);
      setAgentStatuses((current) => {
        const hasActivity = Object.values(current).some(
          (s) => s.status !== "idle",
        );
        if (hasActivity) setPrevAgentStatuses(current);
        return INITIAL_AGENT_STATUSES;
      });
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
          signal: controller.signal,
        });

        setStreamingText(null);
        setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      } catch (err) {
        if (err.name === "AbortError") {
          // Handled by handleStop — don't append error message
          return;
        }
        setStreamingText(null);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Error: ${err.message}`,
          },
        ]);
      } finally {
        abortControllerRef.current = null;
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

  const streamingTextRef = React.useRef(null);
  React.useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  const handleStop = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStoppedState({ partialText: streamingTextRef.current });
    setStreamingText(null);
    setIsProcessing(false);
  }, []);

  const handleStopContinue = React.useCallback(() => {
    const partial = stoppedState?.partialText;
    if (partial) {
      setMessages((prev) => [...prev, { role: "assistant", text: partial }]);
    }
    setStoppedState(null);
  }, [stoppedState]);

  const handleStopNewQuery = React.useCallback(() => {
    setStoppedState(null);
    setStreamingText(null);
  }, []);

  const handleStartFresh = React.useCallback(() => {
    setMessages([]);
    setActivities([]);
    setNotepadContent("");
    setAgentStatuses(INITIAL_AGENT_STATUSES);
    setPrevAgentStatuses(null);
    setStoppedState(null);
    setStreamingText(null);
    updateNotepad("");
  }, []);

  const handleUpdateNotepad = React.useCallback((content) => {
    setNotepadContent(content);
    updateNotepad(content);
  }, []);

  const togglePanel = React.useCallback((panel) => {
    setCollapsedPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  const workspaceCols = ["chat", "activity", "notepad"]
    .map((p) => (collapsedPanels[p] ? "auto" : "1fr"))
    .join(" ");

  return html`
    <div className="app-container">
      <header className="app-header">
        <h1>Research Agents in the Web</h1>
        <p className="intro">
          Three AI agents research${" "}
          <${ExtLink} href="https://nearform.com">Nearform<//>
          ${" "}knowledge using${" "}
          <${ExtLink} href="https://github.com/webmachinelearning/webmcp"
            >WebMCP<//
          >
          ${" "}and in-browser${" "}
          <${ExtLink}
            href="https://developer.chrome.com/docs/extensions/ai/prompt-api"
            >AI models<//
          >. ${" "}
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

      <div
        className="workspace"
        style=${{ gridTemplateColumns: workspaceCols }}
      >
        <${ChatPanel}
          messages=${messages}
          onSend=${handleSend}
          onStartFresh=${handleStartFresh}
          isProcessing=${isProcessing}
          streamingText=${streamingText}
          hasNotepad=${!!notepadContent}
          ready=${status === "Ready"}
          collapsed=${collapsedPanels.chat}
          onToggle=${() => togglePanel("chat")}
          onStop=${handleStop}
          stoppedState=${stoppedState}
          onStopContinue=${handleStopContinue}
          onStopNewQuery=${handleStopNewQuery}
        />
        <${ActivityLog}
          activities=${activities}
          collapsed=${collapsedPanels.activity}
          onToggle=${() => togglePanel("activity")}
        />
        <${NotepadPanel}
          content=${notepadContent}
          onUpdateContent=${handleUpdateNotepad}
          collapsed=${collapsedPanels.notepad}
          onToggle=${() => togglePanel("notepad")}
        />
      </div>

      <div className="status-bars">
        <${AgentStatus}
          statuses=${agentStatuses}
          prevStatuses=${prevAgentStatuses}
        />
        <${ToolStatus} tools=${tools} />
      </div>

      ${showPlatformModal &&
      html`
        <${PlatformStatusModal}
          platformStatus=${platformStatus}
          onClose=${() => setShowPlatformModal(false)}
        />
      `}

      <footer className="footer ${bannerMinimized ? "footer--minimized" : ""}">
        ${bannerMinimized
          ? html`
              <div className="banner-mini">
                <a
                  href="https://www.nearform.com/contact/?utm_source=open-source&utm_medium=banner&utm_campaign=os-project-pages"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="banner-mini-pill"
                  aria-label="Nearform Open Source"
                >
                  NF
                </a>
                <button
                  type="button"
                  className="banner-restore-btn"
                  onClick=${() => setBannerMinimized(false)}
                  aria-label="Restore banner"
                  title="Restore banner"
                >
                  <i className="ph ph-arrow-square-out"></i>
                </button>
              </div>
            `
          : html`
              <div className="banner-wrapper">
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
                <button
                  type="button"
                  className="banner-minimize-btn"
                  onClick=${() => setBannerMinimized(true)}
                  title="Minimize banner"
                  aria-label="Minimize banner"
                >
                  <i className="ph ph-minus"></i>
                </button>
              </div>
            `}
      </footer>
    </div>
  `;
};
