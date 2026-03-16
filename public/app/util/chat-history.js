/**
 * Truncate text to fit within a character budget, cutting at the last
 * sentence-ending punctuation or newline boundary to avoid splitting
 * markdown links or mid-word breaks.
 */
const truncateClean = (text, maxLen) => {
  if (text.length <= maxLen) return text;
  if (maxLen <= 1) return "…";

  // Reserve 1 char for the ellipsis so output never exceeds maxLen
  const budget = maxLen - 1;
  const region = text.slice(0, budget);

  // Prefer the last sentence boundary (. ! ?) followed by whitespace or end
  const sentenceMatches = [...region.matchAll(/[.!?][)\]"']*(?:\s|$)/g)];
  const lastSentence = sentenceMatches.length
    ? sentenceMatches[sentenceMatches.length - 1]
    : null;
  if (lastSentence && lastSentence.index > budget * 0.3) {
    const cut = lastSentence.index + lastSentence[0].trimEnd().length;
    return text.slice(0, cut).trimEnd() + "…";
  }

  // Fall back to last newline
  const newlineEnd = region.lastIndexOf("\n");
  if (newlineEnd > budget * 0.3) {
    return text.slice(0, newlineEnd).trimEnd() + "…";
  }

  // Last resort: cut at last space (avoids mid-word / mid-URL)
  const spaceEnd = region.lastIndexOf(" ");
  if (spaceEnd > budget * 0.3) {
    return text.slice(0, spaceEnd).trimEnd() + "…";
  }

  return region + "…";
};

/**
 * Format an array of pre-formatted message strings, keeping only the most
 * recent entries that fit within maxChars. Single walk from the end — O(n).
 */
const joinRecentWithinBudget = (formatted, maxChars) => {
  // Walk from the end, accumulating lengths (+ 1 for "\n" separator)
  let total = 0;
  let startIdx = formatted.length;
  for (let i = formatted.length - 1; i >= 0; i--) {
    const added = formatted[i].length + (i < formatted.length - 1 ? 1 : 0);
    if (total + added > maxChars) break;
    total += added;
    startIdx = i;
  }

  if (startIdx < formatted.length) {
    return formatted.slice(startIdx).join("\n");
  }

  // Single message over budget — truncate at a clean boundary
  return truncateClean(formatted[formatted.length - 1], maxChars);
};

/**
 * Format chat history for inclusion in agent prompts.
 *
 * Excludes the last message (the current user query, passed separately as
 * originalQuery) to avoid duplication. When the formatted result exceeds
 * maxChars, oldest messages are dropped first; a single remaining message
 * is truncated at a clean sentence/newline boundary.
 *
 * @param {Array<{role: string, text: string}>} chatHistory
 * @param {object} [opts]
 * @param {number} [opts.maxChars=12000] Total character budget
 * @returns {string}
 */
export const formatChatHistory = (chatHistory, { maxChars = 12000 } = {}) => {
  if (!chatHistory || chatHistory.length < 2) return "";
  // Exclude current user query — it's passed separately as originalQuery
  const prior = chatHistory.slice(0, -1);
  const formatted = prior.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`,
  );

  const joined = formatted.join("\n");
  if (joined.length <= maxChars) return joined;

  return joinRecentWithinBudget(formatted, maxChars);
};

/**
 * Split chat history into earlier conversation and the last assistant
 * response, for prompts where the previous response needs to be a
 * first-class edit target.
 *
 * @param {Array<{role: string, text: string}>} chatHistory
 * @param {object} [opts]
 * @param {number} [opts.maxChars=12000] Combined budget for last response + earlier history
 * @returns {{ earlier: string, lastResponse: string }}
 */
export const splitChatHistory = (chatHistory, { maxChars = 12000 } = {}) => {
  if (!chatHistory || chatHistory.length < 2) {
    return { earlier: "", lastResponse: "" };
  }

  // Exclude current user query
  const prior = chatHistory.slice(0, -1);

  // Find last assistant message
  let lastAssistantIdx = -1;
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) {
    return {
      earlier: formatChatHistory(chatHistory, { maxChars }),
      lastResponse: "",
    };
  }

  // Last response gets priority — it's the active edit target
  const rawResponse = prior[lastAssistantIdx].text;
  const lastResponse =
    rawResponse.length <= maxChars
      ? rawResponse
      : truncateClean(rawResponse, maxChars);

  // Remaining budget goes to earlier history
  const earlierBudget = maxChars - lastResponse.length;

  const olderMessages = prior.slice(0, lastAssistantIdx);
  if (olderMessages.length === 0 || earlierBudget <= 0) {
    return { earlier: "", lastResponse };
  }

  const formatted = olderMessages.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`,
  );

  const joined = formatted.join("\n");
  if (joined.length <= earlierBudget) {
    return { earlier: joined, lastResponse };
  }

  return {
    earlier: joinRecentWithinBudget(formatted, earlierBudget),
    lastResponse,
  };
};
