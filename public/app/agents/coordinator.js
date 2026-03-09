import { runResearcher } from "./researcher.js";
import { runWriter } from "./writer.js";
import { debug } from "../util/debug.js";
import {
  createSession,
  promptSessionConstrained,
  getContextInfo,
} from "./prompt-api.js";
import { createEmitter } from "../util/activity.js";
import { config } from "../config.js";
import { TRIAGE_SYSTEM_PROMPT } from "./prompts.js";

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    needs_research: { type: "boolean" },
  },
  required: ["needs_research"],
};

const formatChatHistory = (chatHistory, maxPairs = 3) => {
  if (!chatHistory || chatHistory.length === 0) return "";
  const recent = chatHistory.slice(-maxPairs * 2);
  return recent
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 200)}`,
    )
    .join("\n");
};

const truncateHalf = (text) => {
  if (!text) return text;
  return (
    text.slice(0, Math.ceil(text.length * config.context.retryReduction)) +
    "\n...[truncated for retry]"
  );
};

async function triageFollowUp(userMessage, existingNotepad, chatHistory) {
  const session = await createSession(TRIAGE_SYSTEM_PROMPT);
  try {
    const history = formatChatHistory(chatHistory);
    const raw = await promptSessionConstrained(
      session,
      `Existing notepad summary (first 500 chars): "${existingNotepad.slice(0, 500)}"${history ? `\n\nRecent conversation:\n${history}` : ""}\n\nUser follow-up: "${userMessage}"`,
      TRIAGE_SCHEMA,
    );
    const contextInfo = getContextInfo(session);
    const parsed = JSON.parse(raw);
    return { needsResearch: parsed.needs_research === true, contextInfo };
  } finally {
    session.destroy();
  }
}

/**
 * Run the full coordinator pipeline: triage → research → write → chat answer.
 * Throws on errors so the outer retry loop can catch timeouts and restart.
 */
async function runCoordinatorPipeline({
  userMessage,
  tools,
  onActivity,
  existingNotepad,
  chatHistory,
  onStreamChunk,
  onNotepadStreamChunk,
  emit,
  reportStatus,
}) {
  // Coordinator's own context info (only from triage session)
  let coordinatorContextInfo = null;
  reportStatus("Coordinator", "active");

  let researchBrief = null;
  let needsResearch = !existingNotepad;
  if (!needsResearch) {
    try {
      const triage = await triageFollowUp(
        userMessage,
        existingNotepad,
        chatHistory,
      );
      needsResearch = triage.needsResearch;
      coordinatorContextInfo = triage.contextInfo || null;
      reportStatus("Coordinator", "active", coordinatorContextInfo);
      debug("Coordinator", `Triage result: needsResearch=${needsResearch}`);
    } catch (err) {
      debug("Coordinator", `Triage failed, skipping research: ${err.message}`);
    }
  }

  if (needsResearch) {
    // No existing notepad — run the full research pipeline
    emit("delegate", "Handing off to Researcher agent");
    reportStatus("Researcher", "active");
    try {
      researchBrief = await runResearcher({
        query: userMessage,
        tools,
        onActivity,
        existingContext: existingNotepad,
        onContextUpdate: (info) => reportStatus("Researcher", "active", info),
      });
    } catch (err) {
      if (err.message.includes("timed out") && existingNotepad) {
        debug.warn(
          "Coordinator",
          "Researcher timed out, retrying with truncated context",
        );
        emit("retry", "Researcher timed out — retrying with shorter context");
        try {
          researchBrief = await runResearcher({
            query: userMessage,
            tools,
            onActivity,
            existingContext: truncateHalf(existingNotepad),
            onContextUpdate: (info) =>
              reportStatus("Researcher", "active", info),
          });
        } catch (retryErr) {
          reportStatus("Researcher", "error");
          emit("error", `Research retry failed: ${retryErr.message}`);
          throw retryErr;
        }
      } else {
        reportStatus("Researcher", "error");
        emit("error", `Research failed: ${err.message}`);
        throw err;
      }
    }
    // Retry without filters if research came back empty
    if (
      researchBrief &&
      !researchBrief.includes("http") &&
      researchBrief.length < 150
    ) {
      emit("retry", "Research returned no results — retrying without filters");
      try {
        researchBrief = await runResearcher({
          query: `IMPORTANT: Your previous search returned no results. This time, do NOT use any categoryPrimary or postType filters. Search with a broad query only.\n\nUser question: ${userMessage}`,
          tools,
          onActivity,
          existingContext: existingNotepad,
          onContextUpdate: (info) => reportStatus("Researcher", "active", info),
        });
      } catch (err) {
        emit("error", `Retry research failed: ${err.message}`);
      }
    }
    reportStatus("Researcher", "done");
    emit("received", {
      summary: `Research complete (${researchBrief.length} chars)`,
      result: researchBrief,
    });
  } else {
    debug("Coordinator", "Existing notepad present — skipping research");
    emit("received", "Skipping research — using existing notepad content");
  }

  // Run writer
  const skipNotepadWrite = !needsResearch;
  emit("delegate", "Handing off to Writer agent");
  let writerAnswer;
  try {
    writerAnswer = await runWriter({
      researchBrief: researchBrief || "",
      originalQuery: userMessage,
      tools,
      onActivity,
      existingNotepad,
      chatHistory,
      skipNotepadWrite,
      onStreamChunk,
      onNotepadStreamChunk,
      onAgentStatus: reportStatus,
    });
  } catch (err) {
    if (err.message.includes("timed out")) {
      debug.warn(
        "Coordinator",
        "Writer timed out, retrying with truncated inputs",
      );
      emit("retry", "Writer timed out — retrying with shorter context");
      try {
        writerAnswer = await runWriter({
          researchBrief: truncateHalf(researchBrief || ""),
          originalQuery: userMessage,
          tools,
          onActivity,
          existingNotepad: existingNotepad
            ? truncateHalf(existingNotepad)
            : undefined,
          chatHistory: chatHistory ? chatHistory.slice(-2) : chatHistory,
          skipNotepadWrite,
          onStreamChunk,
          onNotepadStreamChunk,
          onAgentStatus: reportStatus,
        });
      } catch (retryErr) {
        reportStatus("Writer", "error");
        emit("error", `Writer retry failed: ${retryErr.message}`);
        throw retryErr;
      }
    } else {
      reportStatus("Writer", "error");
      emit("error", `Writing failed: ${err.message}`);
      throw err;
    }
  }

  emit("received", "Writing complete");
  reportStatus("Coordinator", "done", coordinatorContextInfo);
  emit("done", "All agents finished");

  return (
    writerAnswer ||
    `I've ${existingNotepad ? "updated" : "written"} the research notepad with my findings. Check the notepad panel for the full result.`
  );
}

