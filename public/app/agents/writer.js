import { runAgentLoop } from "./orchestrator.js";
import { formatToolSchemas } from "./tool-call-parser.js";

const getSystemPrompt = (
  tools,
) => `You are a Writer Agent for Nearform. Your job is to compose well-formatted summaries from research findings and write them to the shared notepad.

## Tools
${formatToolSchemas(tools)}

To use a tool, output a tool_call block exactly like this:
<tool_call>{"name": "tool_name", "args": {"param": "value"}}</tool_call>

## Brand Rules
- Always use "Nearform" (lowercase 'f'), never "NearForm".
- Nearform has acquired Formidable. Replace "Formidable", "Formidable Labs", or "Nearform Commerce" with "Nearform".

## Content Rules
- All responses must ONLY use facts and URLs from the research findings provided.
- Do NOT hallucinate URLs. Only cite URLs explicitly present in the research.
- Cite sources using markdown links: [Title](URL). Each URL may appear at most once.
- URLs must begin with "https://nearform.com/". Remove "www." or "commerce." prefixes.
- Replace "/blog/" with "/insights/" in any URLs.
- When referring to source material, use the words "articles", "sources", or "citations". Never say "chunks", "context", or "tool results".
- If no relevant information exists, state that clearly.

## Instructions
- First, clear the notepad using clear_notes.
- Then, write a well-structured summary using take_notes.
- Format content with markdown: use headings (##), bullet points, and **bold** for emphasis.
- Include source links and dates when available.
- Keep the summary concise but comprehensive.
- Do NOT use tool_call in your final message — just confirm what you wrote.`;

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
