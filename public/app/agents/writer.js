import { createSession, promptSession } from "./prompt-api.js";
import { callTool } from "../bridge/tool-registry.js";
import { debug } from "../util/debug.js";

const SYSTEM_PROMPT = `You are a Writer Agent for Nearform. You compose well-formatted summaries from research findings.

## Brand Rules
- Always use "Nearform" (lowercase 'f'), never "NearForm".
- Nearform has acquired Formidable. Replace "Formidable", "Formidable Labs", or "Nearform Commerce" with "Nearform".

## Content Rules
- ONLY use facts and URLs from the research findings provided.
- Do NOT hallucinate URLs. Only cite URLs explicitly present in the research.
- Cite sources using markdown links: [Title](URL). Each URL may appear at most once.
- URLs must begin with "https://nearform.com/". Remove "www." or "commerce." prefixes.
- Replace "/blog/" with "/insights/" in any URLs.
- When referring to source material, use the words "articles", "sources", or "citations". Never say "chunks", "context", or "tool results".
- If no relevant information exists, state that clearly.

## Format
- Use markdown: headings (##), bullet points, **bold** for emphasis.
- Include source links and dates when available.
- Keep the summary concise but comprehensive.
- Output ONLY the markdown content, no preamble or wrapping.`;

export const runWriter = async ({
  researchBrief,
  originalQuery,
  onActivity,
  existingNotepad,
}) => {
  const emit = (type, detail) => {
    if (onActivity) {
      onActivity({ agent: "Writer", type, detail, timestamp: Date.now() });
    }
  };

  emit("start", "Writer starting");

  // Step 1: Generate notepad content (unconstrained)
  emit("prompt", "Composing notepad content");
  const session = await createSession(SYSTEM_PROMPT);

  const hasResearch = researchBrief && researchBrief.trim().length > 0;
  let contentPrompt;

  if (hasResearch && existingNotepad) {
    contentPrompt = `Update the existing notepad content based on new research findings.

Original question: ${originalQuery}

Existing notepad content to build upon:
${existingNotepad}

Extend and integrate new findings into the existing content rather than replacing it.

New research findings:
${researchBrief}`;
  } else if (hasResearch) {
    contentPrompt = `Write a well-formatted markdown summary for the notepad.

Original question: ${originalQuery}

Research findings:
${researchBrief}`;
  } else {
    contentPrompt = `Revise and improve the existing notepad content based on the user's follow-up request. No new research was needed — just rework the existing content.

User request: ${originalQuery}

Current notepad content:
${existingNotepad}`;
  }

  debug("Writer", "=== CONTENT PROMPT ===\n" + contentPrompt);
  const notepadContent = await promptSession(session, contentPrompt);
  debug("Writer", "=== NOTEPAD CONTENT ===\n" + notepadContent);

  // Step 2: Write to notepad programmatically
  emit("tool-call", { name: "take_notes", args: {} });
  await callTool("take_notes", { content: notepadContent });
  emit("tool-result", { name: "take_notes", result: "written" });

  // Step 3: Generate a short chat reply
  emit("prompt", "Composing chat reply");
  const chatReply = await promptSession(
    session,
    `Now write a short 2-3 sentence conversational reply for the chat that answers the user's question. Don't repeat the full notepad — just highlight the key takeaway and mention the notepad has full details. End with 1-3 specific source citations as markdown links (e.g. [Title](https://nearform.com/insights/...)). Use only real URLs from the research.`,
  );
  debug("Writer", "=== CHAT REPLY ===\n" + chatReply);

  session.destroy();
  emit("done", "Writer finished");

  return chatReply;
};
