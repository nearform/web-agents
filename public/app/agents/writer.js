/* global DOMException:false */
import {
  createSession,
  promptSessionStreaming,
  getContextInfo,
} from "./prompt-api.js";
import { callTool } from "../bridge/tool-registry.js";
import { debug } from "../util/debug.js";
import { createEmitter } from "../util/activity.js";
import { config } from "../config.js";
import { getWriterSystemPrompt } from "./prompts.js";

const formatChatHistory = (chatHistory, maxPairs = 3) => {
  if (!chatHistory || chatHistory.length === 0) return "";
  const recent = chatHistory.slice(-maxPairs * 2);
  return recent
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 200)}`,
    )
    .join("\n");
};

const truncateHalf = (text) => {
  if (!text) return text;
  const budget = Math.ceil(text.length * config.context.retryReduction);
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf("\n", budget);
  const end = cut > 0 ? cut : budget;
  return text.slice(0, end) + "\n...[truncated for retry]";
};

export const runWriter = async ({
  researchBrief,
  originalQuery,
  onActivity,
  existingNotepad,
  chatHistory,
  skipNotepadWrite = false,
  onStreamChunk,
  onNotepadStreamChunk,
  onAgentStatus,
  onAgentPrompt,
  signal,
}) => {
  const emit = createEmitter("Writer", onActivity);
  const reportContext = () => {
    if (!onAgentStatus) return;
    const info = getContextInfo(session);
    if (info) onAgentStatus("Writer", "active", info);
  };
  const reportStatus = (status) => {
    if (!onAgentStatus) return;
    const info = getContextInfo(session);
    onAgentStatus("Writer", status, info);
  };

  const lastUserMsg = chatHistory?.findLast((m) => m.role === "user")?.text;
  const writerSystemPrompt = getWriterSystemPrompt(originalQuery, lastUserMsg);

  emit("start", "Writer starting");
  if (onAgentPrompt) onAgentPrompt("Writer", "system", writerSystemPrompt);
  emit("prompt", {
    summary: "Writer system prompt",
    prompt: writerSystemPrompt,
    kind: "system",
  });

  let session = await createSession(writerSystemPrompt);
  reportStatus("active");

  const tryStreaming = async (prompt, onChunk, label) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const result = await promptSessionStreaming(session, prompt, onChunk, {
        signal,
      });
      reportContext();
      return result;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (!err.message.includes("timed out")) throw err;
      debug.warn("Writer", `${label} timed out, retrying with truncated input`);
      emit("retry", `${label} timed out — retrying with shorter context`);
      // Rebuild prompt with truncated content
      return null;
    }
  };

  if (skipNotepadWrite) {
    // Chat-only mode: notepad stays untouched, produce answer from notepad context
    debug("Writer", "skipNotepadWrite=true — chat-only mode");

    const history = formatChatHistory(chatHistory);
    const chatPrompt = `Answer the user's specific question directly and concisely using the research notepad below as your source material.
IMPORTANT: ONLY use URLs that appear in the research notepad below. Do NOT invent or guess URLs.
${history ? `\nConversation so far:\n${history}\n` : ""}
User's latest request: ${originalQuery}

Research notepad:
${existingNotepad}

