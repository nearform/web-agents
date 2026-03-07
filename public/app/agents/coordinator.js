import { runResearcher } from "./researcher.js";
import { runWriter } from "./writer.js";
import { debug } from "../util/debug.js";

/**
 * Coordinator agent: decides whether to research or reuse notepad,
 * delegates to Researcher and Writer agents, returns a chat answer.
 *
 * Decision logic is deterministic based on existingNotepad:
 * - existingNotepad provided → skip research, skip notepad write (chat-only answer)
 * - existingNotepad absent   → full pipeline (research → notepad → chat)
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
  const needsResearch = !existingNotepad;

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
