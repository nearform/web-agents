/* global console:false */
import { runAgentLoop } from "./orchestrator.js";
import { formatToolSchemas } from "./tool-call-parser.js";
import { debug } from "../util/debug.js";

const getSystemPrompt = (
  tools,
) => `You are a Research Agent for Nearform. Your job is to search for relevant content using the available tools, then summarize what you found.

## Tools
${formatToolSchemas(tools)}

To use a tool, output a tool_call block exactly like this:
<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>

## Brand Rules
- Always use "Nearform" (lowercase 'f'), never "NearForm".
- Nearform has acquired Formidable. Replace "Formidable", "Formidable Labs", or "Nearform Commerce" with "Nearform".

## Instructions
- You MUST call search_nearform_knowledge at least once. This is your primary task.
- Search for relevant content based on the research query you receive.
- You may make multiple searches with different queries to be thorough.
- After receiving tool results, compile a research brief with:
  - Post titles and their exact URLs (href) from the results
  - Key themes and relevant text excerpts
  - Dates when available
- ONLY include URLs that appear in the tool results. Do NOT invent or guess URLs.
- When citing Nearform URLs, they must begin with "https://nearform.com/". Remove "www." or "commerce." prefixes.
- Replace "/blog/" with "/insights/" in any URLs.
- Do NOT use tool_call in your final summary — just provide plain text.`;

export const runResearcher = async ({ query, tools, onActivity }) => {
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
    systemPrompt: getSystemPrompt(searchTools),
    userMessage: `You MUST search for content. Call search_nearform_knowledge now with a relevant query.

User question: ${query}`,
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
