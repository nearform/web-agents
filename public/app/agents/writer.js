import { runAgentLoop } from "./orchestrator.js";
import { formatToolSchemas } from "./tool-call-parser.js";

const getSystemPrompt = (
  tools,
) => `You are a Writer Agent. Your job is to compose well-formatted summaries and write them to the shared notepad.

You have access to these tools:
${formatToolSchemas(tools)}

To use a tool, output a tool_call block like this:
<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>

Instructions:
- First, clear the notepad using clear_notes
- Then, write a well-structured summary using take_notes
- Format content with markdown: use headings, bullet points, and bold for emphasis
- Include relevant links and dates when available
- Write a concise but comprehensive summary
- Do NOT use tool_call in your final message — just confirm what you wrote`;

export const runWriter = async ({
  researchBrief,
  originalQuery,
  tools,
  onActivity,
}) => {
  const noteTools = tools.filter(
    (t) => t.name === "take_notes" || t.name === "clear_notes",
  );

  return runAgentLoop({
    systemPrompt: getSystemPrompt(noteTools),
    userMessage: `Based on the following research, compose a well-formatted summary and write it to the notepad.

Original question: ${originalQuery}

Research findings:
${researchBrief}`,
    onActivity,
    agentName: "Writer",
  });
};