Do NOT summarize the entire notepad — extract only what's relevant to the question.
If the notepad doesn't contain enough information to answer, say so rather than guessing.
Do NOT wrap your response in markdown code fences (\`\`\`). Output raw markdown directly.
Write a helpful, well-formatted markdown answer. Include 1-3 citations using EXACTLY this format: [Title](URL) — the ] must come before the (. Source URLs ONLY from the research above. Each URL must appear only once — never repeat the same link.`;

    if (onAgentPrompt) onAgentPrompt("Writer", "user", chatPrompt);
    emit("prompt", {
      summary: "Composing chat reply from existing research",
      prompt: chatPrompt,
    });
    debug("Writer", "=== CHAT-ONLY PROMPT ===\n" + chatPrompt);
    let chatReply = await tryStreaming(chatPrompt, onStreamChunk, "Chat reply");

    if (chatReply == null) {
      // Retry with truncated notepad and fresh session
      session.destroy();
      session = await createSession(writerSystemPrompt);
      const retryPrompt = chatPrompt.replace(
        existingNotepad,
        truncateHalf(existingNotepad),
      );
      emit("prompt", {
        summary: "Retry chat reply with shortened context",
        prompt: retryPrompt,
      });
      chatReply = await promptSessionStreaming(
        session,
        retryPrompt,
        onStreamChunk,
        { signal },
      );
    }

    debug("Writer", "=== CHAT REPLY ===\n" + chatReply);
    if (onAgentPrompt) onAgentPrompt("Writer", "answer", chatReply);

    session.destroy();
    reportStatus("done");
    emit("done", "Writer finished");
    return chatReply;
  }

  // Full mode: write research to notepad, then produce chat answer

  const hasResearch = researchBrief && researchBrief.trim().length > 0;
  const historyFull = formatChatHistory(chatHistory);
  let contentPrompt;

  if (hasResearch && existingNotepad) {
    contentPrompt = `Update the existing research notepad by integrating new research findings. The user's follow-up query tells you what additional information they're looking for — use it to decide how to integrate the new posts.

Maintain the structure (Summary, Posts). Add a Citations section with deduplicated sources.
- Add new posts to the Posts section.
- Update the Summary to reflect the expanded scope, framing it around the follow-up query.
- Preserve existing content and the new research's original wording. Do not rewrite existing posts.
- Deduplicate URLs across old and new content. Each URL must appear only once — keep each link where it's most relevant.
- A "Verified URLs" section may be appended to the research. Only use URLs from that list. If a URL in the prose doesn't match the verified list, replace it with the correct one or omit it.
- Do NOT include the "Verified URLs" section in your output — it is internal only.
${historyFull ? `\nConversation so far:\n${historyFull}\n` : ""}
User's follow-up query: ${originalQuery}

Existing notepad content:
${existingNotepad}

New research findings:
${researchBrief}`;
  } else if (hasResearch) {
    contentPrompt = `Format the research findings into a clean notepad. Preserve the researcher's structure and content faithfully. Clean up formatting and deduplicate URLs. Each URL must appear only once in the entire document — cite each source where it's most relevant and don't repeat it.
- A "Verified URLs" section may be appended to the research. Only use URLs from that list. If a URL in the prose doesn't match the verified list, replace it with the correct one or omit it.
- Do NOT include the "Verified URLs" section in your output — it is internal only.
${historyFull ? `\nConversation so far:\n${historyFull}\n` : ""}
Original question: ${originalQuery}

Research findings:
${researchBrief}`;
  } else {
    contentPrompt = `Write a research summary for the notepad based on the user's question.
${historyFull ? `\nConversation so far:\n${historyFull}\n` : ""}
User request: ${originalQuery}`;
  }

  if (onAgentPrompt) onAgentPrompt("Writer", "user", contentPrompt);
  emit("prompt", {
    summary: "Composing notepad content",
    prompt: contentPrompt,
  });
  debug("Writer", "=== CONTENT PROMPT ===\n" + contentPrompt);
  let notepadContent = await tryStreaming(
    contentPrompt,
    onNotepadStreamChunk,
    "Notepad write",
  );

  if (notepadContent == null) {
    // Retry with truncated inputs and fresh session
    session.destroy();
    session = await createSession(writerSystemPrompt);
    const shorterBrief = truncateHalf(researchBrief);
    const shorterNotepad = existingNotepad ? truncateHalf(existingNotepad) : "";
    const retryPrompt = contentPrompt
      .replace(researchBrief || "", shorterBrief || "")
      .replace(existingNotepad || "", shorterNotepad);
    emit("prompt", {
      summary: "Retry notepad write with shortened context",
      prompt: retryPrompt,
    });
    notepadContent = await promptSessionStreaming(
      session,
      retryPrompt,
      onNotepadStreamChunk,
      { signal },
    );
  }

  debug("Writer", "=== NOTEPAD CONTENT ===\n" + notepadContent);
  if (onAgentPrompt) onAgentPrompt("Writer", "answer", notepadContent);

  // Write to notepad
  emit("tool-call", { name: "take_notes", args: {} });
  await callTool("take_notes", { content: notepadContent });
  emit("tool-result", { name: "take_notes", result: "written" });

  // Generate chat reply
  const chatReplyPrompt = `Now write a short 2-3 sentence conversational reply for the chat that answers the user's question. Don't repeat the full notepad — just highlight the key takeaway and mention the notepad has full details. End with 1-3 source citations using EXACTLY this format: \`[Title](URL)\`. ONLY use URLs from the research above. Each URL must appear only once — never repeat the same link. Do NOT wrap your response in markdown code fences (\`\`\`). Output raw markdown directly.`;
  if (onAgentPrompt) onAgentPrompt("Writer", "user", chatReplyPrompt);
  emit("prompt", { summary: "Composing chat reply", prompt: chatReplyPrompt });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const chatReply = await promptSessionStreaming(
    session,
    chatReplyPrompt,
    onStreamChunk,
    { signal },
  );
  debug("Writer", "=== CHAT REPLY ===\n" + chatReply);
  if (onAgentPrompt) onAgentPrompt("Writer", "answer", chatReply);

  session.destroy();
  reportStatus("done");
  emit("done", "Writer finished");

  return chatReply;
};
