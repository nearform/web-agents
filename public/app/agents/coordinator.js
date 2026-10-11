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
import { formatChatHistory } from "../util/chat-history.js";
import {
  TRIAGE_DECISION_SCHEMA,
  checkDecisionAvailability,
  decide,
  getDecisionSession,
  getTriageDecision,
} from "./decision-api.js";

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    needs_research: { type: "boolean" },
  },
  required: ["needs_research"],
};

const truncateHalf = (text) => {
  if (!text) return text;
  const budget = Math.ceil(text.length * config.context.retryReduction);
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf("\n", budget);
  const end = cut > 0 ? cut : budget;
  return text.slice(0, end) + "\n...[truncated for retry]";
};

// Links are noise for triage: keep a link's text, drop its URL and bare URLs.
const stripLinks = (text) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\(?https?:\/\/[^\s)]+\)?/g, "")
    .replace(/[ \t]{2,}/g, " ");

const stripMarkdown = (text) =>
  stripLinks(text)
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Lines under a "## {name}" heading, up to the next heading.
const getSection = (lines, name) => {
  const start = lines.findIndex((l) => new RegExp(`^## ${name}`).test(l));
  if (start === -1) return [];
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end);
};

/**
 * Plain-text outline of the notepad for triage, most telling parts first:
 * post titles, then section headings, then the summary (cut to fit).
 */