/**
 * Coordinator agent: decides whether to research or reuse notepad,
 * delegates to Researcher and Writer agents, returns a chat answer.
 *
 * Decision logic:
 * - existingNotepad absent              → full pipeline (research → notepad → chat)
 * - existingNotepad + LLM triage=true   → research runs, notepad merged
 * - existingNotepad + LLM triage=false  → skip research, chat-only answer
 *
 * On timeout failures, retries the full pipeline with fresh sessions.
 */
export const runCoordinator = async ({
  userMessage,
  tools,
  onActivity,
  existingNotepad,
  chatHistory,
  onStreamChunk,
  onNotepadStreamChunk,
  onAgentStatus,
}) => {
  const emit = createEmitter("Coordinator", onActivity);
  const reportStatus = (agentName, status, contextInfo) => {
    if (onAgentStatus) onAgentStatus(agentName, status, contextInfo);
  };
  const maxRetries = config.agents.maxCoordinatorRetries ?? 1;

  emit("start", "Analyzing your request...");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runCoordinatorPipeline({
        userMessage,
        tools,
        onActivity,
        existingNotepad,
        chatHistory,
        onStreamChunk,
        onNotepadStreamChunk,
        emit,
        reportStatus,
      });
    } catch (err) {
      if (attempt < maxRetries && err.message.includes("timed out")) {
        emit(
          "retry",
          `Pipeline timed out — restarting with new sessions (attempt ${attempt + 2})`,
        );
        continue;
      }
      emit("error", `Pipeline failed: ${err.message}`);
      return `I wasn't able to complete the request. Error: ${err.message}`;
    }
  }
};
