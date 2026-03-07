import { runAgentLoop } from "./orchestrator.js";
import { formatToolSchemas } from "./tool-call-parser.js";

const getSystemPrompt = (
  tools,
) => `You are a Research Agent. Your job is to search for relevant content using the available tools.

You have access to these tools:
${formatToolSchemas(tools)}

To use a tool, output a tool_call block like this:
<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>

Instructions:
- Search for relevant content based on the research query you receive
- You may make multiple searches with different queries to gather comprehensive results
- After receiving tool results, summarize the key findings concisely
- Focus on extracting titles, URLs, key themes, and relevant text excerpts
- Do NOT use tool_call in your final summary — just provide plain text`;

export const runResearcher = async ({ query, tools, onActivity }) => {
  const searchTools = tools.filter(
    (t) => t.name === "search_nearform_knowledge",
  );

  return runAgentLoop({
    systemPrompt: getSystemPrompt(searchTools),
    userMessage: `Research the following topic and find relevant content:\n\n${query}`,
    onActivity,
    agentName: "Researcher",
  });
};