const extractNotepadOutline = (notepad, budget = 1500) => {
  if (!notepad) return "";
  const lines = notepad.split("\n");

  // Post titles: the bold lead of each bullet under "## Posts"
  // (`*   **Title**: ...`), plus researcher-style `**[Title](URL)**` lines.
  const postTitles = [
    ...getSection(lines, "Posts").map(
      (l) => l.match(/^\s*[-*]\s+\*\*(.+?)\*\*/)?.[1],
    ),
    ...lines.map((l) => l.match(/\*\*\[(.+?)\]\(https?:\/\/[^)]+\)\*\*/)?.[1]),
  ]
    .filter(Boolean)
    .map(stripMarkdown);
  const uniqueTitles = [...new Set(postTitles)];

  const headings = lines
    .filter((l) => /^## /.test(l))
    .map((l) => l.replace(/^## /, "").trim());

  const summaryText = stripMarkdown(getSection(lines, "Summary").join(" "));

  const parts = [];
  if (uniqueTitles.length) {
    parts.push(`Posts:\n${uniqueTitles.map((t) => `- ${t}`).join("\n")}`);
  }
  if (headings.length) parts.push(`Sections: ${headings.join(", ")}`);
  const head = parts.join("\n");

  // The summary gets whatever budget is left, cut at a word boundary.
  const room = budget - head.length - "\nSummary: ".length;
  if (!summaryText || room < 80) return head.slice(0, budget);
  const summary =
    summaryText.length <= room
      ? summaryText
      : summaryText.slice(0, summaryText.lastIndexOf(" ", room - 3)) + "...";
  return head ? `${head}\nSummary: ${summary}` : `Summary: ${summary}`;
};

// The text both triage paths judge: notepad outline, recent chat, follow-up.
const buildTriageInput = (userMessage, existingNotepad, chatHistory) => {
  const history = stripLinks(
    formatChatHistory(chatHistory, { maxChars: 1500 }),
  ).trim();
  const outline =
    extractNotepadOutline(existingNotepad) ||
    stripMarkdown(existingNotepad).slice(0, 1500);
  return `Existing notepad outline:\n${outline}${history ? `\n\nRecent conversation:\n${history}` : ""}\n\nUser follow-up: "${userMessage}"`;
};

async function triageWithDecisionApi(
  userMessage,
  existingNotepad,
  chatHistory,
  emit,
  onAgentPrompt,
) {
  const input = buildTriageInput(userMessage, existingNotepad, chatHistory);
  const schemaText = JSON.stringify(TRIAGE_DECISION_SCHEMA, null, 2);
  if (onAgentPrompt) {
    onAgentPrompt(
      "Coordinator",
      "system",
      `DecisionModel schema:\n${schemaText}`,
    );
    onAgentPrompt("Coordinator", "user", input);
  }
  emit("prompt", {
    summary: "Triage: DecisionModel.decide() — deciding if research needed",
    prompt: `Schema:\n${schemaText}\n\nInput:\n${input}`,
    kind: "triage",
  });

  const { result, ms } = await decide(input, emit);
  const { needsResearch, reason, signals } = getTriageDecision(result);
  const probs = Object.entries(signals)
    .map(([id, p]) => `${id} ${p.toFixed(2)}`)
    .join(", ");
  const summary = `Triage (DecisionModel): needs_research = ${needsResearch} (${reason}) — p(true): ${probs} (${ms}ms)`;
  if (onAgentPrompt) onAgentPrompt("Coordinator", "answer", summary);
  emit("received", { summary, result: JSON.stringify(result, null, 2) });
  return { needsResearch, contextInfo: null };
}

async function triageFollowUp(
  userMessage,
  existingNotepad,
  chatHistory,
  emit,
  onAgentPrompt,
  useDecisionApi,
) {
  if (useDecisionApi) {
    try {
      return await triageWithDecisionApi(
        userMessage,
        existingNotepad,
        chatHistory,
        emit,
        onAgentPrompt,
      );
    } catch (err) {
      emit(
        "error",
        `DecisionModel triage failed, using Prompt API triage: ${err.message}`,
      );
    }
  }
  return triageWithPromptApi(
    userMessage,
    existingNotepad,
    chatHistory,
    emit,
    onAgentPrompt,
  );
}

async function triageWithPromptApi(
  userMessage,
  existingNotepad,
  chatHistory,
  emit,
  onAgentPrompt,
) {
  const triageSystemPrompt = getTriageSystemPrompt(userMessage);
  if (onAgentPrompt) onAgentPrompt("Coordinator", "system", triageSystemPrompt);
  const session = await createSession(triageSystemPrompt);
  try {
    const prompt = buildTriageInput(userMessage, existingNotepad, chatHistory);
    if (onAgentPrompt) onAgentPrompt("Coordinator", "user", prompt);
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
    if (onAgentPrompt)
      onAgentPrompt(
        "Coordinator",
        "answer",
        `Triage: needs_research = ${parsed.needs_research}`,
      );
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
  onAgentPrompt,
  signal,
  useDecisionApi,
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
        onAgentPrompt,
        useDecisionApi,
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
        onAgentPrompt,
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
            onAgentPrompt,
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
          onAgentPrompt,
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
      onAgentPrompt,
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
          chatHistory: chatHistory ? chatHistory.slice(-4) : chatHistory,
          skipNotepadWrite,
          onStreamChunk,
          onNotepadStreamChunk,
          onAgentStatus: reportStatus,
          onAgentPrompt,
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
 * Triage uses the Chrome Decisions API (DecisionModel) when available, and
 * the Prompt API otherwise or if the DecisionModel call fails.
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
  onAgentPrompt,
  signal,
}) => {
  const emit = createEmitter("Coordinator", onActivity);
  const reportStatus = (agentName, status, contextInfo) => {
    if (onAgentStatus) onAgentStatus(agentName, status, contextInfo);
  };
  const maxRetries = config.agents.maxCoordinatorRetries ?? 1;

  emit("start", "Analyzing your request...");
  const startTime = Date.now();

  // Use the Chrome Decisions API for triage when present. Create the session
  // now, while the send click still counts as user activation (needed if the
  // model must download), so it is ready by the time a follow-up is triaged.
  const decisionCheck = await checkDecisionAvailability();
  const useDecisionApi = decisionCheck.available;
  if (useDecisionApi) {
    emit(
      "system",
      `DecisionModel available (${decisionCheck.status}) — using it for triage`,
    );
    getDecisionSession(emit).catch((err) =>
      debug.warn("Coordinator", `DecisionModel create failed: ${err.message}`),
    );
  }

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
        onAgentPrompt,
        signal,
        useDecisionApi,
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
