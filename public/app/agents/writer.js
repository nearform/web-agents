import {
  createSession,
  promptSessionStreaming,
  getContextInfo,
} from "./prompt-api.js";
import { callTool } from "../bridge/tool-registry.js";
import { debug } from "../util/debug.js";
import { createEmitter } from "../util/activity.js";
import { config } from "../config.js";
import { WRITER_SYSTEM_PROMPT } from "./prompts.js";

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
  return (
    text.slice(0, Math.ceil(text.length * config.context.retryReduction)) +
    "\n...[truncated for retry]"
  );
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

  emit("start", "Writer starting");
  emit("prompt", {
    summary: "Writer system prompt",
    prompt: WRITER_SYSTEM_PROMPT,
    kind: "system",
  });

  let session = await createSession(WRITER_SYSTEM_PROMPT);
  reportStatus("active");

  const tryStreaming = async (prompt, onChunk, label) => {
    try {
      const result = await promptSessionStreaming(session, prompt, onChunk);
      reportContext();
      return result;
    } catch (err) {
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
Write a helpful, well-formatted markdown answer. Include 1-3 citations using EXACTLY this format: [Title](URL) — the ] must come before the (. Source URLs ONLY from the research above.`;

    emit("prompt", {
      summary: "Composing chat reply from existing research",
      prompt: chatPrompt,
    });
    debug("Writer", "=== CHAT-ONLY PROMPT ===\n" + chatPrompt);
    let chatReply = await tryStreaming(chatPrompt, onStreamChunk, "Chat reply");

    if (chatReply == null) {
      // Retry with truncated notepad and fresh session
      session.destroy();
      session = await createSession(WRITER_SYSTEM_PROMPT);
      const retryPrompt = chatPrompt.replace(
        existingNotepad,
        truncateHalf(existingNotepad),
      );
      chatReply = await promptSessionStreaming(
        session,
        retryPrompt,
        onStreamChunk,
      );
    }

    debug("Writer", "=== CHAT REPLY ===\n" + chatReply);

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
    contentPrompt = `Update the existing research notepad by integrating new research findings in detail. Preserve existing content and add substantial new material — excerpts, technical details, and citations.
${historyFull ? `\nConversation so far:\n${historyFull}\n` : ""}
Original question: ${originalQuery}

Existing notepad content to build upon:
${existingNotepad}

Extend and integrate new findings into the existing content rather than replacing it.

New research findings:
${researchBrief}`;
  } else if (hasResearch) {
    contentPrompt = `Write a detailed, well-formatted markdown research document for the notepad. Include substantial content from the research findings — excerpts, technical details, and all relevant information. Do not over-summarize; the notepad is the user's primary reference.
${historyFull ? `\nConversation so far:\n${historyFull}\n` : ""}
Original question: ${originalQuery}

Research findings:
${researchBrief}`;
  } else {
    contentPrompt = `Write a research summary for the notepad based on the user's question.
${historyFull ? `\nConversation so far:\n${historyFull}\n` : ""}
User request: ${originalQuery}`;
  }

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
    session = await createSession(WRITER_SYSTEM_PROMPT);
    const shorterBrief = truncateHalf(researchBrief);
    const shorterNotepad = existingNotepad ? truncateHalf(existingNotepad) : "";
    const retryPrompt = contentPrompt
      .replace(researchBrief || "", shorterBrief || "")
      .replace(existingNotepad || "", shorterNotepad);
    notepadContent = await promptSessionStreaming(
      session,
      retryPrompt,
      onNotepadStreamChunk,
    );
  }

  debug("Writer", "=== NOTEPAD CONTENT ===\n" + notepadContent);

  // Write to notepad
  emit("tool-call", { name: "take_notes", args: {} });
  await callTool("take_notes", { content: notepadContent });
  emit("tool-result", { name: "take_notes", result: "written" });

  // Generate chat reply
  const chatReplyPrompt = `Now write a short 2-3 sentence conversational reply for the chat that answers the user's question. Don't repeat the full notepad — just highlight the key takeaway and mention the notepad has full details. End with 1-3 source citations using EXACTLY this format: \`[Title](URL)\`. ONLY use URLs from the research above. Do NOT wrap your response in markdown code fences (\`\`\`). Output raw markdown directly.`;
  emit("prompt", { summary: "Composing chat reply", prompt: chatReplyPrompt });
  const chatReply = await promptSessionStreaming(
    session,
    chatReplyPrompt,
    onStreamChunk,
  );
  debug("Writer", "=== CHAT REPLY ===\n" + chatReply);

  session.destroy();
  reportStatus("done");
  emit("done", "Writer finished");

  return chatReply;
};
