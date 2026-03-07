import { runResearcher } from "./researcher.js";
import { runWriter } from "./writer.js";
import { debug } from "../util/debug.js";
import { createSession, promptSessionConstrained } from "./prompt-api.js";

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    needs_research: { type: "boolean" },
  },
  required: ["needs_research"],
};

async function triageFollowUp(userMessage, existingNotepad) {
  const session = await createSession(
    `You decide whether a follow-up message requires NEW web research or can be answered by reworking existing content.

Reply with JSON: {"needs_research": true} or {"needs_research": false}.

needs_research = true when:
- The user asks a factual question about a new topic not covered in the notepad
- The user asks about a specific company, person, project, or technology not in the notepad
- The user explicitly asks to search, find, or look up something

needs_research = false when:
- The user asks to rewrite, reformat, shorten, expand, or change tone of existing content
- The user asks for a different output format (email, slides, bullets)
- The question can be fully answered from the existing notepad content`,
  );
  try {
    const raw = await promptSessionConstrained(
      session,
      `Existing notepad summary (first 200 chars): "${existingNotepad.slice(0, 200)}"\n\nUser follow-up: "${userMessage}"`,
      TRIAGE_SCHEMA,
    );
    const parsed = JSON.parse(raw);
    return parsed.needs_research === true;
  } finally {
    session.destroy();
  }
}

/**
 * Coordinator agent: decides whether to research or reuse notepad,
 * delegates to Researcher and Writer agents, returns a chat answer.
 *
 * Decision logic:
 * - existingNotepad absent              → full pipeline (research → notepad → chat)
 * - existingNotepad + LLM triage=true   → research runs, notepad merged
 * - existingNotepad + LLM triage=false  → skip research, chat-only answer
 */
export const runCoordinator = async ({
  userMessage,
  tools,
  onActivity,
  existingNotepad,
}) => {
  const emit = (type, detail) => {
    if (onActivity) {
      onActivity({
        agent: "Coordinator",
        type,
        detail,
        timestamp: Date.now(),
      });
    }
  };

  emit("start", "Analyzing your request...");

  let researchBrief = null;
  let needsResearch = !existingNotepad;
  if (!needsResearch) {
    try {
      needsResearch = await triageFollowUp(userMessage, existingNotepad);
      debug("Coordinator", `Triage result: needsResearch=${needsResearch}`);
    } catch (err) {
      debug("Coordinator", `Triage failed, skipping research: ${err.message}`);
    }
  }

  if (needsResearch) {
    // No existing notepad — run the full research pipeline
    emit("delegate", "Handing off to Researcher agent");
    try {
      researchBrief = await runResearcher({
        query: userMessage,
        tools,
        onActivity,
        existingContext: existingNotepad,
      });
    } catch (err) {
      emit("error", `Research failed: ${err.message}`);
      return `I wasn't able to complete the research. Error: ${err.message}`;
    }
    emit("received", `Research complete (${researchBrief.length} chars)`);
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
      skipNotepadWrite,
    });
  } catch (err) {
    emit("error", `Writing failed: ${err.message}`);
    if (researchBrief) {
      return `Research was completed but writing failed. Here's what was found:\n\n${researchBrief}`;
    }
    return `Writing failed: ${err.message}`;
  }

  emit("received", "Writing complete");
  emit("done", "All agents finished");

  return (
    writerAnswer ||
    `I've ${existingNotepad ? "updated" : "written"} the research notepad with my findings. Check the notepad panel for the full result.`
  );
};
