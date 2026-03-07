import { runResearcher } from "./researcher.js";
import { runWriter } from "./writer.js";

/**
 * Coordinator agent: decomposes user request, delegates to
 * Researcher and Writer agents, and synthesizes a final answer.
 */
export const runCoordinator = async ({ userMessage, tools, onActivity, existingNotepad }) => {
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

  // Step 1: Determine search queries from user message
  emit("thinking", `Delegating research for: "${userMessage.slice(0, 100)}"`);

  // Step 2: Run researcher
  emit("delegate", "Handing off to Researcher agent");
  let researchBrief;
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

  // Step 3: Run writer
  emit("delegate", "Handing off to Writer agent");
  try {
    await runWriter({
      researchBrief,
      originalQuery: userMessage,
      tools,
      onActivity,
      existingNotepad,
    });
  } catch (err) {
    emit("error", `Writing failed: ${err.message}`);
    return `Research was completed but writing failed. Here's what was found:\n\n${researchBrief}`;
  }

  emit("received", "Writing complete");

  // Step 4: Synthesize final answer
  emit("done", "All agents finished");

  return `I've researched your question and ${existingNotepad ? "updated" : "compiled"} the notepad. Here's a quick overview:\n\n${researchBrief.slice(0, 500)}${researchBrief.length > 500 ? "..." : ""}\n\nCheck the notepad panel for the full formatted result.`;
};
