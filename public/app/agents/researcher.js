import { runAgentLoop } from "./agent-loop.js";
import { debug } from "../util/debug.js";
import { getResearcherSystemPrompt } from "./prompts.js";

export const runResearcher = async ({
  query,
  tools,
  onActivity,
  existingContext,
  onContextUpdate,
}) => {
  const searchTools = tools.filter(
    (t) => t.name === "search_nearform_knowledge",
  );

  if (searchTools.length === 0) {
    debug.error(
      "Researcher",
      "search_nearform_knowledge not found in tools!",
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
    debug.warn(
      "Researcher",
      "search_nearform_knowledge found but not connected",
    );
  }

  debug(
    "Researcher",
    "Available search tools:",
    searchTools.map((t) => `${t.name} (${t.source}, connected=${t.connected})`),
  );

  // Cap existingContext to titles/URLs only so it doesn't blow the context window
  const summarizeExisting = (notepad) => {
    if (!notepad) return "";
    const links = notepad.match(/\*\*\[.*?\]\(.*?\)\*\*/g) || [];
    if (links.length === 0) return notepad.slice(0, 500);

    const MAX_LINKS = 20;
    const MAX_CHARS = 1000;
    const limitedLinks = links.slice(0, MAX_LINKS);
    let summary = "Already covered:\n" + limitedLinks.join("\n");

    let truncated = false;
    if (summary.length > MAX_CHARS) {
      summary = summary.slice(0, MAX_CHARS);
      truncated = true;
    }

    const omittedLinkCount = links.length - limitedLinks.length;
    if (omittedLinkCount > 0 || truncated) {
      summary += `\n… (${omittedLinkCount > 0 ? `${omittedLinkCount} more links` : "more content"} omitted)`;
    }
    return summary;
  };

  const contextSummary = summarizeExisting(existingContext);

  // Each runAgentLoop call creates and destroys its own session,
  // so coordinator retries automatically get fresh sessions.
  const result = await runAgentLoop({
    systemPrompt: getResearcherSystemPrompt(searchTools, query),
    userMessage: `You MUST search for content. Call search_nearform_knowledge now with a relevant query.
${contextSummary ? `\n${contextSummary}\n\nThe user wants to build on it. Only search for information genuinely MISSING from the above. Do not re-search topics already covered. When in doubt, omit categoryPrimary to avoid filtering out relevant results.\n` : ""}
User question: ${query}`,
    tools: searchTools,
    onActivity,
    agentName: "Researcher",
    onContextUpdate,
  });

  // Check if the tool was actually called by looking at activity
  if (
    !result.includes("http") &&
    !result.includes("nearform") &&
    result.length < 100
  ) {
    debug.warn(
      "Researcher",
      "Result looks empty or tool was never called:",
      result,
    );
    debug("Researcher", "WARNING: Suspiciously short result:", result);
  }

  return result;
};
