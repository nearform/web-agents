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
- Cite sources as markdown links. The format is EXACTLY: [Title](URL) — the ] must come BEFORE the (.
  CORRECT: [My Article](https://nearform.com/insights/my-article)
  WRONG:   [My Article (https://nearform.com/insights/my-article)]
- If a date is available, put it AFTER the link, not inside it: [Title](URL) (2025-01-15)
- Each URL may appear at most once.
- URLs must begin with "https://nearform.com/". Remove "www." or "commerce." prefixes.
- Replace "/blog/" with "/insights/" in any URLs.
- When referring to source material, use the words "articles", "sources", or "citations". Never say "chunks", "context", or "tool results".
- If no relevant information exists, state that clearly.

## Format
- Use markdown: headings (##), bullet points, **bold** for emphasis.
- Include source citations as [Title](URL) links.
- Keep the summary concise but comprehensive.
- Output ONLY the markdown content, no preamble or wrapping.`;

export const runWriter = async ({
  researchBrief,
  originalQuery,
  onActivity,
  existingNotepad,
  skipNotepadWrite = false,
}) => {
  const emit = (type, detail) => {
    if (onActivity) {
      onActivity({ agent: "Writer", type, detail, timestamp: Date.now() });
    }
  };

  emit("start", "Writer starting");

  const session = await createSession(SYSTEM_PROMPT);

  if (skipNotepadWrite) {
    // Chat-only mode: notepad stays untouched, produce answer from notepad context
    debug("Writer", "skipNotepadWrite=true — chat-only mode");
    emit("prompt", "Composing chat reply from existing research");

    const chatPrompt = `Using the research notepad below as your source material, answer the user's question.
IMPORTANT: ONLY use URLs that appear in the research notepad below. Do NOT invent or guess URLs.

User's request: ${originalQuery}

Research notepad:
${existingNotepad}

Write a helpful, well-formatted markdown answer. Include 1-3 citations using EXACTLY this format: [Title](URL) — the ] must come before the (. Source URLs ONLY from the research above.`;

    debug("Writer", "=== CHAT-ONLY PROMPT ===\n" + chatPrompt);
    const chatReply = await promptSession(session, chatPrompt);
    debug("Writer", "=== CHAT REPLY ===\n" + chatReply);

    session.destroy();
    emit("done", "Writer finished");
    return chatReply;
  }

  // Full mode: write research to notepad, then produce chat answer
  emit("prompt", "Composing notepad content");

  const hasResearch = researchBrief && researchBrief.trim().length > 0;
  let contentPrompt;

  if (hasResearch && existingNotepad) {
    contentPrompt = `Update the existing research notepad based on new research findings.

Original question: ${originalQuery}

Existing notepad content to build upon:
${existingNotepad}

Extend and integrate new findings into the existing content rather than replacing it.

New research findings:
${researchBrief}`;
  } else if (hasResearch) {
    contentPrompt = `Write a well-formatted markdown research summary for the notepad.

Original question: ${originalQuery}

Research findings:
${researchBrief}`;
  } else {
    contentPrompt = `Write a research summary for the notepad based on the user's question.

User request: ${originalQuery}`;
  }

  debug("Writer", "=== CONTENT PROMPT ===\n" + contentPrompt);
  const notepadContent = await promptSession(session, contentPrompt);
  debug("Writer", "=== NOTEPAD CONTENT ===\n" + notepadContent);

  // Write to notepad
  emit("tool-call", { name: "take_notes", args: {} });
  await callTool("take_notes", { content: notepadContent });
  emit("tool-result", { name: "take_notes", result: "written" });

  // Generate chat reply
  emit("prompt", "Composing chat reply");
  const chatReply = await promptSession(
    session,
    `Now write a short 2-3 sentence conversational reply for the chat that answers the user's question. Don't repeat the full notepad — just highlight the key takeaway and mention the notepad has full details. End with 1-3 source citations using EXACTLY this format: \`[Title](URL)\`. ONLY use URLs from the research above.`,
  );
  debug("Writer", "=== CHAT REPLY ===\n" + chatReply);

  session.destroy();
  emit("done", "Writer finished");

  return chatReply;
};
