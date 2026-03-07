import { runResearcher } from "./researcher.js";
import { runWriter } from "./writer.js";
import { debug } from "../util/debug.js";
import { createSession, promptSessionConstrained } from "./prompt-api.js";
import { createEmitter } from "../util/activity.js";
import { TRIAGE_SYSTEM_PROMPT } from "./prompts.js";

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    needs_research: { type: "boolean" },
  },
  required: ["needs_research"],
};

async function triageFollowUp(userMessage, existingNotepad) {
  const session = await createSession(TRIAGE_SYSTEM_PROMPT);
  try {
    const raw = await promptSessionConstrained(
      session,
      `Existing notepad summary (first 500 chars): "${existingNotepad.slice(0, 500)}"\n\nUser follow-up: "${userMessage}"`,
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
  onStreamChunk,
  onNotepadStreamChunk,
}) => {
  const emit = createEmitter("Coordinator", onActivity);

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
      onStreamChunk,
      onNotepadStreamChunk,
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
