import { createSession, promptSessionConstrained } from "./prompt-api.js";
import { runResearcher } from "./researcher.js";
import { runWriter } from "./writer.js";
import { debug } from "../util/debug.js";

const NEEDS_RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    needs_research: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["needs_research"],
};

const TRIAGE_SYSTEM = `You are a coordinator that decides whether a follow-up question needs new research or can be answered from existing notepad content.
Respond with JSON: {"needs_research": true/false, "reason": "brief explanation"}
- needs_research: true if the question asks about a NEW topic not covered in the notepad, or requests significantly different information.
- needs_research: false if the question is a refinement, rewrite, reformatting, or elaboration of what's already in the notepad.`;

/**
 * Coordinator agent: decides whether to research or reuse notepad,
 * delegates to Researcher and Writer agents, returns a chat answer.
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
  let needsResearch = true;

  // If we have existing notepad content, ask the model whether new research is needed
  if (existingNotepad) {
    emit("thinking", "Deciding if new research is needed...");
    try {
      const triageSession = await createSession(TRIAGE_SYSTEM);
      const raw = await promptSessionConstrained(
        triageSession,
        `Existing notepad content:\n${existingNotepad.slice(0, 800)}\n\nNew user question: ${userMessage}`,
        NEEDS_RESEARCH_SCHEMA,
      );
      triageSession.destroy();

      const decision = JSON.parse(raw);
      needsResearch = decision.needs_research;
      debug("Coordinator", "Triage decision:", JSON.stringify(decision));
      emit(
        "thinking",
        needsResearch
          ? `New research needed: ${decision.reason || ""}`
          : `Using existing notepad: ${decision.reason || ""}`,
      );
    } catch (err) {
      debug(
        "Coordinator",
        "Triage failed, defaulting to research:",
        err.message,
      );
      needsResearch = true;
    }
  }

  if (needsResearch) {
    // Run researcher
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
    emit("received", "Skipping research — using existing notepad content");
  }

  // Run writer (with research brief if we have new research, otherwise just notepad + query)
  emit("delegate", "Handing off to Writer agent");
  let writerAnswer;
  try {
    writerAnswer = await runWriter({
      researchBrief: researchBrief || "",
      originalQuery: userMessage,
      tools,
      onActivity,
      existingNotepad,
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
    `I've ${existingNotepad ? "updated" : "written"} the notepad with my findings. Check the notepad panel for the full result.`
  );
};
