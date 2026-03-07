/* global console:false */
import { runAgentLoop } from "./orchestrator.js";
import { debug } from "../util/debug.js";
import { getResearcherSystemPrompt } from "./prompts.js";

export const runResearcher = async ({
  query,
  tools,
  onActivity,
  existingContext,
}) => {
  const searchTools = tools.filter(
    (t) => t.name === "search_nearform_knowledge",
  );

  if (searchTools.length === 0) {
    console.error(
      "[Researcher] search_nearform_knowledge not found in tools!",
      "Available tools:",
      tools.map((t) => t.name),
    );
    debug(
      "Researcher",
      "FATAL: search_nearform_knowledge missing. All tools:",
      JSON.stringify(tools, null, 2),
    );
    throw new Error(
      "search_nearform_knowledge tool not available. Is vector-search-web running on port 4600?",
    );
  }

  const connected = tools.find(
    (t) => t.name === "search_nearform_knowledge",
  )?.connected;
  if (!connected) {
    console.warn(
      "[Researcher] search_nearform_knowledge found but not connected",
    );
  }

  debug(
    "Researcher",
    "Available search tools:",
    searchTools.map((t) => `${t.name} (${t.source}, connected=${t.connected})`),
  );

  const result = await runAgentLoop({
    systemPrompt: getResearcherSystemPrompt(searchTools),
    userMessage: `You MUST search for content. Call search_nearform_knowledge now with a relevant query.
${existingContext ? `\nWe already have this content in the notepad:\n${existingContext}\n\nThe user wants to build on it. Focus research on new/additional information for their follow-up question.\nIMPORTANT: The notepad above was built from earlier searches. When choosing categoryPrimary for follow-up searches, consider ALL categories relevant to both the existing content AND the new question — don't narrow to just the follow-up topic. If the original content was about "ai" topics, keep "ai" in your category filters even if the follow-up seems like a different sub-topic. When in doubt, omit categoryPrimary entirely to avoid filtering out relevant results.\n` : ""}
User question: ${query}`,
    tools: searchTools,
    onActivity,
    agentName: "Researcher",
  });

  // Check if the tool was actually called by looking at activity
  if (
    !result.includes("http") &&
    !result.includes("nearform") &&
    result.length < 100
  ) {
    console.warn(
      "[Researcher] Result looks empty or tool was never called:",
      result,
    );
    debug("Researcher", "WARNING: Suspiciously short result:", result);
  }

  return result;
};
