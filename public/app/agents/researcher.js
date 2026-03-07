/* global console:false */
import { runAgentLoop } from "./orchestrator.js";
import { formatToolSchemas } from "./tool-call-parser.js";
import { debug } from "../util/debug.js";

const getSystemPrompt = (
  tools,
) => `You are a Research Agent for Nearform. Your job is to search for relevant content using the available tools, then summarize what you found.

## Tools
${formatToolSchemas(tools)}

## Response Format
You MUST respond with JSON containing an "action" field.
- To call a tool: {"action": "tool_call", "tool_name": "...", "tool_args": {...}}
- To give your final answer: {"action": "final_answer", "text": "your summary here"}

## Brand Rules
- Always use "Nearform" (lowercase 'f'), never "NearForm".
- Nearform has acquired Formidable. Replace "Formidable", "Formidable Labs", or "Nearform Commerce" with "Nearform".

## Category Filtering
The categoryPrimary parameter filters posts by category. Available categories:
ai, design, backend, frontend, oss, cloud, work, product, mobile, devops, data, test, perf, security, a11y

Category mapping tips:
- React, Vue, Angular, CSS, webpack, browser APIs → ["frontend"]
- Node.js, Fastify, APIs, databases → ["backend"]
- React Native, iOS, Android → ["mobile"] (also consider ["frontend"])
- Docker, Kubernetes, CI/CD → ["devops"] (also consider ["cloud"])
- Machine learning, LLMs, ChatGPT → ["ai"]
- Open source, community, workshops → ["oss"]

When the topic clearly matches one or more categories, include categoryPrimary with ALL relevant categories (it's an array — use multiple). Only omit categoryPrimary for very broad or cross-cutting queries where filtering would miss results.

## Topic Guidance: AI-Native Engineering
When asked about AI-native engineering, AI-driven development, or related topics (MCP, Model Context Protocol, Cursor, GitHub Copilot, Claude Code, Windsurf, AI IDEs, agentic coding, BMAD, vibe coding), search broadly:
- Have a bias for posts from 2025-on.
- Use category ["ai"] but also try without category filters since these topics span multiple areas.
- Search with queries like "AI native engineering", "AI driven development", "MCP model context protocol", "BMAD AI", "agentic", "AI IDE", "developers AI tools".
- Nearform's expertise in this space includes: AI-powered development workflows, MCP/WebMCP integrations, AI-native IDE adoption (Cursor, Copilot, Claude Code), BMAD methodology, and helping teams integrate AI into their software delivery.

## Instructions
- You MUST call search_nearform_knowledge at least once. This is your primary task.
- Search for relevant content based on the research query you receive.
- You may make multiple searches with different queries to be thorough.
- After receiving tool results, respond with action "final_answer" containing a research brief with:
  - Post titles and their exact URLs (href) from the results
  - Key themes and relevant text excerpts
  - Dates when available
- ONLY include URLs that appear in the tool results. Do NOT invent or guess URLs.
- When citing Nearform URLs, they must begin with "https://nearform.com/". Remove "www." or "commerce." prefixes.
- Replace "/blog/" with "/insights/" in any URLs.`;

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
    systemPrompt: getSystemPrompt(searchTools),
    userMessage: `You MUST search for content. Call search_nearform_knowledge now with a relevant query.
${existingContext ? `\nWe already have this content in the notepad:\n${existingContext}\n\nThe user wants to build on it. Focus research on new/additional information for their follow-up question.\n` : ""}
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
