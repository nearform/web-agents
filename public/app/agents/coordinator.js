/* global DOMException:false */
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
import { getTriageSystemPrompt } from "./prompts.js";

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
  const budget = Math.ceil(text.length * config.context.retryReduction);
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf("\n", budget);
  const end = cut > 0 ? cut : budget;
  return text.slice(0, end) + "\n...[truncated for retry]";
};

const extractNotepadOutline = (notepad, budget = 1500) => {
  if (!notepad) return "";
  const lines = notepad.split("\n");

  // Extract Summary section content
  const summaryStart = lines.findIndex((l) => /^## Summary/.test(l));
  let summaryText = "";
  if (summaryStart !== -1) {
    const summaryLines = [];
    for (let i = summaryStart + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) break;
      const trimmed = lines[i].trim();
      if (trimmed) summaryLines.push(trimmed);
    }
    summaryText = summaryLines.join(" ");
  }

  // Collect all ## headings
  const headings = lines
    .filter((l) => /^## /.test(l))
    .map((l) => l.replace(/^## /, "").trim());

  // Collect post titles: lines like **[Title](URL)**
  const postTitles = lines
    .filter((l) => /\*\*\[.+?\]\(https?:\/\/.+?\)\*\*/.test(l))
    .map((l) => {
      const m = l.match(/\*\*\[(.+?)\]\((https?:\/\/[^)]+)\)\*\*/);
      return m ? `- ${m[1]}` : null;
    })
    .filter(Boolean);

  // Build outline
  const parts = [];
  if (summaryText) parts.push(`Summary: ${summaryText}`);
  if (headings.length) parts.push(`Sections: ${headings.join(", ")}`);
  if (postTitles.length) parts.push(`Posts:\n${postTitles.join("\n")}`);

  const outline = parts.join("\n");
  if (outline.length <= budget) return outline;

  // Line-safe truncation
  const cut = outline.lastIndexOf("\n", budget);
  const end = cut > 0 ? cut : budget;
  return outline.slice(0, end) + "\n...";
};

async function triageFollowUp(userMessage, existingNotepad, chatHistory, emit) {
  const session = await createSession(getTriageSystemPrompt(userMessage));
  try {
    const history = formatChatHistory(chatHistory);
    const outline =
      extractNotepadOutline(existingNotepad) || existingNotepad.slice(0, 1500);
    const prompt = `Existing notepad outline:\n${outline}${history ? `\n\nRecent conversation:\n${history}` : ""}\n\nUser follow-up: "${userMessage}"`;
    if (emit) {
      emit("prompt", {
        summary: "Triage: deciding if research needed",
        prompt,
        kind: "triage",
      });
    }
    const raw = await promptSessionConstrained(session, prompt, TRIAGE_SCHEMA);
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
  signal,
}) {
  // Coordinator's own context info (only from triage session)
  let coordinatorContextInfo = null;
  reportStatus("Coordinator", "active");

  let researchBrief = null;
  let needsResearch = !existingNotepad;
  if (!needsResearch) {
    try {
      const t0 = Date.now();
      const triage = await triageFollowUp(
        userMessage,
        existingNotepad,
        chatHistory,
        emit,
      );
      debug.timing("triage", Date.now() - t0);
      needsResearch = triage.needsResearch;
      coordinatorContextInfo = triage.contextInfo || null;
      reportStatus("Coordinator", "active", coordinatorContextInfo);
      debug("Coordinator", `Triage result: needsResearch=${needsResearch}`);
    } catch (err) {
      debug("Coordinator", `Triage failed, skipping research: ${err.message}`);
    }
  }

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  if (needsResearch) {
    // No existing notepad — run the full research pipeline
    emit("delegate", "Handing off to Researcher agent");
    reportStatus("Researcher", "active");
    try {
      const t0 = Date.now();
      researchBrief = await runResearcher({
        query: userMessage,
        tools,
        onActivity,
        existingContext: existingNotepad,
        onContextUpdate: (info) => reportStatus("Researcher", "active", info),
        signal,
      });
      debug.timing("researcher", Date.now() - t0);
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
            signal,
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
          signal,
        });
      } catch (err) {
        emit("error", `Retry research failed: ${err.message}`);
      }
    }
    reportStatus("Researcher", "done");
    const urlMatches = researchBrief.match(/https?:\/\/\S+/g) || [];
    const postMatches = researchBrief.match(/\*\*\[/g) || [];
    emit("received", {
      summary: `Research complete: ${postMatches.length} posts, ${urlMatches.length} URLs (${researchBrief.length} chars)`,
      result: researchBrief,
    });
    emit("prompt", {
      summary: "Research brief passed to Writer",
      prompt: researchBrief,
      kind: "research-brief",
    });

    // Diagnostic: warn if prose URLs don't match the verified set
    const verifiedMatch = researchBrief.match(/## Verified URLs\n[\s\S]*$/);
    if (verifiedMatch) {
      const verified = [
        ...verifiedMatch[0].matchAll(/- (https?:\/\/\S+)/g),
      ].map((m) => m[1]);
      const proseUrls = [
        ...researchBrief.matchAll(/\]\((https?:\/\/[^)]+)\)/g),
      ].map((m) => m[1]);
      const suspect = proseUrls.filter((u) => !verified.includes(u));
      if (suspect.length > 0) {
        debug.warn(
          "Coordinator",
          `${suspect.length} URL(s) not in verified set:`,
          suspect,
        );
      }
    }
  } else {
    debug("Coordinator", "Existing notepad present — skipping research");
    emit("received", "Skipping research — using existing notepad content");
  }

  // Run writer
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const skipNotepadWrite = !needsResearch;
  emit("delegate", "Handing off to Writer agent");
  let writerAnswer;
  try {
    const t0 = Date.now();
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
      signal,
    });
    debug.timing("writer", Date.now() - t0);
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
          signal,
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
  signal,
}) => {
  const emit = createEmitter("Coordinator", onActivity);
  const reportStatus = (agentName, status, contextInfo) => {
    if (onAgentStatus) onAgentStatus(agentName, status, contextInfo);
  };
  const maxRetries = config.agents.maxCoordinatorRetries ?? 1;

  emit("start", "Analyzing your request...");
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await runCoordinatorPipeline({
        userMessage,
        tools,
        onActivity,
        existingNotepad,
        chatHistory,
        onStreamChunk,
        onNotepadStreamChunk,
        emit,
        reportStatus,
        signal,
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      emit("system", `Total elapsed time: ${elapsed}s`);
      return result;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (attempt < maxRetries && err.message.includes("timed out")) {
        emit(
          "retry",
          `Pipeline timed out — restarting with new sessions (attempt ${attempt + 2})`,
        );
        continue;
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      emit("system", `Total elapsed time: ${elapsed}s`);
      emit("error", `Pipeline failed: ${err.message}`);
      return `I wasn't able to complete the request. Error: ${err.message}`;
    }
  }
};
